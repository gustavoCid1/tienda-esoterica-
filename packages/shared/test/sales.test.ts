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
