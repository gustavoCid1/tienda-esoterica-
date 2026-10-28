/**
 * Gráficas del panel del gerente (v2): tipo de gráfica, lectura TOLERANTE de las respuestas de
 * GET /stats/top-products-series y GET /stats/product-series, y armado de los datos que dibujan
 * los componentes SVG. Lógica PURA (se prueba en test/charts.test.ts); no importa React ni react-native.
 * Imita la lógica de la web (apps/web/src/lib/series.ts) con los mismos nombres y formas de respuesta.
 */
import { colors } from '../theme.ts';
import { addDays } from './date-range.ts';

export type ChartKind = 'line' | 'bar' | 'pie';
export type Granularity = 'day' | 'month';

export const CHART_KINDS: { id: ChartKind; label: string }[] = [
  { id: 'pie', label: 'Pastel' },
  { id: 'line', label: 'Líneas' },
  { id: 'bar', label: 'Barras' },
];

export const DEFAULT_CHART_KIND: ChartKind = 'line';

/** Valor válido o null (acepta también los nombres en español). */
export function parseChartKind(v: unknown): ChartKind | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'line' || t === 'lineas' || t === 'líneas') return 'line';
  if (t === 'bar' || t === 'barras') return 'bar';
  if (t === 'pie' || t === 'pastel') return 'pie';
  return null;
}

/** Clave (en la tabla `meta` de SQLite local) donde se recuerda el tipo de gráfica de cada usuario. */
export function chartKindMetaKey(userId: string): string {
  return `mobile_chart_kind:${userId}`;
}

/** Colores de las series: el dorado y los tonos de theme.ts primero; el resto son neutros/fríos con contraste sobre blanco. */
export const SERIES_COLORS: readonly string[] = [colors.gold, '#2C5282', colors.ok, colors.danger, '#5B3A8C', colors.muted, '#8A5A00', '#2B7A78'];
export const OTHERS_COLOR = '#9B9B9B';

export function seriesColor(index: number): string {
  const n = SERIES_COLORS.length;
  return SERIES_COLORS[((index % n) + n) % n] ?? colors.muted;
}

// ───────────── Fechas de cubos ─────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-10-22" -> "22/10"; "2026-10" -> "oct 26". Cualquier otra cosa se devuelve igual. */
export function bucketLabel(bucket: string, granularity: Granularity): string {
  if (granularity === 'day') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket);
    return m ? `${m[3]}/${m[2]}` : bucket;
  }
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(bucket);
  if (!m) return bucket;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MESES[idx]} ${m[1]!.slice(2)}` : bucket;
}

/** "22/10/2026" o "octubre de 2026". */
export function bucketLabelLong(bucket: string, granularity: Granularity): string {
  if (granularity === 'day') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucket);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : bucket;
  }
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(bucket);
  if (!m) return bucket;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MESES_LARGO[idx]} de ${m[1]}` : bucket;
}

export function monthStartKey(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`;
}

/** Suma `n` meses a un día 'AAAA-MM-DD' (se normaliza al día 1). */
export function addMonthsKey(dayKey: string, n: number): string {
  const y = Number(dayKey.slice(0, 4));
  const m = Number(dayKey.slice(5, 7)) - 1;
  return new Date(Date.UTC(y, m + n, 1)).toISOString().slice(0, 10);
}

/** Cubos consecutivos entre dos días, con tope para no generar listas enormes. */
export function enumerateBuckets(granularity: Granularity, fromDay: string, toDay: string, cap = 120): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || fromDay > toDay) return out;
  if (granularity === 'day') {
    for (let d = fromDay; d <= toDay && out.length < cap; d = addDays(d, 1)) out.push(d);
    return out;
  }
  for (let d = monthStartKey(fromDay); d <= toDay && out.length < cap; d = addMonthsKey(d, 1)) out.push(d.slice(0, 7));
  return out;
}

/** Rango por omisión: 30 días (día) o 12 meses (mes) que terminan hoy. */
export function defaultRange(granularity: Granularity, todayKey: string): { from: string; to: string } {
  return granularity === 'day' ? { from: addDays(todayKey, -29), to: todayKey } : { from: addMonthsKey(todayKey, -11), to: todayKey };
}

/** Del día 1 del mes de `todayKey` a `todayKey` (ventas del producto en el mes). */
export function monthRange(todayKey: string): { from: string; to: string } {
  return { from: monthStartKey(todayKey), to: todayKey };
}

// ───────────── Modelo de datos de las respuestas ─────────────

export interface BucketProduct {
  productId: string;
  name: string;
  qty: number;
  netCents: number;
}
export interface SeriesPoint {
  bucket: string;
  qty: number;
  netCents: number;
}
export interface TopBucket {
  bucket: string;
  topProduct: { name: string; qty: number } | null;
  products: BucketProduct[];
}
export interface ProductSeriesLine {
  productId: string;
  name: string;
  points: SeriesPoint[];
}
export interface TopProductsSeries {
  buckets: TopBucket[];
  series: ProductSeriesLine[];
}
export interface LastSale {
  saleId: string;
  folio: string;
  createdAt: string;
  qty: number;
  netCents: number;
}
export interface ProductSeries {
  points: SeriesPoint[];
  totalQty: number;
  totalNetCents: number;
  last: LastSale[];
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Unidades desc, luego importe desc y nombre: ranking estable. */
export function rankProducts(products: BucketProduct[]): BucketProduct[] {
  return [...products].sort((a, b) => b.qty - a.qty || b.netCents - a.netCents || a.name.localeCompare(b.name, 'es'));
}

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

/** Si el servidor no manda `series`, se arma desde los productos de cada cubo (los `limit` con más unidades). */
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

/** Acepta la respuesta del contrato `{ buckets, series }` y completa lo que falte. Nunca lanza. */
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
      if (!isDict(s) || !text(s.name)) continue;
      const points = (Array.isArray(s.points) ? s.points : []).map(normPoint).filter((p): p is SeriesPoint => p !== null);
      series.push({ productId: text(s.productId) || text(s.name), name: text(s.name), points });
    }
  }
  if (series.length === 0) series = deriveSeries(buckets);
  return { buckets, series };
}

/** Respuesta de GET /stats/product-series. Nunca lanza; lo que falta vale 0 / lista vacía. */
export function normalizeProductSeries(raw: unknown): ProductSeries {
  const o = isDict(raw) ? raw : {};
  const points = (Array.isArray(o.points) ? o.points : []).map(normPoint).filter((p): p is SeriesPoint => p !== null);
  points.sort((a, b) => a.bucket.localeCompare(b.bucket));
  const last: LastSale[] = [];
  for (const l of Array.isArray(o.last) ? o.last : []) {
    if (!isDict(l) || !text(l.saleId)) continue;
    last.push({ saleId: text(l.saleId), folio: text(l.folio) || text(l.saleId), createdAt: text(l.createdAt), qty: num(l.qty), netCents: num(l.netCents) });
  }
  return {
    points,
    totalQty: typeof o.totalQty === 'number' ? o.totalQty : points.reduce((a, p) => a + p.qty, 0),
    totalNetCents: typeof o.totalNetCents === 'number' ? o.totalNetCents : points.reduce((a, p) => a + p.netCents, 0),
    last,
  };
}

// ───────────── Datos para dibujar ─────────────

export interface ChartSeriesKey {
  key: string;
  productId: string;
  name: string;
  color: string;
}
export interface ChartRow {
  bucket: string;
  label: string;
  /** Unidades por serie, en el mismo orden que `keys`. */
  values: number[];
}
export interface ChartData {
  keys: ChartSeriesKey[];
  rows: ChartRow[];
}

/** Un renglón por día/mes y una columna (unidades) por producto; los cubos sin ventas valen 0. */
export function buildChartData(data: TopProductsSeries, granularity: Granularity, range?: { from: string; to: string }, maxSeries = 5): ChartData {
  const lines = data.series.slice(0, maxSeries);
  const keys: ChartSeriesKey[] = lines.map((s, i) => ({ key: `s${i}`, productId: s.productId, name: s.name, color: seriesColor(i) }));
  const set = new Set<string>(data.buckets.map((b) => b.bucket));
  for (const s of lines) for (const p of s.points) set.add(p.bucket);
  if (range) for (const b of enumerateBuckets(granularity, range.from, range.to)) set.add(b);
  const rows: ChartRow[] = [...set].sort().map((bucket) => ({
    bucket,
    label: bucketLabel(bucket, granularity),
    values: lines.map((s) => s.points.find((p) => p.bucket === bucket)?.qty ?? 0),
  }));
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

/** Ranking de un cubo, o de todo el periodo (suma por producto) si `bucket` es null. */
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

/** Rebanadas del pastel: los primeros (max - 1) productos y "Otros" con el resto. Ignora cantidades <= 0. */
export function pieSlices(ranking: BucketProduct[], max = 6): PieSlice[] {
  const positive = ranking.filter((p) => p.qty > 0);
  if (positive.length <= max) return positive.map((p, i) => ({ name: p.name, value: p.qty, color: seriesColor(i) }));
  const head = positive.slice(0, max - 1);
  const rest = positive.slice(max - 1).reduce((a, p) => a + p.qty, 0);
  return [...head.map((p, i) => ({ name: p.name, value: p.qty, color: seriesColor(i) })), { name: 'Otros', value: rest, color: OTHERS_COLOR }];
}

/** Cubo más reciente con ventas; null si ninguno tuvo. */
export function latestBucketWithSales(data: TopProductsSeries): string | null {
  for (let i = data.buckets.length - 1; i >= 0; i--) {
    const b = data.buckets[i];
    if (b && topOfBucket(data, b.bucket)) return b.bucket;
  }
  return null;
}

/** ¿Hay algo que graficar? (al menos una unidad en alguna serie). */
export function hasAnySales(data: TopProductsSeries): boolean {
  return data.series.some((s) => s.points.some((p) => p.qty > 0)) || data.buckets.some((b) => b.products.some((p) => p.qty > 0));
}
