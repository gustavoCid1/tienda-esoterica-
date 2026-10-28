import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '@amara/shared';
import { B1, T1, V_CH, V_GR, P1, gerente, readyStore } from '../../../packages/database/test/helpers.ts';
import {
  addMonthsKey, bucketLabel, buildChartData, defaultRange, deriveSeries, enumerateBuckets, hasAnySales, latestBucketWithSales, monthRange, normalizeProductSeries,
  normalizeTopSeries, parseChartKind, pieSlices, rankingFor, seriesColor, topOfBucket,
} from '../src/lib/charts.ts';
import { barLayout, labelIndices, lineLayout, niceMax, pieArcs, yTicks } from '../src/lib/chart-geometry.ts';
import { localProductSeries, localTopSeries, resolverFrom } from '../src/lib/series-local.ts';

// ───────────── Tipo de gráfica y fechas ─────────────
test('tipo de gráfica: acepta español e inglés y rechaza lo demás', () => {
  assert.equal(parseChartKind('pastel'), 'pie');
  assert.equal(parseChartKind('Líneas'), 'line');
  assert.equal(parseChartKind('bar'), 'bar');
  assert.equal(parseChartKind('dona'), null);
  assert.equal(parseChartKind(undefined), null);
});

test('cubos: días y meses consecutivos, rangos por omisión y etiquetas', () => {
  assert.deepEqual(enumerateBuckets('day', '2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(enumerateBuckets('month', '2026-11-15', '2027-01-03'), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(enumerateBuckets('day', '2026-10-05', '2026-10-01'), []);
  assert.deepEqual(defaultRange('day', '2026-10-28'), { from: '2026-09-29', to: '2026-10-28' });
  assert.deepEqual(defaultRange('month', '2026-10-28'), { from: '2025-11-01', to: '2026-10-28' });
  assert.deepEqual(monthRange('2026-10-28'), { from: '2026-10-01', to: '2026-10-28' });
  assert.equal(addMonthsKey('2026-01-31', -1), '2025-12-01');
  assert.equal(bucketLabel('2026-10-22', 'day'), '22/10');
  assert.equal(bucketLabel('2026-10', 'month'), 'oct 26');
  assert.equal(seriesColor(-1) !== undefined, true);
});

// ───────────── Normalización de respuestas del servidor ─────────────
const RAW = {
  buckets: [
    { bucket: '2026-10-02', topProduct: null, products: [{ productId: 'b', name: 'Incienso', qty: 2, netCents: 5000 }, { productId: 'a', name: 'Vela', qty: 5, netCents: 45000 }] },
    { bucket: '2026-10-01', topProduct: { name: 'Vela', qty: 3 }, products: [{ productId: 'a', name: 'Vela', qty: 3, netCents: 27000 }] },
    { bucket: '', products: [] },
  ],
  series: [{ productId: 'a', name: 'Vela', points: [{ bucket: '2026-10-01', qty: 3, netCents: 27000 }, { bucket: '2026-10-02', qty: 5, netCents: 45000 }] }],
};

test('top-products-series: ordena cubos, rankea y completa topProduct', () => {
  const d = normalizeTopSeries(RAW);
  assert.deepEqual(d.buckets.map((b) => b.bucket), ['2026-10-01', '2026-10-02']);
  assert.equal(d.buckets[1]!.products[0]!.name, 'Vela', 'ranking por unidades');
  assert.deepEqual(topOfBucket(d, '2026-10-02'), { name: 'Vela', qty: 5 });
  assert.equal(topOfBucket(d, '2026-10-09'), null);
  assert.equal(latestBucketWithSales(d), '2026-10-02');
  assert.equal(rankingFor(d, null)[0]!.qty, 8, 'suma del periodo');
  assert.equal(hasAnySales(d), true);
  assert.equal(hasAnySales(normalizeTopSeries(null)), false);
  assert.deepEqual(normalizeTopSeries('basura'), { buckets: [], series: [] });
});

test('si falta "series" se deriva de los cubos (máximo 5 productos)', () => {
  const buckets = normalizeTopSeries({ buckets: RAW.buckets }).buckets;
  const s = deriveSeries(buckets);
  assert.equal(s[0]!.name, 'Vela');
  assert.equal(s.length, 2);
  assert.equal(normalizeTopSeries({ buckets: RAW.buckets }).series.length, 2);
});

test('datos de gráfica: ceros en cubos vacíos y eje continuo con rango', () => {
  const d = normalizeTopSeries(RAW);
  const c = buildChartData(d, 'day', { from: '2026-10-01', to: '2026-10-04' });
  assert.deepEqual(c.rows.map((r) => r.bucket), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepEqual(c.rows.map((r) => r.values[0]), [3, 5, 0, 0]);
  assert.equal(c.keys[0]!.name, 'Vela');
});

test('pastel: agrupa el resto en "Otros" e ignora ceros', () => {
  const rank = Array.from({ length: 8 }, (_, i) => ({ productId: `p${i}`, name: `P${i}`, qty: 10 - i, netCents: 0 }));
  const slices = pieSlices([...rank, { productId: 'z', name: 'Cero', qty: 0, netCents: 0 }], 6);
  assert.equal(slices.length, 6);
  assert.equal(slices[5]!.name, 'Otros');
  assert.equal(slices[5]!.value, 5 + 4 + 3);
  assert.equal(pieSlices([], 6).length, 0);
});

test('product-series: tolera forma incompleta y suma totales', () => {
  const p = normalizeProductSeries({ points: [{ bucket: '2026-10-02', qty: 2, netCents: 100 }, { bucket: '2026-10-01', qty: 1, netCents: 50 }], last: [{ saleId: 's1', folio: 'F1', createdAt: '2026-10-02T10:00:00.000Z', qty: 2, netCents: 100 }, { nada: 1 }] });
  assert.deepEqual(p.points.map((x) => x.bucket), ['2026-10-01', '2026-10-02']);
  assert.equal(p.totalQty, 3);
  assert.equal(p.totalNetCents, 150);
  assert.equal(p.last.length, 1);
  assert.deepEqual(normalizeProductSeries(undefined), { points: [], totalQty: 0, totalNetCents: 0, last: [] });
});

// ───────────── Geometría ─────────────
test('geometría: máximos bonitos, marcas y etiquetas', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(11), 20);
  assert.equal(niceMax(120), 200);
  assert.deepEqual(yTicks(5), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(yTicks(20), [0, 10, 20]);
  assert.deepEqual(labelIndices(3, 6), [0, 1, 2]);
  const idx = labelIndices(30, 6);
  assert.equal(idx[0], 0);
  assert.equal(idx[idx.length - 1], 29);
  assert.ok(idx.length <= 8);
});

test('pastel: los ángulos suman una vuelta; un solo valor es un círculo completo', () => {
  const arcs = pieArcs([3, 1, 0, 4], 100, 100, 80);
  assert.equal(arcs.length, 4);
  assert.equal(arcs[2]!.path, '');
  const total = arcs.reduce((a, x) => a + (x.endAngle - x.startAngle), 0);
  assert.ok(Math.abs(total - Math.PI * 2) < 1e-9);
  assert.ok(Math.abs(arcs[3]!.ratio - 0.5) < 1e-9);
  const one = pieArcs([7], 50, 50, 40);
  assert.match(one[0]!.path, /A 40 40 0 1 1/);
  assert.deepEqual(pieArcs([0, 0], 1, 1, 1), []);
});

test('líneas y barras: las alturas respetan la escala y las barras se apilan', () => {
  const box = { width: 300, height: 200, left: 30, right: 10, top: 10, bottom: 30 };
  const rows = [[2, 3], [0, 5], [4, 0]];
  const bars = barLayout(rows, 2, box);
  assert.equal(bars.yMax, 5);
  const plotH = 200 - 30 - 10;
  const col0 = bars.rects.filter((r) => r.row === 0);
  assert.equal(col0.length, 2);
  assert.ok(Math.abs(col0.reduce((a, r) => a + r.height, 0) - (5 / 5) * plotH) < 0.01, 'columna de 5 llena el área');
  assert.equal(bars.rects.filter((r) => r.row === 1).length, 1, 'los ceros no dibujan');
  const top1 = bars.rects.find((r) => r.row === 1)!;
  assert.ok(Math.abs(top1.y - 10) < 0.01);
  const lines = lineLayout(rows, 2, box);
  assert.equal(lines.series.length, 2);
  assert.equal(lines.series[0]!.dots.length, 3);
  assert.equal(lines.series[1]!.dots[1]!.y, 10, 'el máximo toca el borde superior del área');
  assert.equal(lines.series[0]!.dots[1]!.y, lines.plotBottom, 'cero en la base');
  assert.equal(lineLayout([[1]], 1, box).xs.length, 1);
});

// ───────────── Agregación local contra un LocalStore real ─────────────
test('agregación local: extras no suman unidades; cancelación y devolución restan en su fecha', async () => {
  const { store, clock } = await readyStore();
  const cash = (n: number) => [{ method: 'efectivo' as const, amountCents: n, tenderedCents: n }];
  // Día 1: 2 chicas (18000) + 1 grande (15000) + extra de 5000 sobre la chica.
  const s1 = await store.registerSale({
    saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, sellerId: gerente.userId,
    items: [{ variantId: V_CH, qty: 2 }, { variantId: V_GR, qty: 1 }, { variantId: V_CH, qty: 1, kind: 'extra', unitPriceCents: 5000, extraNote: 'Aroma' }],
    payments: cash(38000),
  });
  // Día 2: se devuelve 1 chica.
  clock.advance(24 * 3600 * 1000);
  await store.refundSale({ saleId: s1.sale.id, actor: gerente, terminalId: T1, reason: 'defecto', lines: [{ saleItemId: s1.sale.items[0]!.id, qty: 1 }] });
  // Día 2: otra venta de 1 grande.
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: cash(15000) });

  const { sales, adjustments } = await store.loadReportData('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', B1);
  const resolve = resolverFrom(new Map([[V_CH, { productId: P1, productName: 'Vela ritual' }], [V_GR, { productId: P1, productName: 'Vela ritual' }]]));
  const top = localTopSeries(sales, adjustments, resolve, { granularity: 'day', fromDay: '2026-10-22', toDay: '2026-10-23', limit: 5 });
  assert.equal(top.buckets.length, 2);
  // Día 22: 3 unidades (2 chicas + 1 grande), el extra suma importe 38000 pero no unidades.
  assert.equal(top.buckets[0]!.products[0]!.qty, 3);
  assert.equal(top.buckets[0]!.products[0]!.netCents, 38000);
  // Día 23: -1 por devolución + 1 de la nueva venta = 0 unidades -> sin ventas (qty > 0 filtra).
  assert.equal(top.buckets[1]!.topProduct, null);
  assert.equal(top.series[0]!.points.map((p) => p.qty).join(','), '3,0');

  // Serie de una variante, con últimas ventas del mes.
  const folios = new Map(sales.map((s) => [s.id, `F-${s.id.slice(0, 4)}`]));
  const ps = localProductSeries(sales, adjustments, resolve, folios, { variantId: V_CH, granularity: 'day', fromDay: '2026-10-01', toDay: '2026-10-28' });
  assert.equal(ps.totalQty, 2 - 1);
  assert.equal(ps.last.length, 1);
  assert.equal(ps.last[0]!.qty, 2, 'la venta se muestra con sus unidades originales (extras no suman)');
  assert.equal(ps.last[0]!.netCents, 18000 + 5000);
  assert.equal(ps.points.length, 28);
});
