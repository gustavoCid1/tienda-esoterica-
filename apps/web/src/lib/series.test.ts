import { describe, expect, it } from 'vitest';
import {
  CHART_KINDS, bucketLabel, bucketLabelLong, buildChartData, chartKindStorageKey, enumerateBuckets, latestBucketWithSales,
  normalizeTopSeries, parseChartKind, pieSlices, rankingFor, resolveChartKind, seriesRange, topOfBucket,
} from './series.ts';

const raw = {
  buckets: [
    { bucket: '2026-10-02', topProduct: { name: 'Incienso', qty: 4 }, products: [
      { productId: 'p2', name: 'Vela', qty: 1, netCents: 5000 }, { productId: 'p1', name: 'Incienso', qty: 4, netCents: 24000 } ] },
    { bucket: '2026-10-01', topProduct: null, products: [{ productId: 'p2', name: 'Vela', qty: 3, netCents: 15000 }] },
    { bucket: '2026-10-03', topProduct: null, products: [] },
  ],
  series: [
    { productId: 'p1', name: 'Incienso', points: [{ bucket: '2026-10-02', qty: 4, netCents: 24000 }] },
    { productId: 'p2', name: 'Vela', points: [{ bucket: '2026-10-01', qty: 3, netCents: 15000 }, { bucket: '2026-10-02', qty: 1, netCents: 5000 }] },
  ],
};

describe('normalización de la serie', () => {
  const d = normalizeTopSeries(raw);
  it('ordena cubos por fecha y los productos por unidades', () => {
    expect(d.buckets.map((b) => b.bucket)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(d.buckets[1]!.products.map((p) => p.name)).toEqual(['Incienso', 'Vela']);
  });
  it('si falta topProduct lo deduce del ranking', () => {
    expect(d.buckets[0]!.topProduct).toEqual({ name: 'Vela', qty: 3 });
    expect(d.buckets[2]!.topProduct).toBeNull();
  });
  it('tolera basura y arma las series desde los cubos si el servidor no las manda', () => {
    expect(normalizeTopSeries(null)).toEqual({ buckets: [], series: [] });
    expect(normalizeTopSeries({ buckets: [5, { bucket: '' }] }).buckets).toEqual([]);
    const sinSeries = normalizeTopSeries({ buckets: raw.buckets });
    expect(sinSeries.series.map((s) => s.name)).toEqual(['Incienso', 'Vela']); // 4 u. cada uno: empate por nombre
    expect(sinSeries.series[0]!.points).toHaveLength(1);
    expect(sinSeries.series[1]!.points).toHaveLength(2);
  });
});

describe('agrupación para las gráficas', () => {
  const d = normalizeTopSeries(raw);
  it('una fila por día y una columna por producto, con ceros donde no hubo ventas', () => {
    const c = buildChartData(d, 'day', { from: '2026-10-01', to: '2026-10-04' });
    expect(c.rows.map((r) => r.bucket)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(c.keys.map((k) => k.name)).toEqual(['Incienso', 'Vela']);
    expect(c.rows.map((r) => r.s0)).toEqual([0, 4, 0, 0]);
    expect(c.rows.map((r) => r.s1)).toEqual([3, 1, 0, 0]);
    expect(c.rows[1]!.label).toBe('02/10');
  });
  it('limita el número de series', () => {
    expect(buildChartData(d, 'day', undefined, 1).keys).toHaveLength(1);
  });
  it('producto más vendido de un día y ranking', () => {
    expect(topOfBucket(d, '2026-10-02')).toEqual({ name: 'Incienso', qty: 4 });
    expect(topOfBucket(d, '2026-10-03')).toBeNull();
    expect(topOfBucket(d, '2000-01-01')).toBeNull();
    expect(rankingFor(d, '2026-10-02').map((p) => p.name)).toEqual(['Incienso', 'Vela']);
  });
  it('ranking de todo el periodo suma por producto', () => {
    const all = rankingFor(d, null);
    expect(all.map((p) => [p.name, p.qty, p.netCents])).toEqual([['Incienso', 4, 24000], ['Vela', 4, 20000]]);
  });
  it('pastel: agrupa el resto en "Otros" e ignora ceros', () => {
    const ranking = Array.from({ length: 8 }, (_, i) => ({ productId: `p${i}`, name: `P${i}`, qty: 8 - i, netCents: 0 }));
    const s = pieSlices(ranking, 4);
    expect(s.map((x) => x.name)).toEqual(['P0', 'P1', 'P2', 'Otros']);
    expect(s[3]!.value).toBe(5 + 4 + 3 + 2 + 1);
    expect(pieSlices([{ productId: 'a', name: 'A', qty: 0, netCents: 0 }])).toEqual([]);
  });
  it('último cubo con ventas', () => {
    expect(latestBucketWithSales(d)).toBe('2026-10-02');
    expect(latestBucketWithSales({ buckets: [], series: [] })).toBeNull();
  });
});

describe('cubos y rangos', () => {
  it('enumera días y meses consecutivos', () => {
    expect(enumerateBuckets('day', '2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(enumerateBuckets('month', '2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(enumerateBuckets('day', '2026-02-03', '2026-02-01')).toEqual([]);
    expect(enumerateBuckets('day', 'x', 'y')).toEqual([]);
  });
  it('rango para día: respeta el del tablero con tope de 92 días', () => {
    expect(seriesRange('day', { from: '2026-10-01', to: '2026-10-22' })).toEqual({ from: '2026-10-01', to: '2026-10-22' });
    expect(seriesRange('day', { from: '2025-01-01', to: '2026-10-22' }).from).toBe('2026-07-23');
  });
  it('rango para mes: 12 meses terminando en el mes de "hasta"', () => {
    expect(seriesRange('month', { from: '2026-10-01', to: '2026-10-22' })).toEqual({ from: '2025-11-01', to: '2026-10-22' });
  });
  it('etiquetas', () => {
    expect(bucketLabel('2026-10-22', 'day')).toBe('22/10');
    expect(bucketLabel('2026-10', 'month')).toBe('oct 2026');
    expect(bucketLabelLong('2026-10', 'month')).toBe('octubre de 2026');
    expect(bucketLabelLong('2026-10-22', 'day')).toBe('22/10/2026');
    expect(bucketLabel('raro', 'day')).toBe('raro');
  });
});

describe('selección del tipo de gráfica', () => {
  it('reconoce los tres tipos, también en español', () => {
    expect(CHART_KINDS.map((k) => k.id)).toEqual(['line', 'bar', 'pie']);
    expect(parseChartKind('Pastel')).toBe('pie');
    expect(parseChartKind('barras')).toBe('bar');
    expect(parseChartKind('líneas')).toBe('line');
    expect(parseChartKind('radar')).toBeNull();
    expect(parseChartKind(3)).toBeNull();
  });
  it('lo guardado en el servidor manda; luego el navegador; por omisión líneas', () => {
    expect(resolveChartKind('bar', 'pie')).toBe('bar');
    expect(resolveChartKind(undefined, 'pie')).toBe('pie');
    expect(resolveChartKind('basura', 'basura')).toBe('line');
    expect(resolveChartKind(null, null)).toBe('line');
  });
  it('la clave local es por usuario', () => {
    expect(chartKindStorageKey('u1')).not.toBe(chartKindStorageKey('u2'));
    expect(chartKindStorageKey(undefined)).toContain('anon');
  });
});
