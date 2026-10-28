import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSales } from '../src/reports.ts';
import type { ReportAdjustment, ReportSale } from '../src/reports.ts';
import { DEFAULT_EXTRA_CATEGORIES, isExtraCategory, normalizeCategory, sanitizeExtraCategories } from '../src/extras.ts';

const DAY = '2026-10-22T17:00:00.000Z';

const saleWithExtra = (): ReportSale => ({
  id: 's1', branchId: 'b1', createdAt: DAY, totalCents: 20500, payments: [{ method: 'efectivo', amountCents: 20500 }],
  items: [
    { variantId: 'v1', productName: 'Veladora', variantLabel: 'Grande', qty: 2, unitCostCents: 4000, netCents: 18000, kind: 'producto' },
    { variantId: 'v1', productName: 'Veladora', variantLabel: 'Grande', qty: 1, unitCostCents: 0, netCents: 2500, kind: 'extra' },
  ],
});

test('v2 reportes: el extra suma al importe pero NO a unidades ni al costo', () => {
  const s = summarizeSales([saleWithExtra()], []);
  assert.equal(s.grossCents, 20500);
  assert.equal(s.netCents, 20500);
  assert.equal(s.unitsSold, 2, 'solo cuentan las unidades del producto');
  assert.equal(s.cogsCents, 8000);
  assert.equal(s.grossProfitCents, 12500);
  assert.equal(s.topByUnits[0]!.units, 2);
  assert.equal(s.topByUnits[0]!.revenueCents, 20500, 'el extra suma al ingreso del producto padre');
});

test('v2 reportes: devolver un extra reintegra dinero pero no resta unidades', () => {
  const adj: ReportAdjustment = {
    id: 'a1', saleId: 's1', branchId: 'b1', type: 'devolucion', createdAt: DAY, amountCents: 2500,
    payments: [{ method: 'efectivo', amountCents: 2500 }],
    items: [{ variantId: 'v1', productName: 'Veladora', variantLabel: 'Grande', qty: 1, unitCostCents: 0, netCents: 2500, restock: false, kind: 'extra' }],
  };
  const s = summarizeSales([saleWithExtra()], [adj]);
  assert.equal(s.netCents, 18000);
  assert.equal(s.unitsSold, 2);
  assert.equal(s.cogsCents, 8000);
});

test('v2 reportes: una venta sin "kind" (datos V1) se comporta igual que antes', () => {
  const old: ReportSale = { id: 's0', branchId: 'b1', createdAt: DAY, totalCents: 9000, payments: [{ method: 'efectivo', amountCents: 9000 }], items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'Chica', qty: 1, unitCostCents: 4000, netCents: 9000 }] };
  const s = summarizeSales([old], []);
  assert.equal(s.unitsSold, 1);
  assert.equal(s.grossProfitCents, 5000);
});

test('extras: categorías por omisión y comparación sin mayúsculas ni acentos', () => {
  assert.deepEqual([...DEFAULT_EXTRA_CATEGORIES], ['Veladoras', 'Pulseras', 'Imágenes', 'Lociones']);
  assert.equal(isExtraCategory('imagenes'), true);
  assert.equal(isExtraCategory('IMÁGENES'), true);
  assert.equal(isExtraCategory('  veladoras '), true);
  assert.equal(isExtraCategory('Inciensos'), false);
  assert.equal(isExtraCategory(null), false);
  assert.equal(isExtraCategory('Inciensos', ['inciensos']), true);
  assert.equal(isExtraCategory('Velas', []), false);
  assert.equal(normalizeCategory('  Pulseras   de  Cuarzo '), 'pulseras de cuarzo');
});

test('extras: sanitizeExtraCategories recorta, quita vacíos y repetidos', () => {
  assert.deepEqual(sanitizeExtraCategories([' Veladoras ', 'veladoras', '', 'Imágenes', 'imagenes', 'Cristales  grandes']), ['Veladoras', 'Imágenes', 'Cristales grandes']);
  assert.equal(sanitizeExtraCategories(Array.from({ length: 100 }, (_, i) => `c${i}`)).length, 60);
});
