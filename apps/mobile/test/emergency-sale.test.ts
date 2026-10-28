import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newStore, pullPayload, vendedor, B1, T1, V_CH, V_GR } from '../../../packages/database/test/helpers.ts';
import { addToCart, newCart, cartTotalCents } from '../src/lib/cart.ts';
import { summarizePayments, toPaymentInputs } from '../src/lib/payments.ts';
import { ticketLines } from '../src/lib/ticket-render.ts';

/**
 * Venta de emergencia como la hace el teléfono: SIN caja abierta (meta require_open_cash = '0'),
 * sin conexión (cola pendiente), y que sobreviva a un reinicio (se reabre el mismo archivo SQLite).
 */
test('venta de emergencia offline: folio único, cambio, existencias locales, sobrevive reinicio, ticket recuperable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'amara-mobile-'));
  const path = join(dir, 'amara.db');
  try {
    let saleId = 'e0000000-0000-4000-8000-000000000001';
    let folio = '';
    {
      const { store, raw } = await newStore({ path });
      await store.applyPull(pullPayload());
      await store.setDeviceInfo({ branchId: B1, branchCode: 'A', terminalId: T1, terminalCode: 'M1' });
      await store.setMeta('require_open_cash', '0'); // lo que hace services/database.ts

      // Carrito: 2 velas chicas (modo VENTA suma 1 por lectura) + 1 grande.
      let cart = newCart(saleId);
      const hitCh = (await store.findByCode('7501234567890', B1))[0]!;
      cart = addToCart(cart, hitCh, 1);
      cart = addToCart(cart, hitCh, 1);
      cart = addToCart(cart, (await store.findByCode('AMA00000002', B1))[0]!, 1);
      const total = cartTotalCents(cart);
      assert.equal(total, 2 * 9000 + 15000);

      const pays = [{ method: 'efectivo' as const, amountCents: total, tenderedCents: 40000 }];
      assert.equal(summarizePayments(total, pays).changeCents, 7000);

      const r = await store.registerSale({
        saleId, actor: vendedor, branchId: B1, terminalId: T1,
        items: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        payments: toPaymentInputs(pays),
      });
      folio = r.sale.folio;
      assert.match(folio, /^AMA-AM1-\d{6}-0001$/);
      assert.equal(r.sale.changeCents, 7000);
      assert.equal(r.sale.cashSessionId, null);
      assert.equal(await store.stockQty(V_CH, B1), 8); // 10 - 2 (descuento local)
      assert.equal(await store.stockQty(V_GR, B1), 3); // 4 - 1

      // Reintento con el MISMO saleId (p. ej. toque doble o app cerrada a medias): no duplica.
      const again = await store.registerSale({ saleId, actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 2 }], payments: toPaymentInputs(pays) });
      assert.equal(again.duplicate, true);
      assert.equal(await store.stockQty(V_CH, B1), 8);

      // Segunda venta: folio consecutivo distinto.
      const r2 = await store.registerSale({ saleId: 'e0000000-0000-4000-8000-000000000002', actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: [{ method: 'tarjeta', amountCents: 9000 }] });
      assert.match(r2.sale.folio, /-0002$/);
      assert.notEqual(r2.sale.folio, folio);
      assert.equal(await store.pendingCount(), 2);
      raw.close();
    }
    {
      // "Reinicio": se reabre el archivo.
      const { store, raw } = await newStore({ path });
      assert.equal(await store.pendingCount(), 2);
      const sale = await store.getSale(folio);
      assert.ok(sale);
      assert.equal(sale!.id, saleId);
      assert.equal(await store.stockQty(V_CH, B1), 7); // 10 - 2 - 1
      const t = await store.getTicket(folio);
      assert.ok(t);
      assert.match(ticketLines(t!.payload).map((l) => l.text).join('\n'), new RegExp(`Folio: ${folio}`));
      assert.equal(t!.printCount, 0);
      await store.markPrinted(saleId, ['cliente', 'tienda']);
      assert.equal((await store.getTicket(saleId))!.printCount, 2);
      saleId = '';
      raw.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
