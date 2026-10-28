/**
 * Flujo de autorización y existencias contra el LocalStore REAL (SQLite en memoria vía node:sqlite), reutilizando los
 * ayudantes de packages/database/test/helpers.ts. Verifica lo que el proceso principal del escritorio delega al almacén:
 * cierre / Limpias con autorización, propósitos, bloqueo por existencias, extras sin inventario y el ticket de cierre.
 *
 * node:sqlite requiere Node 22.5+ y algunas versiones de vitest no lo resuelven: si no carga, las pruebas se OMITEN
 * (aparecen como "skipped"), no pasan en falso.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '@amara/shared';
import { StoreError } from '../../../packages/database/src/types.ts';
import { buildClosureTicketData, buildClosureTicketHtml } from '../src/shared/closure-ticket.ts';

type Helpers = typeof import('../../../packages/database/test/helpers.ts');
const h: Helpers | null = await import('../../../packages/database/test/helpers.ts').catch(() => null);

const CODE = 'ABCD2345';
const cash = (n: number) => [{ method: 'efectivo' as const, amountCents: n, tenderedCents: n }];
const failsWith = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(StoreError);
  expect((e as StoreError).code).toBe(code);
};

describe.skipIf(!h)('flujo de autorización (LocalStore real)', () => {
  const H = h as Helpers;

  async function withToken(over: Parameters<Helpers['cachedToken']>[1] = {}) {
    const ctx = await H.readyStore();
    const p = H.pullPayload();
    p.securityTokens = [H.cachedToken(CODE, over)];
    await ctx.store.applyPull(p);
    return ctx;
  }

  it('el vendedor NO cierra caja sin autorización; con token válido sí, y queda quién autorizó', async () => {
    const { store } = await withToken();
    await failsWith(store.closeCash({ actor: H.vendedor, terminalId: H.T1, countedCents: 100000 }), 'autorizacion_requerida');
    expect(await store.currentSession(H.T1)).toBeTruthy();

    const v = await store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: H.B1, userId: H.vendedor.userId });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = await store.closeCash({ actor: H.vendedor, terminalId: H.T1, countedCents: 99000, authorization: v.authorization });
    expect(r.differenceCents).toBe(-1000);
    expect(await store.currentSession(H.T1)).toBeUndefined();
    const rec = await store.getClosure(r.sessionId);
    expect(rec?.authorizedByName).toBe('Gerente');
    expect(rec?.closeAuthorization).toEqual(v.authorization);
  });

  it('la contraseña de administrador se valida offline contra el verificador local; una mala se niega', async () => {
    const { store } = await H.readyStore();
    const bad = await store.verifyActionAuthorization({ adminPassword: 'equivocada', purpose: 'cierre_caja', branchId: H.B1 });
    expect(bad.ok).toBe(false);
    const good = await store.verifyActionAuthorization({ adminPassword: H.ADMIN_PASSWORD, purpose: 'cierre_caja', branchId: H.B1 });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.authorization).toEqual({ kind: 'admin_password', adminUserId: H.gerente.userId });
    const r = await store.closeCash({ actor: H.vendedor, terminalId: H.T1, countedCents: 100000, authorization: good.authorization });
    expect(r.differenceCents).toBe(0);
  });

  it('un token de otro propósito se rechaza y no cierra la caja', async () => {
    const { store } = await withToken({ purposes: ['devolucion'] });
    const v = await store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: H.B1, userId: H.vendedor.userId });
    expect(v.ok).toBe(false);
    await failsWith(
      store.closeCash({ actor: H.vendedor, terminalId: H.T1, countedCents: 100000, authorization: { kind: 'token', tokenId: 'tok-0001' } }),
      'autorizacion_invalida',
    );
    expect(await store.currentSession(H.T1)).toBeTruthy();
  });

  it('un token vencido se rechaza', async () => {
    const { store, clock } = await withToken();
    clock.advance(2 * 3_600_000);
    const v = await store.verifyActionAuthorization({ code: CODE, purpose: 'cierre_caja', branchId: H.B1, userId: H.vendedor.userId });
    expect(v.ok).toBe(false);
  });

  it('cancelar exige autorización al vendedor; el gerente no la necesita', async () => {
    const { store } = await withToken();
    const sale = (await store.registerSale({ saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1, items: [{ variantId: H.V_CH, qty: 1 }], payments: cash(9000) })).sale;
    await failsWith(store.cancelSale({ saleId: sale.id, actor: H.vendedor, terminalId: H.T1, reason: 'error de captura' }), 'autorizacion_requerida');
    const c = await store.cancelSale({ saleId: sale.id, actor: H.vendedor, terminalId: H.T1, reason: 'error de captura', authorization: { kind: 'token', tokenId: 'tok-0001' } });
    expect(c.amountCents).toBe(9000);
    const sale2 = (await store.registerSale({ saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1, items: [{ variantId: H.V_CH, qty: 1 }], payments: cash(9000) })).sale;
    const g = await store.cancelSale({ saleId: sale2.id, actor: H.gerente, terminalId: H.T1, reason: 'error del gerente' });
    expect(g.amountCents).toBe(9000);
  });

  it('una Limpia hecha por un vendedor exige autorización y deja registrada la suya', async () => {
    const { store } = await withToken();
    const limpia = (extra: Record<string, unknown> = {}) =>
      store.registerSale({ saleId: newId(), actor: H.vendedor, branchId: H.B1, terminalId: H.T1, type: 'limpia', items: [{ variantId: H.V_CH, qty: 1 }], payments: cash(9000), ...extra });
    await failsWith(limpia(), 'autorizacion_requerida');
    const r = await limpia({ authorization: { kind: 'token', tokenId: 'tok-0001' } });
    expect(r.sale.type).toBe('limpia');
    expect(await store.stockQty(H.V_CH, H.B1)).toBe(9);
  });

  it('bloqueo por existencias: no se vende más de lo disponible ni en 0; los saldos nunca quedan negativos', async () => {
    const { store } = await H.readyStore();
    const sell = (qty: number) => store.registerSale({ saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1, items: [{ variantId: H.V_GR, qty }], payments: cash(15000 * qty) });
    await failsWith(sell(5), 'sin_existencia'); // hay 4
    expect(await store.stockQty(H.V_GR, H.B1)).toBe(4);
    await sell(4);
    expect(await store.stockQty(H.V_GR, H.B1)).toBe(0);
    await failsWith(sell(1), 'sin_existencia');
    expect(await store.stockQty(H.V_GR, H.B1)).toBe(0);
  });

  it('un Extra sobre un producto agotado se cobra y no mueve el inventario', async () => {
    const { store } = await H.readyStore();
    await store.registerSale({ saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1, items: [{ variantId: H.V_GR, qty: 4 }], payments: cash(60000) });
    const r = await store.registerSale({
      saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1,
      items: [{ variantId: H.V_GR, qty: 1, kind: 'extra', unitPriceCents: 3000, extraNote: 'bordado' }], payments: cash(3000),
    });
    expect(r.sale.totalCents).toBe(3000);
    expect(await store.stockQty(H.V_GR, H.B1)).toBe(0);
  });

  it('el vendedor elegido (sellerName) se guarda en la venta', async () => {
    const { store } = await H.readyStore();
    const r = await store.registerSale({
      saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1, sellerId: H.vendedor.userId, sellerName: 'Vendedora',
      items: [{ variantId: H.V_CH, qty: 1 }], payments: cash(9000),
    });
    expect(r.sale.sellerId).toBe(H.vendedor.userId);
    expect(r.sale.sellerName).toBe('Vendedora');
  });

  it('del corte guardado sale el ticket de cierre con apertura, ventas, contado y responsables', async () => {
    const { store } = await H.readyStore();
    await store.registerSale({ saleId: newId(), actor: H.gerente, branchId: H.B1, terminalId: H.T1, items: [{ variantId: H.V_CH, qty: 2 }], payments: cash(18000) });
    const v = await store.verifyActionAuthorization({ adminPassword: H.ADMIN_PASSWORD, purpose: 'cierre_caja', branchId: H.B1 });
    if (!v.ok) throw new Error('debía autorizar');
    const r = await store.closeCash({ actor: H.vendedor, terminalId: H.T1, countedCents: 117000, authorization: v.authorization });
    const rec = await store.getClosure(r.sessionId);
    expect(rec).toBeTruthy();
    const data = buildClosureTicketData(rec!, { branchName: 'Sucursal Centro', terminalCode: 'P1' });
    expect(data.openingCents).toBe(100000);
    expect(data.expectedCents).toBe(118000);
    expect(data.countedCents).toBe(117000);
    expect(data.differenceCents).toBe(-1000);
    expect(data.closedByName).toBe('Vendedora');
    expect(data.authorizedBy).toBe('Contraseña de administrador (Gerente)');
    const html = buildClosureTicketHtml(data, { paperMm: 80 });
    expect(html).toContain('Faltante $10.00');
    expect(html).toContain('Vendedora');
  });
});
