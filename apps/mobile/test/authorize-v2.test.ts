/**
 * Autorización de cierre/devolución/cancelación/Limpias y bloqueo por existencias, contra un LocalStore real
 * (SQLite en memoria, con el verificador de contraseña falso de los ayudantes de packages/database).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '@amara/shared';
import { StoreError } from '@amara/database';
import { ADMIN_PASSWORD, B1, Clock, T1, V_CH, V_GR, cachedToken, gerente, pullPayload, readyStore, vendedor } from '../../../packages/database/test/helpers.ts';
import { authorizeAction, modesFor, parseVerifyResponse, shouldTryOnline } from '../src/lib/authorize.ts';
import type { AuthRequest, OnlineVerify } from '../src/lib/authorize.ts';
import { loadClosureTicketData } from '../src/lib/closure-data.ts';
import { buildClosureModel, buildPermitModel, closureHtml, groupCode, permitHtml } from '../src/lib/documents.ts';
import { addExtra, addToCartChecked, cartTotalCents, newCart, setQtyChecked, toDraft, parseDraft, toSaleItems, cartIsEmpty } from '../src/lib/cart.ts';
import { canCancelWhole, limpiaSaleItems, refundableLines } from '../src/lib/misc-v2.ts';

const CODE = 'ABCD2345';
const cash = (n: number) => [{ method: 'efectivo' as const, amountCents: n, tenderedCents: n }];
const code = (e: unknown, c: string) => e instanceof StoreError && e.code === c;

async function shop(clock?: Clock) {
  const ctx = await readyStore({ clock });
  const p = pullPayload();
  p.securityTokens = [cachedToken(CODE)];
  await ctx.store.applyPull(p);
  return ctx;
}
const req = (over: Partial<AuthRequest>): AuthRequest => ({ purpose: 'cierre_caja', branchId: B1, userId: vendedor.userId, role: 'vendedor', mode: 'password', secret: '', ...over });

// ───────────── authorizeAction ─────────────
test('autorizar: el vendedor con contraseña de administrador y con token; el gerente solo con la suya', async () => {
  const { store } = await shop();
  const okPw = await authorizeAction(store, req({ secret: ADMIN_PASSWORD }), null);
  assert.ok(okPw.ok);
  assert.deepEqual(okPw.ok && okPw.authorization, { kind: 'admin_password', adminUserId: gerente.userId });
  assert.equal(okPw.ok && okPw.via, 'local');

  const okTok = await authorizeAction(store, req({ mode: 'token', secret: ` ${CODE.toLowerCase()} ` }), null);
  assert.ok(okTok.ok && okTok.authorization.kind === 'token');

  const bad = await authorizeAction(store, req({ secret: 'mala' }), null);
  assert.ok(!bad.ok);
  const empty = await authorizeAction(store, req({ secret: '' }), null);
  assert.ok(!empty.ok && empty.reason === 'datos_faltantes');

  // El gerente confirma con SU contraseña (queda como quien autoriza); no puede usar token.
  const mgr = await authorizeAction(store, req({ role: 'gerente', userId: gerente.userId, secret: ADMIN_PASSWORD }), null);
  assert.ok(mgr.ok && mgr.authorizedBy === gerente.userId);
  assert.deepEqual(modesFor('gerente'), ['password']);
  assert.deepEqual(modesFor('vendedor'), ['password', 'token']);
  const mgrTok = await authorizeAction(store, req({ role: 'gerente', userId: gerente.userId, mode: 'token', secret: CODE }), null);
  assert.ok(!mgrTok.ok && mgrTok.reason === 'modo_invalido');
});

test('autorizar: el token debe servir para ESE propósito, estar vigente y no revocado', async () => {
  const { store, clock } = await shop();
  const wrongPurpose = await (async () => {
    const p = pullPayload();
    p.securityTokens = [cachedToken(CODE, { purposes: ['limpias'] })];
    await store.applyPull(p);
    return authorizeAction(store, req({ mode: 'token', secret: CODE, purpose: 'cierre_caja' }), null);
  })();
  assert.ok(!wrongPurpose.ok && wrongPurpose.reason === 'proposito');
  assert.ok((await authorizeAction(store, req({ mode: 'token', secret: CODE, purpose: 'limpias' }), null)).ok);
  clock.advance(2 * 3600_000); // el token vencía a las 17:00Z; ahora son las 18:00Z
  const late = await authorizeAction(store, req({ mode: 'token', secret: CODE, purpose: 'limpias' }), null);
  assert.ok(!late.ok && late.reason === 'vencido');
  assert.equal(shouldTryOnline('vencido'), false, 'un token vencido no se reintenta en línea');
  assert.equal(shouldTryOnline('no_coincide'), true);
});

test('autorizar: sin caché local pregunta al servidor; si no hay conexión, DENIEGA', async () => {
  const { store } = await readyStore(); // sin tokens en la caché
  const asked: Record<string, unknown>[] = [];
  const online: OnlineVerify = async (body) => {
    asked.push(body);
    return { ok: true, authorization: { kind: 'token', tokenId: 'tok-remoto' }, authorizedBy: gerente.userId, authorizedByName: 'Gerente' };
  };
  const r = await authorizeAction(store, req({ mode: 'token', secret: 'ZZZZ9999' }), online);
  assert.ok(r.ok && r.trusted && r.via === 'servidor');
  assert.equal(asked.length, 1);
  assert.deepEqual(Object.keys(asked[0]!).sort(), ['branchId', 'code', 'purpose']);

  const offline: OnlineVerify = async () => {
    throw new Error('sin red');
  };
  const d = await authorizeAction(store, req({ mode: 'token', secret: 'ZZZZ9999' }), offline);
  assert.ok(!d.ok);
  assert.match(d.ok ? '' : d.message, /No se pudo comprobar en línea/);
  const denied = await authorizeAction(store, req({ mode: 'token', secret: 'ZZZZ9999' }), async () => ({ ok: false, reason: 'no_coincide', message: 'Código incorrecto' }));
  assert.ok(!denied.ok && denied.message === 'Código incorrecto');

  // Contraseña de gerente en línea: la contraseña viaja solo en la petición; el gerente envía su id.
  const body: Record<string, unknown>[] = [];
  const g = await authorizeAction(store, req({ role: 'gerente', userId: gerente.userId, secret: 'otra-clave' }), async (b) => {
    body.push(b);
    return { ok: true, authorization: { kind: 'admin_password', adminUserId: gerente.userId } };
  });
  assert.ok(g.ok);
  assert.equal(body[0]!.adminUserId, gerente.userId);
  // Si el servidor autorizara a OTRA cuenta, el gerente no puede usarla como propia.
  const other = await authorizeAction(store, req({ role: 'gerente', userId: gerente.userId, secret: 'otra-clave' }), async () => ({ ok: true, authorization: { kind: 'admin_password', adminUserId: 'otro-gerente' } }));
  assert.ok(!other.ok && other.reason === 'otra_cuenta');
});

test('respuesta de /security/verify: tolera formas y rechaza lo ambiguo', () => {
  assert.ok(parseVerifyResponse({ ok: true, tokenId: 't1' }).ok);
  assert.ok(!parseVerifyResponse({ ok: true }).ok);
  assert.ok(!parseVerifyResponse(null).ok);
  const d = parseVerifyResponse({ ok: false, reason: 'revocado', message: 'El token fue revocado' });
  assert.ok(!d.ok && d.reason === 'revocado');
});

// ───────────── Cierre de caja ─────────────
test('cierre de caja: el vendedor NO puede cerrar sin autorización; con ella sí, y queda en el ticket de cierre', async () => {
  const { store } = await shop();
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: cash(9000) });
  await assert.rejects(store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 109000 }), (e) => code(e, 'autorizacion_requerida'));
  assert.ok(await store.currentSession(T1), 'la caja sigue abierta');

  // Con una contraseña equivocada tampoco.
  const bad = await authorizeAction(store, req({ secret: 'no' }), null);
  assert.ok(!bad.ok);

  const auth = await authorizeAction(store, req({ mode: 'token', secret: CODE }), null);
  assert.ok(auth.ok);
  const sessionId = (await store.currentSession(T1)).id as string;
  const r = await store.closeCash({ actor: vendedor, terminalId: T1, countedCents: 108500, authorization: auth.ok ? auth.authorization : undefined });
  assert.equal(r.expectedCents, 100000 + 9000);
  assert.equal(r.differenceCents, -500);
  assert.equal(await store.currentSession(T1), undefined);

  const data = await loadClosureTicketData(store, sessionId, { branchName: 'Sucursal Centro', terminalCode: 'P1' });
  assert.ok(data);
  assert.equal(data!.differenceCents, -500);
  assert.equal(data!.authorization?.kind, 'token');
  const lines = buildClosureModel(data!);
  const text = JSON.stringify(lines);
  assert.match(text, /CIERRE DE CAJA/);
  assert.match(text, /Faltante \$5\.00/);
  assert.match(text, /Token de seguridad/);
  assert.match(text, /Fondo inicial/);
  assert.ok(closureHtml(data!).includes('CIERRE DE CAJA'));
  assert.equal(await loadClosureTicketData(store, 'no-existe', { branchName: 'x', terminalCode: 'x' }), null);
});

test('cierre de caja: el gerente confirma con su contraseña y queda como quien autorizó', async () => {
  const { store } = await shop();
  const sessionId = (await store.currentSession(T1)).id as string;
  const auth = await authorizeAction(store, req({ role: 'gerente', userId: gerente.userId, secret: ADMIN_PASSWORD }), null);
  assert.ok(auth.ok);
  await store.closeCash({ actor: gerente, terminalId: T1, countedCents: 100000, authorization: auth.ok ? auth.authorization : undefined });
  const data = await loadClosureTicketData(store, sessionId, { branchName: 'Centro', terminalCode: 'P1' });
  assert.equal(data!.authorizedByName, 'Gerente');
  assert.match(JSON.stringify(buildClosureModel(data!)), /Contraseña de administrador \(Gerente\)/);
  assert.match(JSON.stringify(buildClosureModel(data!)), /Cuadra/);
});

// ───────────── Devoluciones y cancelaciones ─────────────
test('devolución y cancelación del vendedor: exigen contraseña de admin o token con SU propósito', async () => {
  const { store } = await shop();
  const sale = (await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 2 }], payments: cash(18000) })).sale;
  const lineId = sale.items[0]!.id;

  await assert.rejects(store.cancelSale({ saleId: sale.id, actor: vendedor, terminalId: T1, reason: 'error' }), (e) => code(e, 'autorizacion_requerida'));
  await assert.rejects(store.refundSale({ saleId: sale.id, actor: vendedor, terminalId: T1, reason: 'error', lines: [{ saleItemId: lineId, qty: 1 }] }), (e) => code(e, 'autorizacion_requerida'));

  // Un token solo de 'limpias' no sirve para devolver.
  const p = pullPayload();
  p.securityTokens = [cachedToken(CODE, { purposes: ['limpias'] })];
  await store.applyPull(p);
  const wrong = await authorizeAction(store, req({ mode: 'token', secret: CODE, purpose: 'devolucion' }), null);
  assert.ok(!wrong.ok);

  // Con un token de devolución sí; el almacén lo revalida.
  p.securityTokens = [cachedToken(CODE, { purposes: ['devolucion'] })];
  await store.applyPull(p);
  const auth = await authorizeAction(store, req({ mode: 'token', secret: CODE, purpose: 'devolucion' }), null);
  assert.ok(auth.ok);
  const adj = await store.refundSale({ saleId: sale.id, actor: vendedor, terminalId: T1, reason: 'defectuoso', lines: [{ saleItemId: lineId, qty: 1 }], authorization: auth.ok ? auth.authorization : undefined });
  assert.equal(adj.amountCents, 9000);
  // Ese mismo token NO sirve para cancelar.
  const cancelAuth = await authorizeAction(store, req({ mode: 'token', secret: CODE, purpose: 'cancelacion' }), null);
  assert.ok(!cancelAuth.ok);

  // Con contraseña de admin se cancela... pero ya hay devolución, así que lo dice y el flujo propone devolver el resto.
  const rows = await store.db.all<any>('SELECT items_json FROM sale_adjustments WHERE sale_id = ?', [sale.id]);
  const prior = rows.map((r) => ({ items: JSON.parse(r.items_json) }));
  const lines = refundableLines((await store.getSale(sale.id))!, prior);
  assert.equal(lines[0]!.remaining, 1);
  assert.equal(canCancelWhole((await store.getSale(sale.id))!, prior).ok, false);
});

test('cancelación del vendedor con contraseña de administrador; el gerente cancela con la suya', async () => {
  const { store } = await shop();
  const mk = async () => (await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) })).sale;
  const s1 = await mk();
  const auth = await authorizeAction(store, req({ purpose: 'cancelacion', secret: ADMIN_PASSWORD }), null);
  assert.ok(auth.ok);
  const a = await store.cancelSale({ saleId: s1.id, actor: vendedor, terminalId: T1, reason: 'se equivocó', authorization: auth.ok ? auth.authorization : undefined });
  assert.equal(a.type, 'cancelacion');
  assert.equal((await store.getSale(s1.id))!.status, 'cancelada');
  assert.equal(canCancelWhole((await store.getSale(s1.id))!, []).ok, false);

  const s2 = await mk();
  const gAuth = await authorizeAction(store, req({ purpose: 'cancelacion', role: 'gerente', userId: gerente.userId, secret: ADMIN_PASSWORD }), null);
  assert.ok(gAuth.ok);
  await store.cancelSale({ saleId: s2.id, actor: gerente, terminalId: T1, reason: 'cliente se arrepintió', authorization: gAuth.ok ? gAuth.authorization : undefined });
  assert.equal((await store.getSale(s2.id))!.status, 'cancelada');
});

// ───────────── Existencias ─────────────
test('no se vende con existencia 0 ni más de lo disponible; nunca queda negativa', async () => {
  const { store } = await shop();
  // La grande tiene 4. Pedir 5 se rechaza con sin_existencia y NO guarda nada.
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 5 }], payments: cash(75000) }),
    (e) => code(e, 'sin_existencia') && (e as StoreError).data?.available === 4,
  );
  assert.equal(await store.stockQty(V_GR, B1), 4);
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 4 }], payments: cash(60000) });
  assert.equal(await store.stockQty(V_GR, B1), 0);
  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) }),
    (e) => code(e, 'sin_existencia'),
  );
  assert.equal(await store.stockQty(V_GR, B1), 0);
});

test('el carrito valida existencias antes de llegar al almacén (0 no se agrega; no se pasa de lo disponible; negativo = 0)', () => {
  const vela = { variantId: V_CH, productName: 'Vela', label: 'Chica', priceCents: 9000, qty: 2, category: 'Velas' };
  let r = addToCartChecked(newCart('s'), vela, 1);
  assert.equal(r.error, null);
  r = addToCartChecked(r.cart, vela, 1);
  assert.equal(r.error, null);
  const third = addToCartChecked(r.cart, vela, 1);
  assert.match(third.error ?? '', /Solo hay 2/);
  assert.equal(third.cart, r.cart, 'no cambia el carrito');
  assert.match(setQtyChecked(r.cart, V_CH, 3).error ?? '', /Solo hay 2/);
  assert.equal(setQtyChecked(r.cart, V_CH, 1).error, null, 'bajar siempre se permite');
  assert.match(addToCartChecked(newCart('s'), { ...vela, qty: 0 }, 1).error ?? '', /no tiene existencia/);
  assert.match(addToCartChecked(newCart('s'), { ...vela, qty: -3 }, 1).error ?? '', /no tiene existencia/);
  assert.equal(addToCartChecked(newCart('s'), { ...vela, qty: undefined }, 1).error, null, 'sin dato de existencia no se bloquea en pantalla (el almacén valida)');
});

// ───────────── Extras y Limpias ─────────────
test('venta con extra: el carrito suma el cargo, el borrador lo conserva y el almacén lo registra sin mover inventario', async () => {
  const { store } = await shop();
  let c = addToCartChecked(newCart(newId()), { variantId: V_CH, productName: 'Vela', label: 'Chica', priceCents: 9000, qty: 10, category: 'Veladoras' }, 1).cart;
  c = addExtra(c, { id: 'x1', variantId: V_CH, productName: 'Vela', label: 'Chica', amountCents: 2500, note: 'Aroma a rosas' });
  assert.equal(cartTotalCents(c), 11500);
  assert.equal(cartIsEmpty(c), false);
  assert.deepEqual(parseDraft(JSON.stringify(toDraft(c)))!.extras!.map((e) => e.amountCents), [2500]);
  const r = await store.registerSale({ saleId: c.saleId, actor: gerente, branchId: B1, terminalId: T1, sellerId: vendedor.userId, items: toSaleItems(c), payments: cash(11500) });
  assert.equal(r.sale.totalCents, 11500);
  assert.equal(r.sale.sellerName, 'Vendedora', 'se guarda el empleado que vende');
  assert.equal(await store.stockQty(V_CH, B1), 9, 'el extra no descuenta existencias');
  const t = (await store.getTicket(c.saleId))!.payload;
  assert.ok(!JSON.stringify(t).includes('Vendedora'), 'el vendedor NO se imprime en el ticket');
  assert.equal(t.items[1]!.kind, 'extra');
});

test('Limpias: el vendedor solo con token o contraseña de admin; arma artículos + servicio; descuenta inventario', async () => {
  const { store } = await shop();
  const articles = [
    { variantId: V_CH, name: 'Vela', label: 'Chica', priceCents: 9000, qty: 2, available: 10 },
    { variantId: V_GR, name: 'Vela', label: 'Grande', priceCents: 15000, qty: 1, available: 4 },
  ];
  const items = limpiaSaleItems(articles, 20000);
  assert.equal(items.length, 3);
  assert.equal(items[2]!.kind, 'extra');
  assert.equal(limpiaSaleItems([], 20000).length, 0, 'sin artículos no hay limpia');
  assert.equal(limpiaSaleItems(articles, 0).length, 2);

  await assert.rejects(
    store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, type: 'limpia', items, payments: cash(53000) }),
    (e) => code(e, 'autorizacion_requerida'),
  );
  const auth = await authorizeAction(store, req({ purpose: 'limpias', mode: 'token', secret: CODE }), null);
  assert.ok(auth.ok);
  const r = await store.registerSale({ saleId: newId(), actor: vendedor, branchId: B1, terminalId: T1, type: 'limpia', items, payments: cash(53000), authorization: auth.ok ? auth.authorization : undefined });
  assert.equal(r.sale.type, 'limpia');
  assert.equal(r.sale.totalCents, 2 * 9000 + 15000 + 20000);
  assert.equal(await store.stockQty(V_CH, B1), 8);
  assert.equal((await store.getTicket(r.sale.id))!.payload.saleType, 'limpia');
});

// ───────────── Ticket de permiso ─────────────
test('ticket de permiso: código, propósitos, vigencia y quién autoriza; color violeta', () => {
  const d = {
    code: 'ABCD2345', label: 'Cierre de Ana', purposes: ['cierre_caja', 'devolucion'] as ('cierre_caja' | 'devolucion')[],
    issuedAtIso: '2026-10-22T16:00:00.000Z', expiresAtIso: '2026-10-22T17:30:00.000Z', branchName: 'Sucursal Centro', forUserName: null, maxUses: 1, authorizedBy: 'Gerente',
  };
  const text = JSON.stringify(buildPermitModel(d));
  assert.match(text, /TICKET DE PERMISO/);
  assert.match(text, /ABCD 2345/);
  assert.match(text, /Cierre de caja/);
  assert.match(text, /Devolución/);
  assert.match(text, /Duración: 1 h 30 min/);
  assert.match(text, /Cualquier usuario/);
  assert.match(text, /Usos: 1/);
  assert.match(text, /Autoriza:/);
  assert.match(text, /Gerente/);
  const html = permitHtml(d);
  assert.ok(html.includes('#5B3A8C'), 'violeta');
  assert.ok(!closureHtml({ business: 'x', branchName: 'x', terminalCode: 'x', openedAtIso: '2026-10-22T16:00:00.000Z', openedByName: 'x', openingCents: 0, closedAtIso: '2026-10-22T16:00:00.000Z', closedByName: 'x', breakdown: { cashSalesCents: 0, cashInCents: 0, withdrawalsCents: 0, expensesCents: 0, cashRefundsCents: 0, byMethod: { efectivo: 0, tarjeta: 0, transferencia: 0, otro: 0 }, operations: 0 }, expectedCents: 0, countedCents: 0, differenceCents: 0, authorizedByName: null, authorization: null, provisional: false }).includes('#5B3A8C'), 'el cierre no usa el violeta');
  assert.equal(groupCode('abcd2345'), 'abcd 2345');
  assert.equal(groupCode('ABCDEFGHJK'), 'ABCD EFGH JK');
});
