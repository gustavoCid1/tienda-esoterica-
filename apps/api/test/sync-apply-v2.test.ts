/** v2: vendedor/tipo de venta, líneas extra, Limpias y autorización (admin o token) en cierre, cancelación y devolución. */
import { describe, expect, it } from 'vitest';
import { generateTokenSalt, hashTokenCode } from '@amara/shared';
import type { CachedSecurityToken, Sale, SyncOp } from '@amara/shared';
import { applySyncOp } from '../src/sync-apply.ts';
import { B1, B2, ctxTerminal, GER, makeSale, now, saleOp, seedRepo, T1, uid, V1, VEN } from './fixtures.ts';

const apply = (repo: ReturnType<typeof seedRepo>, op: SyncOp) => applySyncOp(repo, op, ctxTerminal);
const SES = 'ses-v2';
const LOCAL = '2026-10-22T17:00:00.000Z'; // hora local de las operaciones (el servidor "ahora" es 18:00)

function token(over: Partial<CachedSecurityToken> = {}): CachedSecurityToken {
  const salt = generateTokenSalt();
  return {
    id: 'tok-1', label: 'Cierre', purposes: ['cierre_caja', 'cancelacion', 'devolucion', 'limpias'], branchId: B1, forUserId: null, createdBy: GER,
    createdAt: '2026-10-22T16:00:00.000Z', expiresAt: '2026-10-22T20:00:00.000Z', revokedAt: null, maxUses: null, usedCount: 0, salt, hash: hashTokenCode('ABCD2345', salt), ...over,
  };
}
const withToken = (over: Partial<CachedSecurityToken> = {}) => {
  const repo = seedRepo();
  const t = token(over);
  repo.tokens.set(t.id, t);
  return { repo, t };
};

/** Venta con un producto (2 × $90) y un extra de $25 sobre el mismo producto. */
function saleWithExtra(over: Partial<Sale> = {}): Sale {
  const id = uid();
  return {
    id, folio: `AMA-A${T1}-261022-${id.slice(-4)}`, branchId: B1, terminalId: T1, userId: VEN, userName: 'Vendedora', cashSessionId: null, createdAt: LOCAL,
    subtotalCents: 20500, discountCents: 0, totalCents: 20500, tenderedCents: 20500, changeCents: 0, status: 'completada',
    sellerId: VEN, sellerName: 'Vendedora', type: 'venta',
    items: [
      { id: `${id}:0`, variantId: V1, productName: 'Vela', variantLabel: 'Chica', sku: 'VEL', code: 'AMA1', qty: 2, unitPriceCents: 9000, unitCostCents: 4000, lineDiscountCents: 0, netCents: 18000, kind: 'producto', extraNote: null },
      { id: `${id}:1`, variantId: V1, productName: 'Vela', variantLabel: 'Chica', sku: 'VEL', code: 'AMA1', qty: 1, unitPriceCents: 2500, unitCostCents: 0, lineDiscountCents: 0, netCents: 2500, kind: 'extra', extraNote: 'Aceite' },
    ],
    payments: [{ method: 'efectivo', amountCents: 20500, tenderedCents: 20500, changeCents: 0 }],
    ...over,
  };
}
const withAuth = (op: SyncOp, authorization: unknown): SyncOp => ({ ...op, payload: { ...(op.payload as object), authorization } });

describe('venta con vendedor, tipo y líneas extra', () => {
  it('se aplica: guarda vendedor/tipo/kind; el extra suma al total pero NO descuenta existencias', async () => {
    const repo = seedRepo();
    const sale = saleWithExtra();
    const r = await apply(repo, saleOp(sale));
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(8);
    expect(repo.movements.size).toBe(1);
    expect([...repo.movements.keys()]).toEqual([`${sale.id}:m0`]);
    const stored = repo.sales.get(sale.id)!;
    expect(stored.sellerId).toBe(VEN);
    expect(stored.sellerName).toBe('Vendedora');
    expect(stored.items.map((i) => i.kind)).toEqual(['producto', 'extra']);
    expect(stored.items[1]!.extraNote).toBe('Aceite');
    expect(stored.totalCents).toBe(20500);
    const audit = repo.audits.get(`${r.opId}:venta`)!;
    expect((audit.detail as any).extras).toBe(1);
  });

  it('un extra sobre un producto sin existencia NO genera stock_negativo ni conflicto', async () => {
    const repo = seedRepo();
    repo.stock.set(`${V1}|${B1}`, 0);
    const sale = saleWithExtra();
    // Solo el extra: no mueve inventario.
    sale.items = [sale.items[1]!];
    sale.subtotalCents = sale.totalCents = sale.tenderedCents = 2500;
    sale.payments = [{ method: 'efectivo', amountCents: 2500, tenderedCents: 2500, changeCents: 0 }];
    const r = await apply(repo, saleOp(sale));
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(0);
    expect(repo.movements.size).toBe(0);
  });

  it('un extra con cantidad 2 o con costo se rechaza (importes inconsistentes)', async () => {
    for (const mutate of [(s: Sale) => { s.items[1]!.qty = 2; s.items[1]!.netCents = 5000; }, (s: Sale) => { s.items[1]!.unitCostCents = 100; }]) {
      const repo = seedRepo();
      const sale = saleWithExtra();
      mutate(sale);
      const r = await apply(repo, saleOp(sale));
      expect(r.status).toBe('rejected');
      expect(r.conflictKind).toBe('importes_inconsistentes');
      expect(repo.sales.size).toBe(0);
    }
  });

  it('una venta V1 (sin vendedor, tipo ni kind) se sigue aplicando igual', async () => {
    const repo = seedRepo();
    expect((await apply(repo, saleOp(makeSale({ qty: 2 })))).status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(8);
  });

  it('el stock negativo por una venta ya ocurrida sigue generando conflicto y se aplica (excepción documentada)', async () => {
    const repo = seedRepo();
    repo.stock.set(`${V1}|${B1}`, 1);
    const r = await apply(repo, saleOp(makeSale({ qty: 3 })));
    expect(r.status).toBe('conflict');
    expect(r.conflictKind).toBe('stock_negativo');
    expect(repo.qty(V1, B1)).toBe(-2);
  });
});

describe('Limpias', () => {
  const limpia = (userId = VEN) => saleWithExtra({ type: 'limpia', userId, sellerId: userId });

  it('gerente: sin autorización y sin conflicto', async () => {
    const repo = seedRepo();
    const r = await apply(repo, saleOp(limpia(GER)));
    expect(r.status).toBe('applied');
    expect(repo.sales.values().next().value!.type).toBe('limpia');
  });

  it('vendedor con token "limpias" vigente: aplica, cuenta el uso y audita quién autorizó', async () => {
    const { repo, t } = withToken({ purposes: ['limpias'] });
    const op = withAuth(saleOp(limpia()), { kind: 'token', tokenId: t.id });
    const r = await apply(repo, op);
    expect(r.status).toBe('applied');
    expect(repo.tokens.get(t.id)!.usedCount).toBe(1);
    const a = repo.audits.get(`${op.opId}:autorizacion`)!;
    expect(a.action).toBe('autorizacion.limpias');
    expect((a.detail as any).valid).toBe(true);
    expect((a.detail as any).authorizedBy).toBe(GER);
  });

  it('vendedor con contraseña de un gerente (adminUserId) de la sucursal: aplica', async () => {
    const repo = seedRepo();
    const r = await apply(repo, withAuth(saleOp(limpia()), { kind: 'admin_password', adminUserId: GER }));
    expect(r.status).toBe('applied');
  });

  it('vendedor con token de otro propósito, sin autorización o con basura: la venta YA ocurrió, se aplica y queda conflicto', async () => {
    const { repo, t } = withToken({ purposes: ['cierre_caja'] });
    for (const authorization of [{ kind: 'token', tokenId: t.id }, undefined, { kind: 'token' }, 'hola', { kind: 'admin_password', adminUserId: VEN }]) {
      const sale = limpia();
      const op = authorization === undefined ? saleOp(sale) : withAuth(saleOp(sale), authorization);
      const r = await apply(repo, op);
      expect(r.status).toBe('conflict');
      expect(r.conflictKind).toBe('autorizacion_invalida');
      expect(repo.sales.has(sale.id)).toBe(true);
      expect([...repo.conflicts.values()].find((c) => c.opId === op.opId)!.rejected).toBe(false);
    }
    expect(repo.tokens.get(t.id)!.usedCount).toBe(0);
  });
});

describe('cierre de caja con autorización', () => {
  const open = (repo: ReturnType<typeof seedRepo>) =>
    apply(repo, { opId: uid(), type: 'cash.open', branchId: B1, terminalId: T1, userId: GER, localTs: '2026-10-22T14:00:00.000Z', payload: { session: { id: SES, branchId: B1, terminalId: T1, openedBy: GER, openedAt: '2026-10-22T14:00:00.000Z', openingCents: 50000 } } });
  const closeOp = (userId: string, authorization?: unknown, localTs = LOCAL): SyncOp => ({
    opId: uid(), type: 'cash.close', branchId: B1, terminalId: T1, userId, localTs,
    payload: { sessionId: SES, closedBy: userId, closedAt: localTs, countedCents: 50000, ...(authorization === undefined ? {} : { authorization }) },
  });

  it('vendedor con token vigente a la hora LOCAL: cierra y la sesión guarda quién autorizó', async () => {
    const { repo, t } = withToken({ purposes: ['cierre_caja'], expiresAt: '2026-10-22T17:30:00.000Z' }); // vencido hoy a las 18:00, pero vigente a las 17:00
    await open(repo);
    const op = closeOp(VEN, { kind: 'token', tokenId: t.id });
    const r = await apply(repo, op);
    expect(r.status).toBe('applied');
    const closed = repo.sessions.get(SES)! as any;
    expect(closed.status).toBe('cerrada');
    expect(closed.closedBy).toBe(VEN);
    expect(closed.closeAuthorization).toEqual({ kind: 'token', tokenId: t.id });
    expect(closed.closeAuthorizedBy).toBe(GER);
    expect(repo.tokens.get(t.id)!.usedCount).toBe(1);
    expect(repo.audits.get(`${op.opId}:autorizacion`)!.action).toBe('autorizacion.cierre_caja');
  });

  it('vendedor con contraseña de admin: cierra y queda el gerente como autorizador', async () => {
    const repo = seedRepo();
    await open(repo);
    const r = await apply(repo, closeOp(VEN, { kind: 'admin_password', adminUserId: GER }));
    expect(r.status).toBe('applied');
    expect((repo.sessions.get(SES) as any).closeAuthorization).toEqual({ kind: 'admin_password', adminUserId: GER });
    expect((repo.sessions.get(SES) as any).closeAuthorizedBy).toBe(GER);
  });

  it('el gerente no necesita autorización: él mismo queda como autorizador', async () => {
    const repo = seedRepo();
    await open(repo);
    expect((await apply(repo, closeOp(GER))).status).toBe('applied');
    expect((repo.sessions.get(SES) as any).closeAuthorization).toEqual({ kind: 'admin_password', adminUserId: GER });
  });

  it('vendedor SIN autorización sigue siendo rechazado y la caja queda abierta', async () => {
    const repo = seedRepo();
    await open(repo);
    const r = await apply(repo, closeOp(VEN));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('sin_permiso');
    expect(repo.sessions.get(SES)!.status).toBe('abierta');
  });

  const invalids: [string, Partial<CachedSecurityToken>, string?][] = [
    ['token de otro propósito', { purposes: ['devolucion'] }],
    ['token de otra sucursal', { branchId: B2 }],
    ['token solo para otro usuario', { forUserId: GER }],
    ['token vencido antes de la operación', { expiresAt: '2026-10-22T16:59:00.000Z' }],
    ['token revocado antes de la operación', { revokedAt: '2026-10-22T16:50:00.000Z' }],
    ['token creado DESPUÉS de la operación', { createdAt: '2026-10-22T17:30:00.000Z', expiresAt: '2026-10-22T20:00:00.000Z' }],
    ['token sin usos disponibles', { maxUses: 1, usedCount: 1 }],
  ];
  for (const [name, over] of invalids) {
    it(`${name}: el cierre ya ocurrió → se aplica y queda conflicto autorizacion_invalida`, async () => {
      const { repo, t } = withToken(over);
      await open(repo);
      const r = await apply(repo, closeOp(VEN, { kind: 'token', tokenId: t.id }));
      expect(r.status).toBe('conflict');
      expect(r.conflictKind).toBe('autorizacion_invalida');
      expect(repo.sessions.get(SES)!.status).toBe('cerrada');
      expect((repo.sessions.get(SES) as any).closeAuthorization).toBeNull();
      expect(repo.tokens.get(t.id)!.usedCount).toBe(over.usedCount ?? 0);
    });
  }

  it('token revocado DESPUÉS de la operación sigue siendo válido para esa operación', async () => {
    const { repo, t } = withToken({ revokedAt: '2026-10-22T17:45:00.000Z' });
    await open(repo);
    expect((await apply(repo, closeOp(VEN, { kind: 'token', tokenId: t.id }))).status).toBe('applied');
  });

  it('admin inexistente, inactivo, vendedor o de otra sucursal: conflicto', async () => {
    for (const mutate of [
      (r: ReturnType<typeof seedRepo>) => r.users.delete(GER),
      (r: ReturnType<typeof seedRepo>) => r.users.set(GER, { id: GER, name: 'G', role: 'gerente', active: false, branchIds: [B1] }),
      (r: ReturnType<typeof seedRepo>) => r.users.set(GER, { id: GER, name: 'G', role: 'gerente', active: true, branchIds: [B2] }),
    ]) {
      const repo = seedRepo();
      await open(repo);
      mutate(repo);
      const r = await apply(repo, closeOp(VEN, { kind: 'admin_password', adminUserId: GER }));
      expect(r.conflictKind).toBe('autorizacion_invalida');
      expect(repo.sessions.get(SES)!.status).toBe('cerrada');
    }
    const repo = seedRepo();
    await open(repo);
    expect((await apply(repo, closeOp(VEN, { kind: 'admin_password', adminUserId: VEN }))).conflictKind).toBe('autorizacion_invalida');
  });

  it('idempotencia: reenviar el mismo cierre no cuenta dos veces el uso del token', async () => {
    const { repo, t } = withToken({ maxUses: 1 });
    await open(repo);
    const op = closeOp(VEN, { kind: 'token', tokenId: t.id });
    expect((await apply(repo, op)).status).toBe('applied');
    expect((await apply(repo, op)).status).toBe('duplicate');
    expect(repo.tokens.get(t.id)!.usedCount).toBe(1);
  });

  it('el desarrollador nunca cierra caja, ni con autorización', async () => {
    const repo = seedRepo();
    await open(repo);
    const r = await apply(repo, closeOp('a0000003-0000-4000-8000-000000000003', { kind: 'admin_password', adminUserId: GER }));
    expect(r.status).toBe('rejected');
    expect(r.conflictKind).toBe('sin_permiso');
  });
});

describe('cancelación y devolución con autorización', () => {
  async function withSale(over: Partial<CachedSecurityToken> = {}) {
    const { repo, t } = withToken(over);
    const sale = saleWithExtra({ userId: GER, sellerId: VEN });
    await apply(repo, saleOp(sale));
    return { repo, t, sale };
  }
  const adjOp = (sale: Sale, kind: 'cancelacion' | 'devolucion', userId: string, authorization?: unknown, items?: any[], amount?: number): SyncOp => ({
    opId: uid(), type: 'sale.adjust', branchId: B1, terminalId: T1, userId, localTs: LOCAL,
    payload: {
      adjustment: {
        id: uid(), saleId: sale.id, branchId: B1, terminalId: T1, userId, type: kind, createdAt: LOCAL, reason: 'Cliente se arrepintió',
        amountCents: amount ?? sale.totalCents, payments: [{ method: 'efectivo', amountCents: amount ?? sale.totalCents }],
        items: items ?? sale.items.map((i) => ({ saleItemId: i.id, variantId: i.variantId, productName: i.productName, variantLabel: i.variantLabel, qty: i.qty, unitCostCents: i.unitCostCents, netCents: i.netCents, restock: i.kind !== 'extra', kind: i.kind })),
        cashSessionId: null,
      },
      ...(authorization === undefined ? {} : { authorization }),
    },
  });

  it('vendedor cancela con token de cancelación: regresa existencias SOLO del producto (no del extra) y guarda la autorización', async () => {
    const { repo, t, sale } = await withSale();
    expect(repo.qty(V1, B1)).toBe(8);
    const op = adjOp(sale, 'cancelacion', VEN, { kind: 'token', tokenId: t.id });
    const r = await apply(repo, op);
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(10);
    expect(repo.sales.get(sale.id)!.status).toBe('cancelada');
    const adj = [...repo.adjustments.values()][0]! as any;
    expect(adj.authorization).toEqual({ kind: 'token', tokenId: t.id });
    expect(adj.authorizedBy).toBe(GER);
    expect(repo.tokens.get(t.id)!.usedCount).toBe(1);
    expect([...repo.movements.values()].filter((m) => m.type === 'devolucion').map((m) => m.delta)).toEqual([2]);
  });

  it('aunque el ajuste marque restock=true en un extra, no regresa existencias', async () => {
    const { repo, sale } = await withSale();
    const extra = sale.items[1]!;
    const r = await apply(repo, adjOp(sale, 'devolucion', GER, undefined, [{ saleItemId: extra.id, variantId: extra.variantId, productName: 'Vela', variantLabel: 'Chica', qty: 1, unitCostCents: 0, netCents: 2500, restock: true }], 2500));
    expect(r.status).toBe('applied');
    expect(repo.qty(V1, B1)).toBe(8);
    expect(repo.sales.get(sale.id)!.status).toBe('completada');
  });

  it('vendedor devuelve con contraseña de admin: aplica; con token de otro propósito: aplica con conflicto; sin nada: rechazado', async () => {
    const { repo, t, sale } = await withSale({ purposes: ['cierre_caja'] });
    const line = sale.items[0]!;
    const refund = (authorization?: unknown) =>
      adjOp(sale, 'devolucion', VEN, authorization, [{ saleItemId: line.id, variantId: line.variantId, productName: 'Vela', variantLabel: 'Chica', qty: 1, unitCostCents: 4000, netCents: 9000, restock: true }], 9000);
    const sinAuth = await apply(repo, refund());
    expect(sinAuth.status).toBe('rejected');
    expect(sinAuth.conflictKind).toBe('sin_permiso');
    const malo = await apply(repo, refund({ kind: 'token', tokenId: t.id }));
    expect(malo.status).toBe('conflict');
    expect(malo.conflictKind).toBe('autorizacion_invalida');
    expect(repo.adjustments.size).toBe(1);
    const bueno = await apply(repo, refund({ kind: 'admin_password', adminUserId: GER }));
    expect(bueno.status).toBe('applied');
    expect(repo.adjustments.size).toBe(2);
  });

  it('token con un solo uso: la segunda devolución ya ocurrida se aplica pero avisa', async () => {
    const { repo, t, sale } = await withSale({ maxUses: 1 });
    const line = sale.items[0]!;
    const refund = () =>
      adjOp(sale, 'devolucion', VEN, { kind: 'token', tokenId: t.id }, [{ saleItemId: line.id, variantId: line.variantId, productName: 'Vela', variantLabel: 'Chica', qty: 1, unitCostCents: 4000, netCents: 9000, restock: true }], 9000);
    expect((await apply(repo, refund())).status).toBe('applied');
    const second = await apply(repo, refund());
    expect(second.status).toBe('conflict');
    expect(second.conflictKind).toBe('autorizacion_invalida');
    expect(repo.adjustments.size).toBe(2);
    expect(repo.tokens.get(t.id)!.usedCount).toBe(1);
  });

  it('el gerente no necesita autorización; queda él como autorizador', async () => {
    const { repo, sale } = await withSale();
    expect((await apply(repo, adjOp(sale, 'cancelacion', GER))).status).toBe('applied');
    expect(([...repo.adjustments.values()][0] as any).authorizedBy).toBe(GER);
  });
});

void now;
