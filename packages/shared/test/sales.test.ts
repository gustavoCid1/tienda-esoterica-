import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSale, allocateDiscount, refundAmountForLine, SaleValidationError } from '../src/sales.ts';
import { toCents, formatMXN } from '../src/money.ts';

test('toCents y formatMXN', () => {
  assert.equal(toCents('1,234.50'), 123450);
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents('$0.10'), 10);
  assert.equal(formatMXN(123450), '$1,234.50');
  assert.equal(formatMXN(-5), '-$0.05');
  assert.throws(() => toCents('abc'));
});

test('venta simple con efectivo y cambio', () => {
  const r = computeSale(
    [{ variantId: 'a', qty: 2, unitPriceCents: 15000, unitCostCents: 8000 }],
    0,
    [{ method: 'efectivo', amountCents: 30000, tenderedCents: 50000 }],
  );
  assert.equal(r.totalCents, 30000);
  assert.equal(r.changeCents, 20000);
  assert.equal(r.tenderedCents, 50000);
  assert.equal(r.payments[0]!.changeCents, 20000);
});

test('descuento general se reparte y suma exacto', () => {
  const r = computeSale(
    [
      { variantId: 'a', qty: 1, unitPriceCents: 10000, unitCostCents: 1 },
      { variantId: 'b', qty: 3, unitPriceCents: 3333, unitCostCents: 1 },
    ],
    1001,
    [{ method: 'tarjeta', amountCents: 10000 + 9999 - 1001 }],
  );
  assert.equal(r.totalCents, 18998);
  assert.equal(r.lines.reduce((a, l) => a + l.netCents, 0), 18998);
  assert.equal(r.discountCents, 1001);
});

test('allocateDiscount nunca excede la línea', () => {
  const s = allocateDiscount([1, 1, 1000], 1001);
  assert.equal(s.reduce((a, b) => a + b, 0), 1001);
  assert.ok(s[0]! <= 1 && s[1]! <= 1);
});

test('el pago debe coincidir con el total', () => {
  assert.throws(
    () => computeSale([{ variantId: 'a', qty: 1, unitPriceCents: 1000, unitCostCents: 0 }], 0, [{ method: 'tarjeta', amountCents: 900 }]),
    (e: unknown) => e instanceof SaleValidationError && e.code === 'pago_no_coincide',
  );
});

test('efectivo insuficiente y pagos mixtos', () => {
  assert.throws(
    () => computeSale([{ variantId: 'a', qty: 1, unitPriceCents: 1000, unitCostCents: 0 }], 0, [{ method: 'efectivo', amountCents: 1000, tenderedCents: 500 }]),
    (e: unknown) => e instanceof SaleValidationError && e.code === 'efectivo_insuficiente',
  );
  const r = computeSale(
    [{ variantId: 'a', qty: 1, unitPriceCents: 1000, unitCostCents: 0 }],
    0,
    [{ method: 'efectivo', amountCents: 400, tenderedCents: 500 }, { method: 'tarjeta', amountCents: 600 }],
  );
  assert.equal(r.changeCents, 100);
});

test('rechaza cantidades inválidas y ventas vacías', () => {
  assert.throws(() => computeSale([], 0, []));
  assert.throws(() => computeSale([{ variantId: 'a', qty: 0, unitPriceCents: 1, unitCostCents: 0 }], 0, [{ method: 'otro', amountCents: 1 }]));
  assert.throws(() => computeSale([{ variantId: 'a', qty: 1.5, unitPriceCents: 1, unitCostCents: 0 }], 0, [{ method: 'otro', amountCents: 1 }]));
});

test('devoluciones parciales con redondeo acumulado suman el neto exacto', () => {
  const net = 1000; // 3 unidades, 333.33 c/u
  const a = refundAmountForLine(net, 3, 0, 1);
  const b = refundAmountForLine(net, 3, 1, 1);
  const c = refundAmountForLine(net, 3, 2, 1);
  assert.equal(a + b + c, net);
  assert.throws(() => refundAmountForLine(net, 3, 2, 2));
});

// ───────────────────────────── v2: líneas extra ─────────────────────────────

test('v2 extra: suma al total, qty fija 1, costo 0 y conserva descuentos y pagos exactos', () => {
  const r = computeSale(
    [
      { variantId: 'vela', qty: 2, unitPriceCents: 9000, unitCostCents: 4000 },
      { variantId: 'vela', qty: 1, unitPriceCents: 2500, unitCostCents: 0, kind: 'extra' },
    ],
    0,
    [{ method: 'efectivo', amountCents: 20500, tenderedCents: 21000 }],
  );
  assert.equal(r.subtotalCents, 20500);
  assert.equal(r.totalCents, 20500);
  assert.equal(r.changeCents, 500);
  assert.equal(r.lines[1]!.kind, 'extra');
  assert.equal(r.lines[1]!.netCents, 2500);
});

test('v2 extra: descuento general y de línea se reparten también sobre el extra, sin perder centavos', () => {
  const r = computeSale(
    [
      { variantId: 'a', qty: 3, unitPriceCents: 3333, unitCostCents: 1 },
      { variantId: 'a', qty: 1, unitPriceCents: 777, unitCostCents: 0, kind: 'extra', lineDiscountCents: 77 },
    ],
    501,
    [{ method: 'tarjeta', amountCents: 3 * 3333 + 777 - 77 - 501 }],
  );
  assert.equal(r.lines.reduce((a, l) => a + l.netCents, 0), r.totalCents);
  assert.equal(r.discountCents, 77 + 501);
  assert.equal(r.totalCents, 9999 + 700 - 501);
});

test('v2 extra: precio 0 es válido; qty distinta de 1, costo distinto de 0 o precio negativo se rechazan', () => {
  const pay = [{ method: 'efectivo' as const, amountCents: 9000 }];
  const ok = computeSale([{ variantId: 'a', qty: 1, unitPriceCents: 9000, unitCostCents: 1 }, { variantId: 'a', qty: 1, unitPriceCents: 0, unitCostCents: 0, kind: 'extra' }], 0, pay);
  assert.equal(ok.totalCents, 9000);
  const bad = (line: any) => assert.throws(() => computeSale([line], 0, pay), SaleValidationError);
  bad({ variantId: 'a', qty: 2, unitPriceCents: 9000, unitCostCents: 0, kind: 'extra' });
  bad({ variantId: 'a', qty: 1, unitPriceCents: 9000, unitCostCents: 5, kind: 'extra' });
  bad({ variantId: 'a', qty: 1, unitPriceCents: -1, unitCostCents: 0, kind: 'extra' });
  bad({ variantId: 'a', qty: 1, unitPriceCents: 9000, unitCostCents: 0, kind: 'otra' });
});
