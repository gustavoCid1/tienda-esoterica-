/**
 * Series de productos más vendidos por día o mes (GET /stats/top-products-series) y selección del
 * tipo de gráfica. Lógica pura, sin React ni recharts (probada en series.test.ts).
 */
import type {
  BucketProduct, ChartKind, ProductSeriesLine, SeriesGranularity, SeriesPoint, TopBucket, TopProductsSeries,
} from './types-v2.ts';

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/* ------------------------------------------------------------ Tipo de gráfica */

export const CHART_KINDS: { id: ChartKind; label: string }[] = [
  { id: 'line', label: 'Líneas' },
  { id: 'bar', label: 'Barras' },
  { id: 'pie', label: 'Pastel' },
];

export const DEFAULT_CHART_KIND: ChartKind = 'line';

/** Valor válido o null (acepta también los nombres en español: lineas, barras, pastel). */
export function parseChartKind(v: unknown): ChartKind | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'line' || t === 'lineas' || t === 'líneas') return 'line';
  if (t === 'bar' || t === 'barras') return 'bar';
  if (t === 'pie' || t === 'pastel') return 'pie';
  return null;
}

/**
 * Tipo de gráfica efectivo: lo guardado en el servidor para el usuario manda; si no hay, lo último
 * guardado en este navegador; si tampoco, líneas.
 */
export function resolveChartKind(serverValue: unknown, localValue: unknown): ChartKind {
  return parseChartKind(serverValue) ?? parseChartKind(localValue) ?? DEFAULT_CHART_KIND;
}

/** Clave de almacenamiento local por usuario (respaldo cuando el servidor no responde). */
export function chartKindStorageKey(userId: string | undefined): string {
  return `amara.web.chartKind.${userId ?? 'anon'}`;
}

/* ---------------------------------------------------------------- Colores */

/** Paleta con contraste suficiente sobre fondo blanco (dorado de marca primero). */
export const SERIES_COLORS = ['#B8860B', '#4B4B4B', '#2C5282', '#2F6B4F', '#A32622', '#5B3A8C', '#8A5A00', '#6F6F6F'];

export function seriesColor(index: number): string {
  return SERIES_COLORS[((index % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length] ?? '#4B4B4B';
}

/* ----------------------------------------------------------- Fechas de cubos */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-10-22" -> "22/10"; "2026-10" -> "oct 2026". Cualquier otra cosa se devuelve igual. */
export function bucketLabel(bucket: string, granularity: SeriesGranularity): string {
  if (granularity === 'day') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket);
    return m ? `${m[3]}/${m[2]}` : bucket;
  }
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(bucket);
  if (!m) return bucket;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MESES[idx]} ${m[1]}` : bucket;
}

/** Etiqueta larga para el texto del detalle: "22/10/2026" o "octubre de 2026". */
export function bucketLabelLong(bucket: string, granularity: SeriesGranularity): string {
  if (granularity === 'day') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : bucket;
  }
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(bucket);
  if (!m) return bucket;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${meses[idx]} de ${m[1]}` : bucket;
}

function parseDay(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Cubos consecutivos entre dos días ('AAAA-MM-DD'), con tope para no generar listas enormes. */
export function enumerateBuckets(granularity: SeriesGranularity, from: string, to: string, cap = 120): string[] {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === null || b === null || a > b) return [];
  const out: string[] = [];
  if (granularity === 'day') {
    for (let t = a; t <= b && out.length < cap; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  const start = new Date(a);
  let y = start.getUTCFullYear();
  let mo = start.getUTCMonth();
  const end = new Date(b);
  const endIdx = end.getUTCFullYear() * 12 + end.getUTCMonth();
  while (y * 12 + mo <= endIdx && out.length < cap) {
    out.push(`${y}-${String(mo + 1).padStart(2, '0')}`);
    mo++;
    if (mo > 11) {
      mo = 0;
      y++;
    }
  }
  return out;
}

/**
 * Rango que se pide al servidor.
 *  - día: el rango del tablero, acotado a 92 días hacia atrás desde "hasta" (la gráfica deja de ser legible).
 *  - mes: los últimos 12 meses terminando en el mes de "hasta" (un mes suelto no formaría una línea).
 */
export function seriesRange(granularity: SeriesGranularity, range: { from: string; to: string }): { from: string; to: string } {
  const to = parseDay(range.to);
  const from = parseDay(range.from);
  if (to === null || from === null) return range;
  if (granularity === 'day') {
    const minFrom = to - 91 * 86400000;
    return { from: new Date(Math.max(from, minFrom)).toISOString().slice(0, 10), to: range.to };
  }
  const end = new Date(to);
  const first = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  return { from: first.toISOString().slice(0, 10), to: range.to };
}

/* ------------------------------------------------------- Normalización de datos */

function normProduct(v: unknown): BucketProduct | null {
  if (!isDict(v)) return null;
  const name = text(v.name) || text(v.productName);
  if (!name) return null;
  return { productId: text(v.productId) || name, name, qty: num(v.qty), netCents: num(v.netCents) };
}

function normPoint(v: unknown): SeriesPoint | null {
  if (!isDict(v)) return null;
  const bucket = text(v.bucket);
  return bucket ? { bucket, qty: num(v.qty), netCents: num(v.netCents) } : null;
}

/** Ordena por unidades (desc), luego importe (desc) y nombre, para un ranking estable. */
export function rankProducts(products: BucketProduct[]): BucketProduct[] {
  return [...products].sort((a, b) => b.qty - a.qty || b.netCents - a.netCents || a.name.localeCompare(b.name, 'es'));
}

/** Acepta la respuesta del contrato `{ buckets, series }` y completa lo que falte. */
export function normalizeTopSeries(raw: unknown): TopProductsSeries {
  const o = isDict(raw) ? raw : {};
  const buckets: TopBucket[] = [];
  if (Array.isArray(o.buckets)) {
    for (const b of o.buckets) {
      if (!isDict(b) || !text(b.bucket)) continue;
      const products = rankProducts((Array.isArray(b.products) ? b.products : []).map(normProduct).filter((p): p is BucketProduct => p !== null));
      let top: TopBucket['topProduct'] = null;
      if (isDict(b.topProduct) && text(b.topProduct.name)) top = { name: text(b.topProduct.name), qty: num(b.topProduct.qty) };
      else if (products[0] && products[0].qty > 0) top = { name: products[0].name, qty: products[0].qty };
      buckets.push({ bucket: text(b.bucket), topProduct: top, products });
    }
  }
  buckets.sort((a, b) => a.bucket.localeCompare(b.bucket));

  let series: ProductSeriesLine[] = [];
  if (Array.isArray(o.series)) {
    for (const s of o.series) {
      if (!isDict(s)) continue;
      const name = text(s.name);
      if (!name) continue;
      const points = (Array.isArray(s.points) ? s.points : []).map(normPoint).filter((p): p is SeriesPoint => p !== null);
      series.push({ productId: text(s.productId) || name, name, points });
    }
  }
  if (series.length === 0) series = deriveSeries(buckets);
  return { buckets, series };
}

/** Si el servidor no manda `series`, se arma desde los productos de cada cubo (los 5 con más unidades). */
export function deriveSeries(buckets: TopBucket[], limit = 5): ProductSeriesLine[] {
  const totals = new Map<string, { name: string; qty: number }>();
  for (const b of buckets) {
    for (const p of b.products) {
      const cur = totals.get(p.productId) ?? { name: p.name, qty: 0 };
      cur.qty += p.qty;
      totals.set(p.productId, cur);
    }
  }
  const ids = [...totals.entries()].sort((a, b) => b[1].qty - a[1].qty || a[1].name.localeCompare(b[1].name, 'es')).slice(0, limit).map(([id]) => id);
  return ids.map((id) => ({
    productId: id,
    name: totals.get(id)?.name ?? id,
    points: buckets.flatMap((b) => {
      const p = b.products.find((x) => x.productId === id);
      return p ? [{ bucket: b.bucket, qty: p.qty, netCents: p.netCents }] : [];
    }),
  }));
}

/* ------------------------------------------------------- Datos para las gráficas */

export interface ChartSeriesKey {
  /** Clave en cada fila ("s0", "s1"...): los nombres de producto pueden traer puntos o espacios. */
  key: string;
  productId: string;
  name: string;
  color: string;
}

export interface ChartRow {
  bucket: string;
  label: string;
  [seriesKey: string]: string | number;
}

export interface ChartData {
  keys: ChartSeriesKey[];
  rows: ChartRow[];
}

/**
 * Filas para líneas y barras: un renglón por día/mes y una columna (unidades) por producto.
 * Los cubos sin ventas valen 0. Si se dan `from`/`to`, el eje X queda continuo (días sin ventas incluidos).
 */
export function buildChartData(
  data: TopProductsSeries,
  granularity: SeriesGranularity,
  range?: { from: string; to: string },
  maxSeries = 5,
): ChartData {
  const lines = data.series.slice(0, maxSeries);
  const keys: ChartSeriesKey[] = lines.map((s, i) => ({ key: `s${i}`, productId: s.productId, name: s.name, color: seriesColor(i) }));
  const set = new Set<string>(data.buckets.map((b) => b.bucket));
  for (const s of lines) for (const p of s.points) set.add(p.bucket);
  if (range) for (const b of enumerateBuckets(granularity, range.from, range.to)) set.add(b);
  const ordered = [...set].sort();
  const rows: ChartRow[] = ordered.map((bucket) => {
    const row: ChartRow = { bucket, label: bucketLabel(bucket, granularity) };
    lines.forEach((s, i) => {
      row[`s${i}`] = s.points.find((p) => p.bucket === bucket)?.qty ?? 0;
    });
    return row;
  });
  return { keys, rows };
}

/** Producto más vendido de un cubo (o null si no hubo ventas). */
export function topOfBucket(data: TopProductsSeries, bucket: string): { name: string; qty: number } | null {
  const b = data.buckets.find((x) => x.bucket === bucket);
  if (!b) return null;
  if (b.topProduct && b.topProduct.qty > 0) return b.topProduct;
  const first = rankProducts(b.products)[0];
  return first && first.qty > 0 ? { name: first.name, qty: first.qty } : null;
}

/** Ranking de un cubo, o de todo el periodo si `bucket` es null (suma por producto). */
export function rankingFor(data: TopProductsSeries, bucket: string | null): BucketProduct[] {
  if (bucket !== null) return rankProducts(data.buckets.find((b) => b.bucket === bucket)?.products ?? []);
  const acc = new Map<string, BucketProduct>();
  for (const b of data.buckets) {
    for (const p of b.products) {
      const cur = acc.get(p.productId);
      if (cur) {
        cur.qty += p.qty;
        cur.netCents += p.netCents;
      } else acc.set(p.productId, { ...p });
    }
  }
  return rankProducts([...acc.values()]);
}

export interface PieSlice {
  name: string;
  value: number;
  color: string;
}

/** Rebanadas del pastel: los primeros (max - 1) productos y "Otros" con el resto. Ignora cantidades 0. */
export function pieSlices(ranking: BucketProduct[], max = 6): PieSlice[] {
  const positive = ranking.filter((p) => p.qty > 0);
  if (positive.length <= max) return positive.map((p, i) => ({ name: p.name, value: p.qty, color: seriesColor(i) }));
  const head = positive.slice(0, max - 1);
  const rest = positive.slice(max - 1).reduce((a, p) => a + p.qty, 0);
  return [...head.map((p, i) => ({ name: p.name, value: p.qty, color: seriesColor(i) })), { name: 'Otros', value: rest, color: '#9B9B9B' }];
}

/** Cubo más reciente con ventas (para preseleccionarlo); null si ninguno tuvo. */
export function latestBucketWithSales(data: TopProductsSeries): string | null {
  for (let i = data.buckets.length - 1; i >= 0; i--) {
    const b = data.buckets[i];
    if (b && topOfBucket(data, b.bucket)) return b.bucket;
  }
  return null;
}
