import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newId, mxDayBounds } from '@amara/shared';
import { StoreError } from '../src/types.ts';
import { B1, B2, T1, V_CH, V_GR, gerente, vendedor, dev, readyStore, newStore, pullPayload, Clock } from './helpers.ts';

const cash = (n: number) => [{ method: 'efectivo' as const, amountCents: n, tenderedCents: n }];

test('catálogo: producto con dos tamaños y existencias distintas por sucursal', async () => {
  const { store } = await readyStore();
  const b1 = await store.inventoryList({ branchId: B1 });
  const b2 = await store.inventoryList({ branchId: B2 });
  assert.deepEqual(b1.map((r) => [r.label, r.qty]), [['Chica', 10], ['Grande', 4]]);
  assert.deepEqual(b2.map((r) => [r.label, r.qty]), [['Chica', 2], ['Grande', 7]]);
  assert.equal((await store.inventoryList({ branchId: B2, filter: 'bajos' })).length, 1); // Chica: 2 <= 3
});

test('lectura de códigos: barras, interno, QR y desconocido', async () => {
  const { store } = await readyStore();
  assert.equal((await store.findByCode('7501234567890', B1))[0]?.variantId, V_CH);
  assert.equal((await store.findByCode('ama00000002', B1))[0]?.variantId, V_GR);
  assert.equal((await store.findByCode(`amara:v1:${V_GR}`, B1))[0]?.label, 'Grande');
  assert.equal((await store.findByCode('000', B1)).length, 0);
  assert.equal((await store.search('vela', B1)).length, 2);
});

test('venta: guarda todo, descuenta inventario y genera ticket con folio', async () => {
  const { store } = await readyStore();
  const saleId = newId();
  const r = await store.registerSale({
    saleId, actor: vendedor, branchId: B1, terminalId: T1,
    items: [{ variantId: V_CH, qty: 2 }, { variantId: V_GR, qty: 1 }],
    payments: [{ method: 'efectivo', amountCents: 33000, tenderedCents: 50000 }],
  });
  assert.equal(r.sale.totalCents, 33000);
  assert.equal(r.sale.changeCents, 17000);
  assert.match(r.sale.folio, /^AMA-AP1-261022-0001$/);
  assert.equal(await store.stockQty(V_CH, B1), 8);
  assert.equal(await store.stockQty(V_GR, B1), 3);
  assert.equal(await store.stockQty(V_CH, B2), 2, 'la otra sucursal no cambia');
  const t = await store.getTicket(saleId);
  assert.equal(t?.payload.totalCents, 33000);
  assert.equal((await store.pendingCount()) >= 1, true);
  const audit = await store.auditRecent();
  assert.ok(audit.some((a) => a.action === 'venta.crear'));
});

test('idempotencia: reintentar la misma venta no duplica nada', async () => {
  const { store } = await readyStore();
  const saleId = newId();
  const input = { saleId, actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) };
  const a = await store.registerSale(input);
  const b = await store.registerSale(input);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.sale.folio, a.sale.folio);
  assert.equal(await store.stockQty(V_CH, B1), 9);
  const n = await store.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales');
  assert.equal(n?.n, 1);
  const q = await store.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE type = 'sale.create'");
  assert.equal(q?.n, 1);
});

test('ventas simultáneas: folios únicos e inventario consistente', async () => {
  const { store } = await readyStore();
  const jobs = Array.from({ length: 8 }, () =>
    store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) }),
  );
  const results = await Promise.all(jobs);
  const folios = new Set(results.map((r) => r.sale.folio));
  assert.equal(folios.size, 8);
  assert.equal(await store.stockQty(V_CH, B1), 2);
});

test('v2: una venta nueva que supera la existencia se rechaza (nunca queda negativa); el servidor sí acepta lo ya ocurrido', async () => {
  const { store } = await readyStore();
  // Hay 4 grandes en la sucursal 1: pedir 5 se rechaza sin guardar nada.
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 5 }], payments: cash(75000) }),
    (e: unknown) => e instanceof StoreError && e.code === 'sin_existencia' && e.data?.available === 4 && e.data?.variantId === V_GR,
  );
  assert.equal(await store.stockQty(V_GR, B1), 4);
  assert.equal((await store.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales'))?.n, 0);
  assert.equal((await store.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE type = 'sale.create'"))?.n, 0);
  // Exactamente lo disponible sí se vende.
  const ok = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 4 }], payments: cash(60000) });
  assert.deepEqual(ok.warnings, []);
  assert.equal(await store.stockQty(V_GR, B1), 0);
  // En 0 ya no se vende ni una pieza.
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) }),
    (e: unknown) => e instanceof StoreError && e.code === 'sin_existencia' && e.data?.available === 0,
  );
});

test('v2: la misma variante repartida en varias líneas se suma contra la existencia', async () => {
  const { store } = await readyStore();
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 3 }, { variantId: V_GR, qty: 2 }], payments: cash(75000) }),
    (e: unknown) => e instanceof StoreError && e.code === 'sin_existencia',
  );
});

test('v2: una existencia negativa heredada bloquea la venta y se ve tal cual en el inventario', async () => {
  const { store } = await readyStore();
  const p = pullPayload();
  p.stock = p.stock.map((s) => (s.variantId === V_GR && s.branchId === B1 ? { ...s, qty: -2 } : s));
  await store.applyPull(p);
  assert.equal(await store.stockQty(V_GR, B1), -2);
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) }),
    (e: unknown) => e instanceof StoreError && e.code === 'sin_existencia' && e.data?.available === 0 && e.data?.rawAvailable === -2,
  );
});

test('v2: el único caso con existencia negativa es aplicar una venta ya ocurrida (réplica LAN): se aplica tal cual', async () => {
  const phone = await readyStore();
  await phone.store.setDeviceInfo({ branchId: B1, branchCode: 'A', terminalId: T1, terminalCode: 'M1' }); // otro código = otros folios
  const pc = await readyStore();
  // El teléfono tenía 4 grandes y vendió 4; en la PC otra venta ya dejó solo 1 (la mercancía ya salió físicamente).
  await pc.store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 3 }], payments: cash(45000) });
  await phone.store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 4 }], payments: cash(60000) });
  const op = (await phone.store.nextPending()).find((o) => o.type === 'sale.create')!;
  assert.equal((await pc.store.ingestRemoteSale(op)).duplicate, false);
  assert.equal(await pc.store.stockQty(V_GR, B1), -3);
});

test('caja cerrada bloquea ventas; vendedor no puede abrir caja ni cortar', async () => {
  const { store } = await newStore();
  await store.applyPull(pullPayload());
  await store.setDeviceInfo({ branchId: B1, branchCode: 'A', terminalId: T1, terminalCode: 'P1' });
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) }),
    (e: unknown) => e instanceof StoreError && e.code === 'caja_cerrada',
  );
  await assert.rejects(store.openCash({ actor: vendedor, branchId: B1, terminalId: T1, openingCents: 0 }), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  await store.openCash({ actor: gerente, branchId: B1, terminalId: T1, openingCents: 50000 });
  // v2: el vendedor sin contraseña de admin ni token no puede cortar; el desarrollador nunca.
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 50000 }), (e: unknown) => e instanceof StoreError && e.code === 'autorizacion_requerida');
  await assert.rejects(store.closeCash({ actor: dev, terminalId: T1, countedCents: 50000 }), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  await assert.rejects(store.openCash({ actor: gerente, branchId: B1, terminalId: T1, openingCents: 1 }), (e: unknown) => e instanceof StoreError && e.code === 'caja_abierta');
});

test('permisos: vendedor no cancela ni da descuentos; desarrollador no vende', async () => {
  const { store } = await readyStore();
  const s = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  await assert.rejects(store.cancelSale({ saleId: s.sale.id, actor: vendedor, terminalId: T1, reason: 'error' }), (e: unknown) => e instanceof StoreError && e.code === 'autorizacion_requerida');
  await assert.rejects(store.cancelSale({ saleId: s.sale.id, actor: dev, terminalId: T1, reason: 'error' }), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  await assert.rejects(store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], discountCents: 500, payments: cash(8500) }), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  await assert.rejects(store.registerSale({ saleId: newId(), actor: dev, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) }), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  const g = await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], discountCents: 500, payments: cash(8500) });
  assert.equal(g.sale.totalCents, 8500);
});

test('tickets históricos conservan precios aunque cambie el catálogo', async () => {
  const { store } = await readyStore();
  const s = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  const changed = pullPayload();
  changed.variants[0]!.priceCents = 12000;
  changed.variants[0]!.updatedAt = '2026-10-22T17:00:00.000Z';
  changed.products[0]!.name = 'Vela renombrada';
  await store.applyPull(changed);
  const old = await store.getSale(s.sale.id);
  assert.equal(old?.items[0]?.unitPriceCents, 9000);
  assert.equal(old?.items[0]?.productName, 'Vela ritual');
  assert.equal((await store.getTicket(s.sale.id))?.payload.items[0]?.name, 'Vela ritual');
  const s2 = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(12000) });
  assert.equal(s2.sale.totalCents, 12000);
});

test('historial protegido: no se puede borrar ni reescribir una venta', async () => {
  const { store } = await readyStore();
  const s = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  await assert.rejects(store.db.run('DELETE FROM sales WHERE id = ?', [s.sale.id]), /no se pueden borrar/);
  await assert.rejects(store.db.run('UPDATE sales SET total_cents = 1 WHERE id = ?', [s.sale.id]), /no se pueden modificar/);
  await assert.rejects(store.db.run('UPDATE sale_items SET qty = 9 WHERE sale_id = ?', [s.sale.id]), /Historial protegido/);
  await assert.rejects(store.db.run('DELETE FROM audit_log'), /no se borra/);
  await assert.rejects(store.db.run('DELETE FROM inventory_movements'), /Historial protegido/);
});

test('cancelación y devolución restituyen inventario y generan registros nuevos', async () => {
  const { store } = await readyStore();
  const s = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 3 }], payments: cash(27000) });
  assert.equal(await store.stockQty(V_CH, B1), 7);
  const ref = await store.refundSale({ saleId: s.sale.id, actor: gerente, terminalId: T1, reason: 'cliente devolvió', lines: [{ saleItemId: s.sale.items[0]!.id, qty: 1 }] });
  assert.equal(ref.amountCents, 9000);
  assert.equal(await store.stockQty(V_CH, B1), 8);
  await assert.rejects(store.cancelSale({ saleId: s.sale.id, actor: gerente, terminalId: T1, reason: 'cancelar' }), (e: unknown) => e instanceof StoreError && e.code === 'tiene_devoluciones');
  await assert.rejects(store.refundSale({ saleId: s.sale.id, actor: gerente, terminalId: T1, reason: 'otra', lines: [{ saleItemId: s.sale.items[0]!.id, qty: 3 }] }), (e: unknown) => e instanceof StoreError && e.code === 'cantidad_invalida');
  const s2 = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) });
  const can = await store.cancelSale({ saleId: s2.sale.id, actor: gerente, terminalId: T1, reason: 'se equivocó' });
  assert.equal(can.amountCents, 15000);
  assert.equal(await store.stockQty(V_GR, B1), 4);
  assert.equal((await store.getSale(s2.sale.id))?.status, 'cancelada');
  const orig = await store.getSale(s2.sale.id);
  assert.equal(orig?.totalCents, 15000, 'la venta original conserva su importe');
  await assert.rejects(store.cancelSale({ saleId: s2.sale.id, actor: gerente, terminalId: T1, reason: 'otra vez' }), (e: unknown) => e instanceof StoreError && e.code === 'ya_cancelada');
});

test('corte de caja: esperado solo con efectivo; diferencia; no se puede reabrir ni editar', async () => {
  const { store } = await readyStore();
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: [{ method: 'tarjeta', amountCents: 15000 }] });
  await store.addCashMovement({ actor: gerente, terminalId: T1, type: 'gasto', amountCents: 2000, concept: 'Papelería' });
  await store.addCashMovement({ actor: gerente, terminalId: T1, type: 'retiro', amountCents: 30000, concept: 'Depósito' });
  const res = await store.closeCash({ actor: gerente, terminalId: T1, countedCents: 76000, notes: 'prueba' });
  // 1000.00 + 90.00 - 20.00 - 300.00 = 770.00
  assert.equal(res.breakdown.expectedCents, 77000);
  assert.equal(res.differenceCents, -1000);
  assert.equal(res.breakdown.byMethod.tarjeta, 15000);
  assert.equal(res.provisional, true, 'hay operaciones pendientes de sincronizar');
  const closures = await store.listClosures();
  assert.equal(closures.length, 1);
  assert.equal(closures[0].reconciliation, 'pendiente');
  await assert.rejects(store.db.run("UPDATE cash_sessions SET counted_cents = 77000 WHERE status = 'cerrada'"), /no se modifica/);
  await assert.rejects(store.db.run('DELETE FROM cash_sessions'), /Historial protegido/);
  assert.equal(await store.currentSession(T1), undefined);
});

test('permiso temporal: vendedor da entrada solo con permiso vigente; expira; no hay doble registro', async () => {
  const { store, clock } = await readyStore();
  const mov = (id: string) => ({ id, actor: vendedor, branchId: B1, terminalId: T1, variantId: V_CH, type: 'entrada' as const, qty: 5, reason: 'Llegó pedido' });
  await assert.rejects(store.registerMovement(mov(newId())), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  const now = clock.now().toISOString();
  const withGrant = pullPayload();
  withGrant.grants = [{ id: 'g1', sellerId: vendedor.userId, branchId: B1, functions: ['inventario.entrada'], startsAt: now, expiresAt: new Date(clock.t + 30 * 60000).toISOString(), revokedAt: null, grantedBy: gerente.userId }];
  await store.applyPull(withGrant);
  const id = newId();
  const ok = await store.registerMovement(mov(id));
  assert.equal(ok.newQty, 15);
  const again = await store.registerMovement(mov(id));
  assert.equal(again.duplicate, true);
  assert.equal(await store.stockQty(V_CH, B1), 15);
  const row = await store.db.get<any>('SELECT authorized_by, grant_id, user_id FROM inventory_movements WHERE id = ?', [id]);
  assert.equal(row.authorized_by, gerente.userId);
  assert.equal(row.grant_id, 'g1');
  // El permiso NO sirve para salidas ni cortes
  await assert.rejects(store.registerMovement({ ...mov(newId()), type: 'salida' }), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 0 }), (e: unknown) => e instanceof StoreError && e.code === 'autorizacion_requerida');
  // Expira
  clock.advance(31 * 60000);
  await assert.rejects(store.registerMovement(mov(newId())), (e: unknown) => e instanceof StoreError && e.code === 'sin_permiso');
});

test('conteo físico registra la diferencia respecto a la existencia local', async () => {
  const { store } = await readyStore();
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 2 }], payments: cash(18000) });
  const r = await store.registerMovement({ id: newId(), actor: gerente, branchId: B1, terminalId: T1, variantId: V_CH, type: 'conteo', qty: 7, reason: 'Conteo mensual' });
  assert.equal(r.delta, -1); // había 8, contó 7
  assert.equal(await store.stockQty(V_CH, B1), 7);
});

test('los pulls del servidor no borran el efecto de ventas locales pendientes', async () => {
  const { store } = await readyStore();
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 3 }], payments: cash(27000) });
  assert.equal(await store.stockQty(V_CH, B1), 7);
  await store.applyPull(pullPayload()); // servidor aún dice 10 (no ha recibido la venta)
  assert.equal(await store.stockQty(V_CH, B1), 7, 'no se restauran las cantidades de la mañana');
});

test('resumen local: marca que puede estar incompleto y cuenta pendientes', async () => {
  const { store } = await readyStore();
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: [{ method: 'tarjeta', amountCents: 15000 }] });
  const { from, to } = mxDayBounds('2026-10-22');
  const s = await store.summary({ from, to, branchId: B1 });
  assert.equal(s.summary.grossCents, 24000);
  assert.equal(s.summary.ticketCount, 2);
  assert.equal(s.summary.byMethod.tarjeta.netCents, 15000);
  assert.equal(s.source, 'local');
  assert.equal(s.mayBeIncomplete, true);
  assert.ok(s.pendingOps >= 2);
});

test('persistencia: ventas y tickets sobreviven al cerrar y reabrir el archivo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'amara-'));
  const path = join(dir, 'amara.sqlite');
  const a = await readyStore({ path });
  const s = await a.store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  a.raw.close();
  const b = await newStore({ path });
  const sale = await b.store.getSale(s.sale.folio);
  assert.equal(sale?.totalCents, 9000);
  assert.ok(await b.store.getTicket(s.sale.folio));
  assert.equal(await b.store.stockQty(V_CH, B1), 9);
  assert.equal((await b.store.nextPending()).length >= 1, true);
  b.raw.close();
});

test('respaldo: VACUUM INTO crea copia consistente, restaurable y verificable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'amara-bk-'));
  const { store } = await readyStore({ path: join(dir, 'origen.sqlite') });
  await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  const dest = join(dir, 'respaldo-1.sqlite');
  await store.backupInto(dest);
  assert.ok(existsSync(dest) && statSync(dest).size > 0);
  // No se sobrescribe un respaldo previo
  await assert.rejects(store.backupInto(dest));
  // Restauración en una base de prueba
  const copy = new DatabaseSync(dest);
  assert.equal((copy.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok');
  assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM sales').get() as any).n, 1);
  copy.close();
  await store.logBackup({ kind: 'diario', path: dest, ok: true, sizeBytes: statSync(dest).size, verified: true });
  await store.logBackup({ kind: 'cada2h', ok: false, error: 'Disco lleno' });
  const log = await store.listBackups();
  assert.equal(log.length, 2);
  assert.equal(log.find((l) => l.ok === 0)?.error, 'Disco lleno');
});

test('cola: acuse aplica, duplicados e inconsistencias quedan documentadas', async () => {
  const { store } = await readyStore();
  const s = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  const ops = await store.nextPending(50);
  const saleOp = ops.find((o) => o.type === 'sale.create')!;
  await store.markAck({ opId: saleOp.opId, status: 'conflict', conflictKind: 'stock_negativo', detail: 'Existencia negativa', receivedAt: '2026-10-22T16:05:00.000Z' });
  assert.equal((await store.getSale(s.sale.id)) !== undefined, true);
  const row = await store.db.get<any>('SELECT sync_state FROM sales WHERE id = ?', [s.sale.id]);
  assert.equal(row.sync_state, 'conflicto');
  assert.equal((await store.openConflicts()).length, 1);
  // acuse repetido no duplica conflictos
  await store.markAck({ opId: saleOp.opId, status: 'conflict', conflictKind: 'stock_negativo', receivedAt: '2026-10-22T16:06:00.000Z' });
  assert.equal((await store.openConflicts()).length, 1);
  // movimiento del inventario deja de sumarse a la base tras el acuse
  const status = await store.syncStatus();
  assert.equal(status.openConflicts, 1);
});

test('replica LAN: venta del teléfono se importa una sola vez conservando folio', async () => {
  const phone = await readyStore();
  const pc = await readyStore();
  const sale = await phone.store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  const op = (await phone.store.nextPending()).find((o) => o.type === 'sale.create')!;
  const r1 = await pc.store.ingestRemoteSale(op);
  const r2 = await pc.store.ingestRemoteSale(op);
  assert.equal(r1.duplicate, false);
  assert.equal(r2.duplicate, true);
  const imported = await pc.store.getSale(sale.sale.folio);
  assert.equal(imported?.id, sale.sale.id);
  assert.equal(await pc.store.stockQty(V_CH, B1), 9);
  const q = await pc.store.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE op_id = ?", [op.opId]);
  assert.equal(q?.n, 1);
});

test('migraciones son idempotentes e integridad ok', async () => {
  const { store } = await readyStore();
  await store.migrate();
  await store.migrate();
  const v = await store.db.all<any>('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(v.map((r) => r.version), [1, 2]);
  assert.deepEqual(await store.integrityCheck(), { ok: true, problems: [] });
  void Clock;
});
