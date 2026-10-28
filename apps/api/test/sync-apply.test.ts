import { describe, expect, it } from 'vitest';
import type { Grant, SyncOp } from '@amara/shared';
import { applySyncOp, replayStuck, STUCK_AFTER_MS } from '../src/sync-apply.ts';
import { B1, B2, ctxTerminal, DEV, GER, makeSale, now, saleOp, seedRepo, T1, uid, V1, V2, VEN } from './fixtures.ts';

const apply = (repo: ReturnType<typeof seedRepo>, op: SyncOp, ctx = ctxTerminal) => applySyncOp(repo, op, ctx);

describe('idempotencia', () => {
  it('la misma venta dos veces: primero applied, luego duplicate, y el stock baja una sola vez', async () => {
    const repo = seedRepo();
    const op = saleOp(makeSale({ qty: 2 }));
    const a = await apply(repo, op);
    const b = await apply(repo, op);
    expect(a.status).toBe('applied');
    expect(b.status).toBe('duplicate');
    expect(repo.qty(V1, B1)).toBe(8);
    expect(repo.sales.size).toBe(1);
  });

  it('el evento queda guardado con la operación original y estado aplicada', async () => {
    const repo = seedRepo();
    const op = saleOp(makeSale());
    await apply(repo, op);
    const ev = repo.events.get(op.opId)!;
    expect(ev.status).toBe('aplicada');
    expect(ev.op.opId).toBe(op.opId);
  });

  it('dos opId distintos con la MISMA venta no duplican venta ni existencias (idempotencia por _id)', async () => {
    const repo = seedRepo();
    const sale = makeSale({ qty: 3 });
    await apply(repo, saleOp(sale));
    await apply(repo, saleOp(sale)); // otro opId
    expect(repo.sales.size).toBe(1);
    expect(repo.qty(V1, B1)).toBe(7);
  });

  it('un evento que falló a medias (error) se reprocesa en el reintento sin duplicar movimientos', async () => {
    const repo = seedRepo();
    const sale = makeSale({ qty: 2 });
    const op = saleOp(sale);
    repo.failOnce.incStock = new Error('caída simulada');
    await expect(apply(repo, op)).rejects.toThrow('caída simulada');
    expect(repo.events.get(op.opId)!.status).toBe('error');
    // El movimiento ya estaba insertado pero el $inc no se aplicó (hueco que repara reconcile)...
    expect(repo.movements.size).toBe(1);
    expect(repo.qty(V1, B1)).toBe(10);
    // ...el reintento termina la operación y NO responde duplicate. (El $inc perdido NO se reaplica aquí
    // para no arriesgar doble conteo: lo repara reconcileStock sumando movimientos.)
    const retry = await apply(repo, op);
    expect(retry.status).toBe('applied');
    expect(repo.sales.size).toBe(1);
    expect(repo.movements.size).toBe(1);
  });

  it('un evento "procesando" abandonado se reprocesa con replayStuck', async () => {
    const repo = seedRepo();
    const op = saleOp(makeSale());
    await repo.insertEvent({ id: op.opId, type: op.type, terminalId: op.terminalId, branchId: op.branchId, userId: op.userId, localTs: op.localTs, receivedAt: new Date(now().getTime() - STUCK_AFTER_MS - 1000).toISOString(), status: 'procesando', source: 'terminal', op, attempts: 1 });
    const r = await replayStuck(repo, { now, source: 'servidor' });
    expect(r.replayed).toBe(1);
    expect(repo.sales.size).toBe(1);
    expect(repo.events.get(op.opId)!.status).toBe('aplicada');
  });

  it('un duplicado reciente en proceso responde duplicate sin aplicar de nuevo', async () => {
    const repo = seedRepo();
    const op = saleOp(makeSale());
    await repo.insertEvent({ id: op.opId, type: op.type, terminalId: op.terminalId, branchId: op.branchId, userId: op.userId, localTs: op.localTs, receivedAt: now().toISOString(), status: 'procesando', source: 'terminal', op, attempts: 1 });
    const r = await apply(repo, op);
    expect(r.status).toBe('duplicate');
    expect(repo.sales.size).toBe(0);
  });
});

describe('venta ya ocurrida y existencias', () => {
  it('NUNCA se rechaza por falta de stock: se aplica, queda negativo y genera conflicto', async () => {
    const repo = seedRepo(); // V2 tiene 1 pieza
    const sale = makeSale({ qty: 3, variantId: V2, price: 15000 });
    const r = await apply(repo, saleOp(sale));
    expect(r.status).toBe('conflict');
    expect(r.conflictKind).toBe('stock_negativo');
    expect(repo.sales.has(sale.id)).toBe(true);
    expect(repo.qty(V2, B1)).toBe(-2);
    expect(repo.conflictKinds()).toContain('stock_negativo');
    const c = [...repo.conflicts.values()].find((x) => x.kind === 'stock_negativo')!;
    expect(c.rejected).toBe(false);
    expect(c.status).toBe('abierto');
  });

  it('un movimiento de venta se registra SIEMPRE junto con el descuento de existencias', async () => {
    const repo = seedRepo();
    const sale = makeSale({ qty: 2 });
    await apply(repo, saleOp(sale));
    const m = repo.movements.get(`${sale.id}:m0`)!;
    expect(m.delta).toBe(-2);
    expect(m.type).toBe('venta');
    expect(m.refId).toBe(sale.id);
  });

  it('producto desconocido: la venta se guarda, no descuenta y avisa', async () => {
    const repo = seedRepo();
    const r = await apply(repo, saleOp(makeSale({ variantId: 'no-existe' })));
    expect(r.status).toBe('conflict');
    expect(r.conflictKind).toBe('producto_desconocido');
    expect(repo.sales.size).toBe(1);
    expect(repo.movements.size).toBe(0);
  });
});

describe('validaciones del servidor', () => {
  it('importes que no cuadran se rechazan y no se guardan', async () => {
    const repo = seedRepo();
    const sale = makeSale({ qty: 2 });
    sale.items[0]!.netCents = 100; // manipulado
    const r = await apply(repo, saleOp(sale));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('importes_inconsistentes');
    expect(repo.sales.size).toBe(0);
    expect(repo.qty(V1, B1)).toBe(10);
    expect(repo.events.get(r.opId)!.status).toBe('rechazada');
  });

  it('payload mal formado se rechaza', async () => {
    const repo = seedRepo();
    const op: SyncOp = { opId: uid(), type: 'sale.create', branchId: B1, terminalId: T1, userId: VEN, localTs: '2026-10-22T17:00:00.000Z', payload: { sale: { id: 1 } } };
    expect((await apply(repo, op)).conflictKind).toBe('payload_invalido');
  });

  it('el desarrollador no puede registrar ventas', async () => {
    const repo = seedRepo();
    const r = await apply(repo, saleOp(makeSale({ userId: DEV })));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('sin_permiso');
  });

  it('un vendedor de otra sucursal se rechaza', async () => {
    const repo = seedRepo();
    repo.users.set(VEN, { id: VEN, name: 'V', role: 'vendedor', active: true, branchIds: [B2] });
    expect((await apply(repo, saleOp(makeSale()))).conflictKind).toBe('sin_acceso_sucursal');
  });

  it('descuento de un vendedor se aplica pero queda marcado', async () => {
    const repo = seedRepo();
    const r = await apply(repo, saleOp(makeSale({ qty: 2, discount: 1000 })));
    expect(r.status).toBe('conflict');
    expect(repo.conflictKinds()).toContain('descuento_sin_permiso');
    expect(repo.sales.size).toBe(1);
  });

  it('una operación de otra terminal se rechaza sin tocar nada', async () => {
    const repo = seedRepo();
    const sale = makeSale();
    const op = { ...saleOp(sale), terminalId: 'otra-terminal' };
    const r = await apply(repo, op);
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('terminal_ajena');
    expect(repo.events.size).toBe(0);
  });

  it('con sesión de usuario, la operación debe ser de ese usuario', async () => {
    const repo = seedRepo();
    const r = await applySyncOp(repo, saleOp(makeSale({ userId: VEN })), { now, source: 'usuario', sessionUserId: GER });
    expect(r.conflictKind).toBe('usuario_ajeno');
  });
});

const mov = (over: Record<string, unknown> = {}, userId = GER, localTs = '2026-10-22T17:30:00.000Z'): SyncOp => ({
  opId: uid(), type: 'stock.movement', branchId: B1, terminalId: T1, userId, localTs,
  payload: { movement: { id: uid(), variantId: V1, branchId: B1, type: 'entrada', delta: 5, reason: 'Compra proveedor', ...over } },
});

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: 'g-1', sellerId: VEN, branchId: B1, functions: ['inventario.entrada'], startsAt: '2026-10-22T17:00:00.000Z', expiresAt: '2026-10-22T19:00:00.000Z', revokedAt: null, grantedBy: GER, ...over,
});

describe('entradas de mercancía y permisos temporales', () => {
  it('el gerente registra entradas sin permiso temporal', async () => {
    const repo = seedRepo();
    const r = await apply(repo, mov());
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(15);
  });

  it('el vendedor SIN permiso vigente es rechazado', async () => {
    const repo = seedRepo();
    const r = await apply(repo, mov({}, VEN));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('sin_permiso');
    expect(repo.qty(V1, B1)).toBe(10);
  });

  it('el vendedor con permiso vigente a la hora LOCAL de la operación: se aplica y guarda grantId y authorizedBy del servidor', async () => {
    const repo = seedRepo();
    repo.grants.push(grant());
    // El dispositivo intenta falsear la autorización; se ignora.
    const op = mov({ grantId: 'falso', authorizedBy: 'falso' }, VEN, '2026-10-22T17:30:00.000Z');
    const r = await apply(repo, op);
    expect(r.status).toBe('applied');
    const m = [...repo.movements.values()][0]!;
    expect(m.grantId).toBe('g-1');
    expect(m.authorizedBy).toBe(GER);
    expect(m.userId).toBe(VEN);
    expect(repo.qty(V1, B1)).toBe(15);
  });

  it('permiso vencido a la hora local de la operación (aunque hoy esté vigente) se rechaza', async () => {
    const repo = seedRepo();
    repo.grants.push(grant({ startsAt: '2026-10-22T17:45:00.000Z' }));
    const r = await apply(repo, mov({}, VEN, '2026-10-22T17:30:00.000Z')); // antes de que iniciara
    expect(r.conflictKind).toBe('sin_permiso');
  });

  it('permiso revocado antes de la operación se rechaza', async () => {
    const repo = seedRepo();
    repo.grants.push(grant({ revokedAt: '2026-10-22T17:10:00.000Z' }));
    expect((await apply(repo, mov({}, VEN))).status).toBe('rejected');
  });

  it('una hora local en el futuro no sirve para "caer" dentro de un permiso futuro', async () => {
    const repo = seedRepo();
    repo.grants.push(grant({ startsAt: '2026-10-22T20:00:00.000Z', expiresAt: '2026-10-22T21:00:00.000Z' }));
    const r = await apply(repo, mov({}, VEN, '2026-10-22T20:30:00.000Z')); // ahora son las 18:00
    expect(r.conflictKind).toBe('sin_permiso');
  });

  it('permiso de otra sucursal no vale', async () => {
    const repo = seedRepo();
    repo.grants.push(grant({ branchId: B2 }));
    expect((await apply(repo, mov({}, VEN))).status).toBe('rejected');
  });

  it('el vendedor nunca puede hacer salidas ni ajustes, ni con permiso', async () => {
    const repo = seedRepo();
    repo.grants.push(grant());
    expect((await apply(repo, mov({ type: 'salida', delta: -1 }, VEN))).conflictKind).toBe('sin_permiso');
    expect((await apply(repo, mov({ type: 'ajuste', delta: 3 }, VEN))).conflictKind).toBe('sin_permiso');
  });

  it('el desarrollador no mueve inventario', async () => {
    const repo = seedRepo();
    expect((await apply(repo, mov({}, DEV))).status).toBe('rejected');
  });

  it('delta incoherente con el tipo se rechaza', async () => {
    const repo = seedRepo();
    expect((await apply(repo, mov({ type: 'entrada', delta: -4 }))).conflictKind).toBe('delta_invalido');
  });

  it('una salida que deja negativo se aplica y avisa (ya ocurrió)', async () => {
    const repo = seedRepo();
    const r = await apply(repo, mov({ type: 'salida', delta: -50 }));
    expect(r.status).toBe('conflict');
    expect(r.conflictKind).toBe('stock_negativo');
    expect(repo.qty(V1, B1)).toBe(-40);
  });

  it('un conteo cuyo resultado difiere de lo contado genera conflicto', async () => {
    const repo = seedRepo();
    const r = await apply(repo, mov({ type: 'conteo', delta: -2, countedQty: 5, expectedQty: 7 })); // el servidor tenía 10 → 8
    expect(r.conflictKind).toBe('conteo_difiere');
  });
});

describe('ajustes: cancelaciones y devoluciones', () => {
  async function withSale(qty = 2) {
    const repo = seedRepo();
    const sale = makeSale({ qty });
    await apply(repo, saleOp(sale));
    return { repo, sale };
  }
  const adjOp = (sale: ReturnType<typeof makeSale>, over: Record<string, unknown> = {}, userId = GER): SyncOp => ({
    opId: uid(), type: 'sale.adjust', branchId: B1, terminalId: T1, userId, localTs: '2026-10-22T17:40:00.000Z',
    payload: {
      adjustment: {
        id: uid(), saleId: sale.id, branchId: B1, terminalId: T1, userId, type: 'cancelacion', createdAt: '2026-10-22T17:40:00.000Z', reason: 'Cliente se arrepintió',
        amountCents: sale.totalCents, payments: [{ method: 'efectivo', amountCents: sale.totalCents }],
        items: sale.items.map((i) => ({ saleItemId: i.id, variantId: i.variantId, productName: i.productName, variantLabel: i.variantLabel, qty: i.qty, unitCostCents: i.unitCostCents, netCents: i.netCents, restock: true })),
        cashSessionId: null, ...over,
      },
    },
  });

  it('cancelar regresa existencias, marca la venta cancelada y NO la borra', async () => {
    const { repo, sale } = await withSale(2);
    expect(repo.qty(V1, B1)).toBe(8);
    const r = await apply(repo, adjOp(sale));
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(10);
    expect(repo.sales.get(sale.id)!.status).toBe('cancelada');
    expect(repo.adjustments.size).toBe(1);
  });

  it('cancelar dos veces con ajustes distintos: el segundo se rechaza (no regresa existencias dos veces)', async () => {
    const { repo, sale } = await withSale(2);
    await apply(repo, adjOp(sale));
    const r = await apply(repo, adjOp(sale));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('ya_cancelada');
    expect(repo.qty(V1, B1)).toBe(10);
  });

  it('reenviar el mismo ajuste es idempotente', async () => {
    const { repo, sale } = await withSale(2);
    const op = adjOp(sale);
    await apply(repo, op);
    expect((await apply(repo, op)).status).toBe('duplicate');
    expect(repo.qty(V1, B1)).toBe(10);
  });

  it('el vendedor no puede cancelar', async () => {
    const { repo, sale } = await withSale(2);
    const r = await apply(repo, adjOp(sale, {}, VEN));
    expect(r.conflictKind).toBe('sin_permiso');
    expect(repo.qty(V1, B1)).toBe(8);
  });

  it('devolución parcial con restock=false no regresa existencias', async () => {
    const { repo, sale } = await withSale(2);
    const item = sale.items[0]!;
    const r = await apply(
      repo,
      adjOp(sale, { type: 'devolucion', amountCents: 9000, payments: [{ method: 'efectivo', amountCents: 9000 }], items: [{ saleItemId: item.id, variantId: item.variantId, productName: 'Vela', variantLabel: 'Chica', qty: 1, unitCostCents: 4000, netCents: 9000, restock: false }] }),
    );
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(8);
    expect(repo.sales.get(sale.id)!.status).toBe('completada');
  });

  it('devolver más de lo vendido se rechaza', async () => {
    const { repo, sale } = await withSale(2);
    const item = sale.items[0]!;
    const r = await apply(
      repo,
      adjOp(sale, { type: 'devolucion', amountCents: 27000, payments: [{ method: 'efectivo', amountCents: 27000 }], items: [{ saleItemId: item.id, variantId: item.variantId, productName: 'Vela', variantLabel: 'Chica', qty: 3, unitCostCents: 4000, netCents: 27000, restock: true }] }),
    );
    expect(r.conflictKind).toBe('devolucion_excedida');
  });

  it('un importe distinto al calculado se aplica pero avisa', async () => {
    const { repo, sale } = await withSale(2);
    const r = await apply(repo, adjOp(sale, { amountCents: 100, payments: [{ method: 'efectivo', amountCents: 100 }] }));
    expect(r.status).toBe('conflict');
    expect(repo.conflictKinds()).toContain('importe_ajuste_distinto');
  });

  it('ajuste de una venta inexistente se rechaza', async () => {
    const repo = seedRepo();
    const fake = makeSale();
    expect((await apply(repo, adjOp(fake))).conflictKind).toBe('venta_no_encontrada');
  });
});

describe('caja', () => {
  const SES = 'ses-0001';
  const openOp = (over: Record<string, unknown> = {}, userId = GER): SyncOp => ({
    opId: uid(), type: 'cash.open', branchId: B1, terminalId: T1, userId, localTs: '2026-10-22T14:00:00.000Z',
    payload: { session: { id: SES, branchId: B1, terminalId: T1, openedBy: userId, openedAt: '2026-10-22T14:00:00.000Z', openingCents: 50000, ...over } },
  });
  const closeOp = (over: Record<string, unknown> = {}, userId = GER): SyncOp => ({
    opId: uid(), type: 'cash.close', branchId: B1, terminalId: T1, userId, localTs: '2026-10-22T18:00:00.000Z',
    payload: { sessionId: SES, closedBy: userId, closedAt: '2026-10-22T18:00:00.000Z', countedCents: 68000, ...over },
  });

  it('abrir, vender, mover y cortar: el esperado lo calcula el servidor (solo efectivo)', async () => {
    const repo = seedRepo();
    expect((await apply(repo, openOp())).status).toBe('applied');
    await apply(repo, saleOp(makeSale({ qty: 2, sessionId: SES }))); // +18000 efectivo
    const card = makeSale({ qty: 1, sessionId: SES });
    card.payments = [{ method: 'tarjeta', amountCents: 9000 }];
    card.tenderedCents = 0;
    await apply(repo, saleOp(card)); // tarjeta: no entra al cajón
    await apply(repo, {
      opId: uid(), type: 'cash.movement', branchId: B1, terminalId: T1, userId: GER, localTs: '2026-10-22T16:00:00.000Z',
      payload: { movement: { id: 'm-1', sessionId: SES, type: 'retiro', amountCents: 5000, concept: 'Retiro parcial', userId: GER, createdAt: '2026-10-22T16:00:00.000Z' } },
    });
    // esperado = 50000 + 18000 - 5000 = 63000
    const r = await apply(repo, closeOp({ countedCents: 62000, expectedCents: 63000 }));
    expect(r.status).toBe('applied');
    const closed = repo.closed.get(SES)!;
    expect(closed.expectedCents).toBe(63000);
    expect(closed.differenceCents).toBe(-1000);
    expect(closed.provisional).toBe(false);
    expect(closed.reconciliation).toBe('conciliado');
  });

  it('si el esperado de la terminal difiere, se cierra como provisional con conflicto', async () => {
    const repo = seedRepo();
    await apply(repo, openOp());
    const r = await apply(repo, closeOp({ countedCents: 50000, expectedCents: 99999 }));
    expect(r.status).toBe('conflict');
    expect(r.conflictKind).toBe('corte_difiere');
    expect(repo.closed.get(SES)!.provisional).toBe(true);
    expect(repo.closed.get(SES)!.expectedCents).toBe(50000);
  });

  it('el vendedor NO puede hacer cortes', async () => {
    const repo = seedRepo();
    await apply(repo, openOp());
    const r = await apply(repo, closeOp({}, VEN));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('sin_permiso');
    expect(repo.closed.size).toBe(0);
  });

  it('un segundo corte de la misma sesión se rechaza; el mismo corte reenviado es duplicate', async () => {
    const repo = seedRepo();
    await apply(repo, openOp());
    const c1 = closeOp();
    expect((await apply(repo, c1)).status).toBe('applied');
    expect((await apply(repo, c1)).status).toBe('duplicate');
    expect((await apply(repo, closeOp())).conflictKind).toBe('ya_cerrada');
  });

  it('abrir caja en una terminal que ya tiene una abierta conserva la sesión como duplicada y avisa', async () => {
    const repo = seedRepo();
    await apply(repo, openOp());
    const r = await apply(repo, openOp({ id: 'ses-0002' }));
    expect(r.conflictKind).toBe('caja_duplicada');
    expect(repo.sessions.get('ses-0002')!.duplicateOpen).toBe(true);
    expect(repo.sessions.get('ses-0001')!.status).toBe('abierta');
  });

  it('un vendedor no abre caja ni registra movimientos', async () => {
    const repo = seedRepo();
    expect((await apply(repo, openOp({}, VEN))).conflictKind).toBe('sin_permiso');
  });

  it('terminal desconocida en cash.open se rechaza', async () => {
    const repo = seedRepo();
    repo.terminals.delete(T1);
    expect((await apply(repo, openOp())).conflictKind).toBe('terminal_desconocida');
  });
});
