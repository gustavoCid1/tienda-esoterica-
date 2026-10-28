/**
 * Pruebas de la versión 2: migración aditiva sobre una base V1 CON DATOS, tokens, ventas con extra,
 * existencias sin negativos, autorización en cierre/cancelación/devolución y resumen del día.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { newId, summarizeSales } from '@amara/shared';
import { createDb, fromSyncSqlite, OPEN_PRAGMAS } from '../src/db.ts';
import { LocalStore } from '../src/local-store.ts';
import { MIGRATIONS } from '../src/schema.ts';
import { StoreError } from '../src/types.ts';
import { ADMIN_PASSWORD, B1, B2, Clock, P1, T1, V_CH, V_GR, cachedToken, fakeVerify, gerente, pullPayload, readyStore, vendedor } from './helpers.ts';

const cash = (n: number) => [{ method: 'efectivo' as const, amountCents: n, tenderedCents: n }];
const code = (e: unknown, c: string) => e instanceof StoreError && e.code === c;
const CODE = 'ABCD2345';

// ───────────────────────────── Migración V2 sobre datos V1 ─────────────────────────────

/** Crea una base como la que ya tiene la dueña: SOLO la migración 1, con ventas, ticket, ajuste, cortes y cola. */
async function v1Database() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(OPEN_PRAGMAS);
  raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  raw.exec(MIGRATIONS[0]!.sql);
  raw.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)').run('esquema_inicial', '2026-10-01T00:00:00.000Z');
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as any[]));
  for (const [k, v] of Object.entries({ branch_id: B1, branch_code: 'A', terminal_id: T1, terminal_code: 'P1' })) run('INSERT INTO meta (key, value) VALUES (?,?)', k, v);
  run("INSERT INTO branches (id, code, name) VALUES (?,?,?)", B1, 'A', 'Sucursal Centro');
  run("INSERT INTO users_local (id, username, name, role, branch_ids_json, updated_at) VALUES (?,?,?,?,?,?)", gerente.userId, 'gerente', 'Gerente', 'gerente', JSON.stringify([B1]), '2026-10-01T00:00:00.000Z');
  run("INSERT INTO products (id, name, type, category, sku, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", P1, 'Vela ritual', 'Velas', 'Rituales', 'VEL-001', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  run("INSERT INTO variants (id, product_id, label, internal_code, qr_value, cost_cents, price_cents, min_stock, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", V_CH, P1, 'Chica', 'AMA00000001', `amara:v1:${V_CH}`, 4000, 9000, 3, '2026-10-01T00:00:00.000Z');
  run("INSERT INTO stock (variant_id, branch_id, base_qty, updated_at) VALUES (?,?,?,?)", V_CH, B1, 10, '2026-10-01T00:00:00.000Z');
  // Una sesión de caja YA CERRADA (corte real) y otra abierta.
  run(`INSERT INTO cash_sessions (id, branch_id, terminal_id, opened_by, opened_at, opening_cents, status, closed_by, closed_at, counted_cents, expected_cents, difference_cents, reconciliation, closure_json)
       VALUES ('ses-cerrada', ?, ?, ?, '2026-10-20T14:00:00.000Z', 100000, 'cerrada', ?, '2026-10-20T23:00:00.000Z', 109000, 109000, 0, 'conciliado', '{"x":1}')`, B1, 'term-viejo', gerente.userId, gerente.userId);
  run("INSERT INTO cash_sessions (id, branch_id, terminal_id, opened_by, opened_at, opening_cents) VALUES ('ses-abierta', ?, ?, ?, '2026-10-22T14:00:00.000Z', 50000)", B1, T1, gerente.userId);
  // Venta V1 con 2 piezas, pago, ticket, movimiento y operación pendiente.
  run(`INSERT INTO sales (id, folio, branch_id, terminal_id, user_id, user_name, cash_session_id, created_at, subtotal_cents, discount_cents, total_cents, tendered_cents, change_cents)
       VALUES ('venta-v1', 'AMA-AP1-261022-0001', ?, ?, ?, 'Gerente', 'ses-abierta', '2026-10-22T15:00:00.000Z', 18000, 0, 18000, 20000, 2000)`, B1, T1, gerente.userId);
  run(`INSERT INTO sale_items (id, sale_id, variant_id, product_name, variant_label, sku, code, qty, unit_price_cents, unit_cost_cents, line_discount_cents, net_cents)
       VALUES ('venta-v1:0', 'venta-v1', ?, 'Vela ritual', 'Chica', 'VEL-001', 'AMA00000001', 2, 9000, 4000, 0, 18000)`, V_CH);
  run("INSERT INTO sale_payments (id, sale_id, method, amount_cents, tendered_cents, change_cents) VALUES ('venta-v1:p0','venta-v1','efectivo',18000,20000,2000)");
  run("INSERT INTO tickets (id, sale_id, folio, payload_json) VALUES ('tk1','venta-v1','AMA-AP1-261022-0001','{\"total\":18000}')");
  run(`INSERT INTO inventory_movements (id, variant_id, branch_id, delta, type, reason, ref_type, ref_id, user_id, created_at, op_id, synced)
       VALUES ('venta-v1:m0', ?, ?, -2, 'venta', 'Venta', 'sale', 'venta-v1', ?, '2026-10-22T15:00:00.000Z', 'op-v1', 0)`, V_CH, B1, gerente.userId);
  run(`INSERT INTO sync_queue (op_id, type, branch_id, terminal_id, user_id, local_ts, payload_json, created_at)
       VALUES ('op-v1','sale.create', ?, ?, ?, '2026-10-22T15:00:00.000Z', '{"sale":{"id":"venta-v1"}}', '2026-10-22T15:00:00.000Z')`, B1, T1, gerente.userId);
  run("INSERT INTO counters (key, value) VALUES ('folio:P1:2026-10-22', 1)");
  run("INSERT INTO audit_log (id, at, user_id, action) VALUES ('au1','2026-10-22T15:00:00.000Z',?,'venta.crear')", gerente.userId);
  return raw;
}

test('migración v2 corre sobre una base V1 con datos reales sin perder ni alterar nada', async () => {
  const raw = await v1Database();
  const clock = new Clock();
  const store = new LocalStore(createDb(fromSyncSqlite(raw)), { now: clock.now, verifyPassword: fakeVerify });
  await store.migrate();

  assert.deepEqual((await store.db.all<any>('SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version), [1, 2]);
  assert.deepEqual(await store.integrityCheck(), { ok: true, problems: [] });

  // La venta V1 sigue igual y toma los valores por omisión.
  const sale = await store.getSale('venta-v1');
  assert.equal(sale?.totalCents, 18000);
  assert.equal(sale?.changeCents, 2000);
  assert.equal(sale?.sellerId, null);
  assert.equal(sale?.sellerName, null);
  assert.equal(sale?.type, 'venta');
  assert.equal(sale?.items[0]?.kind, 'producto');
  assert.equal(sale?.items[0]?.extraNote, null);
  assert.equal(sale?.items[0]?.qty, 2);
  assert.equal((await store.getTicket('venta-v1'))?.payload.totalCents, undefined, 'el ticket emitido no se toca');
  assert.equal((await store.db.get<any>("SELECT payload_json FROM tickets WHERE id = 'tk1'"))?.payload_json, '{"total":18000}');
  assert.equal(await store.stockQty(V_CH, B1), 8, 'la existencia local sigue contando el movimiento pendiente');
  assert.equal((await store.pendingCount()), 1);
  assert.equal((await store.db.get<any>("SELECT COUNT(*) AS n FROM audit_log"))?.n, 1);

  // El corte cerrado conserva sus cifras; las columnas nuevas quedan en NULL.
  const closed = await store.getClosure('ses-cerrada');
  assert.equal(closed?.countedCents, 109000);
  assert.equal(closed?.expectedCents, 109000);
  assert.equal(closed?.closeAuthorization, null);
  assert.equal((await store.listClosures()).length, 1);

  // Tablas nuevas existen y están vacías; configuración por omisión.
  assert.equal((await store.db.get<any>('SELECT COUNT(*) AS n FROM security_tokens_cache'))?.n, 0);
  assert.deepEqual(await store.getExtraCategories(), ['Veladoras', 'Pulseras', 'Imágenes', 'Lociones']);

  // El historial sigue protegido (triggers V1) y los nuevos también.
  await assert.rejects(store.db.run("DELETE FROM sales WHERE id = 'venta-v1'"), /no se pueden borrar/);
  await assert.rejects(store.db.run("UPDATE sales SET total_cents = 1 WHERE id = 'venta-v1'"), /no se pueden modificar/);
  await assert.rejects(store.db.run("UPDATE sales SET seller_name = 'otro' WHERE id = 'venta-v1'"), /no se pueden modificar/);
  await assert.rejects(store.db.run("UPDATE sale_items SET kind = 'extra' WHERE sale_id = 'venta-v1'"), /Historial protegido/);
  await assert.rejects(store.db.run("UPDATE cash_sessions SET counted_cents = 1 WHERE id = 'ses-cerrada'"), /no se modifica/);

  // Y la tienda sigue vendiendo con las funciones nuevas sobre esa misma base.
  const r = await store.registerSale({
    saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, sellerId: gerente.userId, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000),
  });
  assert.equal(r.sale.sellerName, 'Gerente', 'el nombre del vendedor se toma de los usuarios locales');
  assert.equal(r.sale.folio, 'AMA-AP1-261022-0002', 'el consecutivo de folios continúa donde iba V1');
  await store.migrate();
  assert.equal((await store.db.get<any>('SELECT COUNT(*) AS n FROM schema_migrations'))?.n, 2, 'migrar de nuevo no repite nada');
  raw.close();
});

// ───────────────────────────── Pull: tokens, verificadores y configuración ─────────────────────────────

async function storeWithToken(over: Parameters<typeof cachedToken>[1] = {}, clock?: Clock) {
  const ctx = await readyStore({ clock });
  const p = pullPayload();
  p.securityTokens = [cachedToken(CODE, over)];
  await ctx.store.applyPull(p);
  return ctx;
}

test('pull guarda tokens (solo hashes), verificadores de gerentes y categorías de extras; el siguiente pull los reemplaza', async () => {
  const { store } = await readyStore();
  const p = pullPayload();
  p.securityTokens = [cachedToken(CODE), cachedToken('ZXCV6789', { id: 'tok-0002', salt: 'otra-sal' })];
  p.settings = { extraCategories: ['Veladoras', ' Cristales ', 'veladoras'] };
  await store.applyPull(p);
  const cached = await store.listCachedTokens();
  assert.equal(cached.length, 2);
  assert.ok(cached.every((t) => /^[0-9a-f]{64}$/.test(t.hash)));
  assert.ok(!JSON.stringify(await store.db.all('SELECT * FROM security_tokens_cache')).includes(CODE), 'el código jamás se guarda');
  assert.deepEqual(await store.getExtraCategories(), ['Veladoras', 'Cristales']);
  assert.equal((await store.db.get<any>('SELECT verifier FROM users_local WHERE id = ?', [gerente.userId]))?.verifier, `fake$${ADMIN_PASSWORD}`);
  // Un pull sin verifier no borra el que ya había; uno con securityTokens reemplaza la caché (revocación).
  const p2 = pullPayload();
  p2.users = p2.users.map(({ verifier: _v, ...u }) => u);
  p2.securityTokens = [cachedToken(CODE, { revokedAt: '2026-10-22T15:45:00.000Z' })];
  await store.applyPull(p2);
  assert.equal((await store.db.get<any>('SELECT verifier FROM users_local WHERE id = ?', [gerente.userId]))?.verifier, `fake$${ADMIN_PASSWORD}`);
  assert.equal((await store.listCachedTokens()).length, 1);
  assert.deepEqual(await store.getExtraCategories(), ['Veladoras', 'Cristales'], 'sin settings en el pull se conserva la configuración');
  // Un pull de un servidor anterior (sin securityTokens) no toca la caché.
  await store.applyPull(pullPayload());
  assert.equal((await store.listCachedTokens()).length, 1);
});

test('verifyActionAuthorization con token: vigencia, propósito, sucursal, usuario y revocación', async () => {
  const clock = new Clock('2026-10-22T16:00:00.000Z'); // el token vence a las 17:00
  const { store } = await storeWithToken({ purposes: ['cierre_caja'] }, clock);
  const base = { branchId: B1, userId: vendedor.userId };

  const ok = await store.verifyActionAuthorization({ ...base, code: 'abcd-2345', purpose: 'cierre_caja' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.authorization, { kind: 'token', tokenId: 'tok-0001' });
  assert.equal(ok.ok && ok.authorizedByName, 'Gerente');
  assert.equal(ok.ok && ok.expiresAt, '2026-10-22T17:00:00.000Z');

  const bad = async (input: Partial<Parameters<typeof store.verifyActionAuthorization>[0]>, reason: string) => {
    const r = await store.verifyActionAuthorization({ ...base, code: CODE, purpose: 'cierre_caja', ...input });
    assert.ok(!r.ok && r.reason === reason, `esperaba ${reason}, obtuvo ${JSON.stringify(r)}`);
    assert.ok(!r.ok && r.message.length > 3);
  };
  await bad({ code: 'EQUIVOCA' }, 'no_coincide');
  await bad({ purpose: 'devolucion' }, 'proposito');
  await bad({ branchId: B2 }, 'sucursal');
  assert.deepEqual(await store.verifyActionAuthorization({ purpose: 'cierre_caja', branchId: B1 }), { ok: false, reason: 'datos_faltantes', message: 'Escribe el código del token o la contraseña de un administrador' });

  clock.advance(61 * 60_000); // 17:01
  await bad({}, 'vencido');
});

test('verifyActionAuthorization: token para un usuario, revocado y con máximo de usos', async () => {
  const forUser = await storeWithToken({ forUserId: vendedor.userId });
  assert.ok((await forUser.store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: B1, userId: vendedor.userId })).ok);
  const other = await forUser.store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: B1, userId: 'otra-persona' });
  assert.ok(!other.ok && other.reason === 'usuario');

  const revoked = await storeWithToken({ revokedAt: '2026-10-22T15:59:00.000Z' });
  const r = await revoked.store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: B1 });
  assert.ok(!r.ok && r.reason === 'revocado');

  const spent = await storeWithToken({ maxUses: 1, usedCount: 1 });
  const s = await spent.store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: B1 });
  assert.ok(!s.ok && s.reason === 'agotado');
});

test('verifyActionAuthorization con contraseña de gerente: usa el verificador local y deniega si no puede comprobar', async () => {
  const { store } = await readyStore();
  const base = { purpose: 'cierre_caja' as const, branchId: B1 };
  const ok = await store.verifyActionAuthorization({ ...base, adminPassword: ADMIN_PASSWORD });
  assert.deepEqual(ok.ok && ok.authorization, { kind: 'admin_password', adminUserId: gerente.userId });
  assert.equal(ok.ok && ok.authorizedByName, 'Gerente');
  assert.ok((await store.verifyActionAuthorization({ ...base, adminPassword: ADMIN_PASSWORD, adminUserId: gerente.userId })).ok);
  const wrong = await store.verifyActionAuthorization({ ...base, adminPassword: 'mal' });
  assert.ok(!wrong.ok && wrong.reason === 'contrasena_incorrecta');
  // La contraseña del vendedor NO sirve (solo gerentes), aunque se indique su id.
  const seller = await store.verifyActionAuthorization({ ...base, adminPassword: 'x', adminUserId: vendedor.userId });
  assert.ok(!seller.ok && seller.reason === 'sin_administrador');
  // Sucursal que el gerente no atiende.
  const p = pullPayload();
  p.users = p.users.map((u) => (u.id === gerente.userId ? { ...u, branchIds: [B2] } : u));
  await store.applyPull(p);
  const otherBranch = await store.verifyActionAuthorization({ ...base, adminPassword: ADMIN_PASSWORD });
  assert.ok(!otherBranch.ok && otherBranch.reason === 'sin_administrador');
  // Sin verificador descargado, no se puede comprobar: deniega.
  const fresh = await readyStore();
  await fresh.store.db.run('UPDATE users_local SET verifier = NULL');
  const noVer = await fresh.store.verifyActionAuthorization({ ...base, adminPassword: ADMIN_PASSWORD });
  assert.ok(!noVer.ok && noVer.reason === 'sin_verificador');
  // Gerente inactivo.
  const inactive = await readyStore();
  const q = pullPayload();
  q.users = q.users.map((u) => (u.id === gerente.userId ? { ...u, active: false } : u));
  await inactive.store.applyPull(q);
  const r = await inactive.store.verifyActionAuthorization({ ...base, adminPassword: ADMIN_PASSWORD });
  assert.ok(!r.ok && r.reason === 'sin_administrador');
});

// ───────────────────────────── Ventas con extra, vendedor, Limpias ─────────────────────────────

test('venta con extra: suma al total, no mueve inventario, guarda vendedor y nota; el ticket no imprime al vendedor', async () => {
  const { store } = await readyStore();
  const saleId = newId();
  const r = await store.registerSale({
    saleId, actor: gerente, branchId: B1, terminalId: T1, sellerId: vendedor.userId, sellerName: 'Vendedora',
    items: [{ variantId: V_CH, qty: 2 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 2500, extraNote: 'Aceite aromático' }],
    payments: cash(20500),
  });
  assert.equal(r.sale.totalCents, 20500);
  assert.equal(r.sale.subtotalCents, 20500);
  assert.equal(r.sale.sellerId, vendedor.userId);
  assert.equal(r.sale.sellerName, 'Vendedora');
  assert.equal(r.sale.type, 'venta');
  assert.deepEqual(r.sale.items.map((i) => [i.kind, i.qty, i.unitPriceCents, i.unitCostCents]), [['producto', 2, 9000, 4000], ['extra', 1, 2500, 0]]);
  assert.equal(r.sale.items[1]!.extraNote, 'Aceite aromático');
  // Solo la línea de producto movió inventario.
  assert.equal(await store.stockQty(V_CH, B1), 8);
  const movs = await store.db.all<any>('SELECT id, delta FROM inventory_movements WHERE ref_id = ?', [saleId]);
  assert.deepEqual(movs.map((m) => m.delta), [-2]);
  // Persistencia y recuperación.
  const back = await store.getSale(saleId);
  assert.equal(back?.items[1]?.kind, 'extra');
  assert.equal(back?.sellerName, 'Vendedora');
  // El ticket muestra el extra pero NO al vendedor.
  const t = await store.getTicket(saleId);
  assert.deepEqual(t?.payload.items.map((i) => i.kind), ['producto', 'extra']);
  assert.ok(!JSON.stringify(t?.payload).includes('Vendedora'), 'el vendedor no se imprime en el ticket');
  // Viaja en la cola para sincronizar.
  const op = (await store.nextPending()).find((o) => o.type === 'sale.create')!;
  const payload = op.payload as { sale: { sellerId: string; type: string; items: { kind: string }[] } };
  assert.equal(payload.sale.sellerId, vendedor.userId);
  assert.deepEqual(payload.sale.items.map((i) => i.kind), ['producto', 'extra']);
  // El resumen: el extra suma al importe, no a unidades.
  const { sales, adjustments } = await store.loadReportData('2026-10-22T00:00:00.000Z', '2026-10-23T12:00:00.000Z');
  const sum = summarizeSales(sales, adjustments);
  assert.equal(sum.grossCents, 20500);
  assert.equal(sum.unitsSold, 2);
});

test('extra: reglas (qty 1, monto obligatorio y no negativo, precio 0 permitido) y descuentos solo de gerente', async () => {
  const { store } = await readyStore();
  const sale = (items: any[], pay = 20500, actor = vendedor) => store.registerSale({ saleId: newId(), actor, branchId: B1, terminalId: T1, items, payments: cash(pay) });
  await assert.rejects(sale([{ variantId: V_CH, qty: 2, kind: 'extra', unitPriceCents: 100 }]), (e) => code(e, 'cantidad_invalida'));
  await assert.rejects(sale([{ variantId: V_CH, qty: 1, kind: 'extra' }]), (e) => code(e, 'precio_invalido'));
  await assert.rejects(sale([{ variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: -5 }]), (e) => code(e, 'precio_invalido'));
  await assert.rejects(sale([{ variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 12.5 }]), (e) => code(e, 'precio_invalido'));
  const free = await sale([{ variantId: V_CH, qty: 1 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 0, extraNote: 'cortesía' }], 9000);
  assert.equal(free.sale.totalCents, 9000);
  // Un extra con descuento de línea: solo el gerente puede aplicar descuentos.
  await assert.rejects(sale([{ variantId: V_CH, qty: 1 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 1000, lineDiscountCents: 100 }], 9900), (e) => code(e, 'sin_permiso'));
  const disc = await sale([{ variantId: V_CH, qty: 1 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 1000, lineDiscountCents: 100 }], 9900, gerente);
  assert.equal(disc.sale.totalCents, 9900);
});

test('un extra sobre un producto sin existencia no se bloquea por existencias (no mueve inventario)', async () => {
  const { store } = await readyStore();
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 4 }], payments: cash(60000) });
  assert.equal(await store.stockQty(V_GR, B1), 0);
  const r = await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1, kind: 'extra', unitPriceCents: 3000 }], payments: cash(3000) });
  assert.equal(r.sale.totalCents, 3000);
  assert.equal(await store.stockQty(V_GR, B1), 0);
});

test('cancelar o devolver una venta con extra: el extra devuelve dinero pero nunca existencias', async () => {
  const { store } = await readyStore();
  const mk = async () =>
    (await store.registerSale({
      saleId: newId(), actor: gerente, branchId: B1, terminalId: T1,
      items: [{ variantId: V_CH, qty: 2 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 2500 }], payments: cash(20500),
    })).sale;
  const s1 = await mk();
  assert.equal(await store.stockQty(V_CH, B1), 8);
  const cancel = await store.cancelSale({ saleId: s1.id, actor: gerente, terminalId: T1, reason: 'se arrepintió' });
  assert.equal(cancel.amountCents, 20500);
  assert.deepEqual(cancel.items.map((i) => [i.kind, i.restock]), [['producto', true], ['extra', false]]);
  assert.equal(await store.stockQty(V_CH, B1), 10, 'solo regresaron las 2 piezas del producto');

  const s2 = await mk();
  const ref = await store.refundSale({ saleId: s2.id, actor: gerente, terminalId: T1, reason: 'solo el extra', lines: [{ saleItemId: s2.items[1]!.id, qty: 1, restock: true }] });
  assert.equal(ref.amountCents, 2500);
  assert.equal(ref.items[0]!.restock, false, 'aunque se pida restock, un extra no regresa existencias');
  assert.equal(await store.stockQty(V_CH, B1), 8);
  const { sales, adjustments } = await store.loadReportData('2026-10-22T00:00:00.000Z', '2026-10-23T12:00:00.000Z');
  const sum = summarizeSales(sales, adjustments);
  assert.equal(sum.refundedCents, 2500);
  assert.equal(sum.unitsSold, 2, '4 vendidas - 2 de la cancelación; el extra devuelto no resta unidades');
});

test('Limpias: el gerente entra libremente; el vendedor solo con contraseña de admin o token "limpias"', async () => {
  const { store } = await storeWithToken({ purposes: ['limpias'] });
  const limpia = (extra: Record<string, unknown> = {}, actor = vendedor) =>
    store.registerSale({ saleId: newId(), actor, branchId: B1, terminalId: T1, type: 'limpia', items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000), ...extra });
  await assert.rejects(limpia(), (e) => code(e, 'autorizacion_requerida'));
  await assert.rejects(limpia({ authorization: { kind: 'token', tokenId: 'no-existe' } }), (e) => code(e, 'autorizacion_invalida'));
  const viaToken = await limpia({ authorization: { kind: 'token', tokenId: 'tok-0001' } });
  assert.equal(viaToken.sale.type, 'limpia');
  const op = (await store.nextPending()).find((o) => o.type === 'sale.create')!;
  assert.deepEqual((op.payload as any).authorization, { kind: 'token', tokenId: 'tok-0001' });
  assert.equal((await store.db.get<any>('SELECT authorization_json FROM sales WHERE id = ?', [viaToken.sale.id]))?.authorization_json, '{"kind":"token","tokenId":"tok-0001"}');
  const viaAdmin = await limpia({ authorization: { kind: 'admin_password', adminUserId: gerente.userId } });
  assert.equal(viaAdmin.sale.type, 'limpia');
  const mgr = await limpia({}, gerente);
  assert.equal(mgr.sale.type, 'limpia');
  assert.equal((await store.listSales({ type: 'limpia' })).length, 3);
  assert.equal((await store.listSales({ type: 'venta' })).length, 0);
  assert.ok((await store.auditRecent()).some((a) => a.action === 'venta.limpia'));
  // Un token que no es de Limpias no sirve.
  const wrong = await storeWithToken({ purposes: ['cierre_caja'] });
  await assert.rejects(
    wrong.store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, type: 'limpia', items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000), authorization: { kind: 'token', tokenId: 'tok-0001' } }),
    (e) => code(e, 'autorizacion_invalida'),
  );
});

// ───────────────────────────── Autorización: cierre, cancelación, devolución ─────────────────────────────

test('cierre de caja: el gerente se autoriza solo; el vendedor exige admin/token válido; queda guardado y en la cola', async () => {
  const { store } = await storeWithToken({ purposes: ['cierre_caja'] });
  // Gerente: sin authorization explícita queda registrado él mismo.
  const m = await readyStore();
  const mr = await m.store.closeCash({ actor: gerente, terminalId: T1, countedCents: 100000 });
  assert.deepEqual(mr.authorization, { kind: 'admin_password', adminUserId: gerente.userId });
  assert.equal(mr.authorizedBy, gerente.userId);
  assert.equal(mr.openingCents, 100000);
  assert.equal(mr.openedAt, '2026-10-22T16:00:00.000Z');

  // Vendedor sin nada, con token inexistente, y con token de otro propósito.
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000 }), (e) => code(e, 'autorizacion_requerida'));
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000, authorization: { kind: 'token', tokenId: 'nope' } }), (e) => code(e, 'autorizacion_invalida'));
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000, authorization: { kind: 'admin_password', adminUserId: vendedor.userId } }), (e) => code(e, 'autorizacion_invalida'));
  assert.ok(await store.currentSession(T1), 'los intentos fallidos NO cerraron la caja');
  assert.equal((await store.nextPending()).filter((o) => o.type === 'cash.close').length, 0);

  const ok = await store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 99000, authorization: { kind: 'token', tokenId: 'tok-0001' } });
  assert.deepEqual(ok.authorization, { kind: 'token', tokenId: 'tok-0001' });
  assert.equal(ok.differenceCents, -1000);
  assert.equal(await store.currentSession(T1), undefined);
  const closure = await store.getClosure(ok.sessionId);
  assert.equal(closure?.closedBy, vendedor.userId);
  assert.deepEqual(closure?.closeAuthorization, { kind: 'token', tokenId: 'tok-0001' });
  assert.equal(closure?.authorizedBy, gerente.userId, 'authorizedBy = quien creó el token');
  assert.equal(closure?.authorizedByName, 'Gerente');
  const op = (await store.nextPending(50)).find((o) => o.type === 'cash.close')!;
  assert.deepEqual((op.payload as any).authorization, { kind: 'token', tokenId: 'tok-0001' });
  const aud = (await store.auditRecent()).find((a) => a.action === 'caja.cerrar');
  assert.ok(aud && JSON.parse(aud.detail_json).authorization.kind === 'token');
  // El corte cerrado no se puede alterar, tampoco su autorización.
  await assert.rejects(store.db.run("UPDATE cash_sessions SET close_authorization_json = NULL WHERE id = ?", [ok.sessionId]), /no se modifica/);
});

test('cierre de caja con contraseña de admin verificada; un token vencido, revocado o de otra sucursal se rechaza', async () => {
  const { store } = await readyStore();
  const v = await store.verifyActionAuthorization({ adminPassword: ADMIN_PASSWORD, purpose: 'cierre_caja', branchId: B1 });
  assert.ok(v.ok);
  const r = await store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000, authorization: v.ok ? v.authorization : undefined });
  assert.equal(r.authorizedBy, gerente.userId);

  for (const [name, over] of [
    ['vencido', { expiresAt: '2026-10-22T15:59:00.000Z' }],
    ['revocado', { revokedAt: '2026-10-22T15:00:00.000Z' }],
    ['otra sucursal', { branchId: B2 }],
    ['para otro usuario', { forUserId: 'otra-persona' }],
    ['agotado', { maxUses: 1, usedCount: 1 }],
  ] as const) {
    const ctx = await storeWithToken({ purposes: ['cierre_caja'], ...over });
    await assert.rejects(
      ctx.store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000, authorization: { kind: 'token', tokenId: 'tok-0001' } }),
      (e) => code(e, 'autorizacion_invalida'),
      name,
    );
    assert.ok(await ctx.store.currentSession(T1), `${name}: la caja sigue abierta`);
  }
});

test('token con máximo de usos: el segundo uso en este dispositivo ya no se acepta aunque aún no se sincronice', async () => {
  const { store } = await storeWithToken({ purposes: ['cancelacion'], maxUses: 1 });
  const mk = async () => (await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) })).sale;
  const [a, b] = [await mk(), await mk()];
  const authorization = { kind: 'token' as const, tokenId: 'tok-0001' };
  const c1 = await store.cancelSale({ saleId: a.id, actor: vendedor, terminalId: T1, reason: 'error de captura', authorization });
  assert.equal(c1.type, 'cancelacion');
  await assert.rejects(store.cancelSale({ saleId: b.id, actor: vendedor, terminalId: T1, reason: 'otro error', authorization }), (e) => code(e, 'autorizacion_invalida'));
  const v = await store.verifyActionAuthorization({ code: CODE, purpose: 'cancelacion', branchId: B1 });
  assert.ok(!v.ok && v.reason === 'agotado');
});

test('cancelación y devolución: vendedor necesita admin o token del propósito correcto; gerente no', async () => {
  const { store } = await storeWithToken({ purposes: ['devolucion'] });
  const sale = (await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 3 }], payments: cash(27000) })).sale;
  const line = sale.items[0]!.id;
  const refundArgs = { saleId: sale.id, actor: vendedor, terminalId: T1, reason: 'cliente devolvió', lines: [{ saleItemId: line, qty: 1 }] };

  await assert.rejects(store.refundSale(refundArgs), (e) => code(e, 'autorizacion_requerida'));
  // El token es de devolución: no sirve para cancelar.
  await assert.rejects(store.cancelSale({ saleId: sale.id, actor: vendedor, terminalId: T1, reason: 'cancelar', authorization: { kind: 'token', tokenId: 'tok-0001' } }), (e) => code(e, 'autorizacion_invalida'));
  assert.equal((await store.getSale(sale.id))?.status, 'completada');

  const ref = await store.refundSale({ ...refundArgs, authorization: { kind: 'token', tokenId: 'tok-0001' } });
  assert.equal(ref.amountCents, 9000);
  assert.equal(ref.userId, vendedor.userId);
  const row = await store.db.get<any>('SELECT authorization_json, authorized_by FROM sale_adjustments WHERE id = ?', [ref.id]);
  assert.equal(row.authorization_json, '{"kind":"token","tokenId":"tok-0001"}');
  assert.equal(row.authorized_by, gerente.userId);
  const op = (await store.nextPending(50)).find((o) => o.type === 'sale.adjust')!;
  assert.deepEqual((op.payload as any).authorization, { kind: 'token', tokenId: 'tok-0001' });
  await assert.rejects(store.db.run('UPDATE sale_adjustments SET authorized_by = NULL WHERE id = ?', [ref.id]), /Historial protegido/);

  // Con contraseña de admin también (para cancelar); el gerente no necesita nada y su identidad queda registrada.
  const s2 = (await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) })).sale;
  const c = await store.cancelSale({ saleId: s2.id, actor: vendedor, terminalId: T1, reason: 'error', authorization: { kind: 'admin_password', adminUserId: gerente.userId } });
  assert.equal(c.type, 'cancelacion');
  const s3 = (await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) })).sale;
  const g = await store.cancelSale({ saleId: s3.id, actor: gerente, terminalId: T1, reason: 'error del gerente' });
  assert.equal((await store.db.get<any>('SELECT authorized_by FROM sale_adjustments WHERE id = ?', [g.id]))?.authorized_by, gerente.userId);
  // El desarrollador nunca.
  await assert.rejects(store.cancelSale({ saleId: s3.id, actor: { ...vendedor, role: 'desarrollador' }, terminalId: T1, reason: 'x y z', authorization: { kind: 'admin_password', adminUserId: gerente.userId } }), (e) => code(e, 'sin_permiso'));
});

test('autorización verificada en línea por el servidor (authorizationTrusted): vale aunque el token no esté en la caché local', async () => {
  const { store } = await readyStore();
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000, authorization: { kind: 'token', tokenId: 'recien-creado' } }), (e) => code(e, 'autorizacion_invalida'));
  const r = await store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 100000, authorization: { kind: 'token', tokenId: 'recien-creado' }, authorizationTrusted: true });
  assert.deepEqual(r.authorization, { kind: 'token', tokenId: 'recien-creado' });
});

// ───────────────────────────── Resumen de hoy y réplica ─────────────────────────────

test('listTodaySalesSummary: solo hoy, con productos, cantidades y precios; más recientes primero', async () => {
  const clock = new Clock('2026-10-22T16:00:00.000Z');
  const { store } = await readyStore({ clock });
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, sellerId: vendedor.userId, sellerName: 'Vendedora', items: [{ variantId: V_CH, qty: 2 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 500, extraNote: 'moño' }], payments: cash(18500) });
  clock.advance(60_000);
  const l = await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, type: 'limpia', items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) });
  clock.advance(24 * 3600_000); // mañana
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  const today = await store.listTodaySalesSummary({ day: '2026-10-22' });
  assert.equal(today.length, 2);
  assert.equal(today[0]!.saleId, l.sale.id, 'más reciente primero');
  assert.equal(today[0]!.type, 'limpia');
  assert.deepEqual(today[1]!.items.map((i) => [i.name, i.qty, i.unitPriceCents, i.kind, i.extraNote]), [['Vela ritual', 2, 9000, 'producto', null], ['Vela ritual', 1, 500, 'extra', 'moño']]);
  assert.equal(today[1]!.sellerName, 'Vendedora');
  assert.equal(today[1]!.totalCents, 18500);
  assert.equal((await store.listTodaySalesSummary()).length, 1, 'sin argumentos = el día del reloj del dispositivo (mañana)');
  assert.equal((await store.listTodaySalesSummary({ day: '2026-10-22', branchId: B2 })).length, 0);
  assert.ok(!('payload' in today[0]!), 'no incluye el ticket impreso');
});

test('réplica LAN conserva vendedor, tipo, extras y autorización de la venta del teléfono', async () => {
  const phone = await storeWithToken({ purposes: ['limpias'] });
  await phone.store.setDeviceInfo({ branchId: B1, branchCode: 'A', terminalId: T1, terminalCode: 'M1' });
  const pc = await readyStore();
  const s = await phone.store.registerSale({
    saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, type: 'limpia', sellerId: vendedor.userId,
    items: [{ variantId: V_CH, qty: 1 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 700, extraNote: 'hierbas' }], payments: cash(9700),
    authorization: { kind: 'token', tokenId: 'tok-0001' },
  });
  const op = (await phone.store.nextPending()).find((o) => o.type === 'sale.create')!;
  await pc.store.ingestRemoteSale(op);
  const got = await pc.store.getSale(s.sale.folio);
  assert.equal(got?.type, 'limpia');
  assert.equal(got?.sellerId, vendedor.userId);
  assert.deepEqual(got?.items.map((i) => i.kind), ['producto', 'extra']);
  assert.equal(await pc.store.stockQty(V_CH, B1), 9, 'el extra no movió inventario en la PC');
  assert.equal((await pc.store.db.get<any>('SELECT authorization_json FROM sales WHERE id = ?', [s.sale.id]))?.authorization_json, '{"kind":"token","tokenId":"tok-0001"}');
  assert.equal((await pc.store.getTicket(s.sale.folio))?.payload.saleType, 'limpia');
});

test('el consecutivo por orden de captura se conserva con más de 10 líneas', async () => {
  const { store } = await readyStore();
  const p = pullPayload();
  p.stock = p.stock.map((s) => ({ ...s, qty: 100 }));
  await store.applyPull(p);
  const items = Array.from({ length: 12 }, (_, i) => ({ variantId: i % 2 === 0 ? V_CH : V_GR, qty: 1 }));
  const total = 6 * 9000 + 6 * 15000;
  const r = await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items, payments: cash(total) });
  const back = await store.getSale(r.sale.id);
  assert.deepEqual(back?.items.map((i) => i.id), r.sale.items.map((i) => i.id));
});
