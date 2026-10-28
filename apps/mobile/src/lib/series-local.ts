/**
 * Agregación LOCAL de ventas por producto (sin conexión). Misma regla que el servidor
 * (apps/api/src/stats.ts): las líneas 'extra' suman importe pero no unidades; las devoluciones y
 * cancelaciones restan en SU fecha. Lógica PURA sobre los datos de LocalStore.loadReportData.
 * Solo conoce lo que ESTE teléfono tiene: la pantalla siempre lo rotula como posiblemente incompleto.
 */
import { mxDayKey, mxMonthKey } from '@amara/shared';
import type { ReportAdjustment, ReportSale } from '@amara/shared';
import { enumerateBuckets } from './charts.ts';
import type { Granularity, LastSale, ProductSeries, TopProductsSeries } from './charts.ts';

export interface ProductRef {
  productId: string;
  productName: string;
}
/** variantId -> producto. Si la variante ya no existe se usa la propia variante y el nombre guardado en la venta. */
export type ProductResolver = (variantId: string, savedName: string) => ProductRef;

export function resolverFrom(variants: Map<string, ProductRef>): ProductResolver {
  return (variantId, savedName) => variants.get(variantId) ?? { productId: variantId, productName: savedName };
}

interface Acc {
  name: string;
  qty: number;
  netCents: number;
}

const bucketOf = (g: Granularity, iso: string) => (g === 'day' ? mxDayKey(iso) : mxMonthKey(iso));

function aggregate(
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  resolve: ProductResolver,
  g: Granularity,
  keep: (ref: ProductRef, variantId: string) => boolean = () => true,
): Map<string, Map<string, Acc>> {
  const byBucket = new Map<string, Map<string, Acc>>();
  const bump = (iso: string, variantId: string, savedName: string, qty: number, cents: number) => {
    const ref = resolve(variantId, savedName);
    if (!keep(ref, variantId)) return;
    const b = bucketOf(g, iso);
    let m = byBucket.get(b);
    if (!m) {
      m = new Map();
      byBucket.set(b, m);
    }
    const cur = m.get(ref.productId) ?? { name: ref.productName, qty: 0, netCents: 0 };
    cur.qty += qty;
    cur.netCents += cents;
    m.set(ref.productId, cur);
  };
  for (const s of sales) for (const i of s.items) bump(s.createdAt, i.variantId, i.productName, i.kind === 'extra' ? 0 : i.qty, i.netCents);
  for (const a of adjustments) for (const i of a.items) bump(a.createdAt, i.variantId, i.productName, i.kind === 'extra' ? 0 : -i.qty, -i.netCents);
  return byBucket;
}

const order = (a: { qty: number; netCents: number; name: string }, b: { qty: number; netCents: number; name: string }) =>
  b.qty - a.qty || b.netCents - a.netCents || a.name.localeCompare(b.name, 'es');

/** Equivalente local de GET /stats/top-products-series. */
export function localTopSeries(
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  resolve: ProductResolver,
  p: { granularity: Granularity; fromDay: string; toDay: string; limit: number },
): TopProductsSeries {
  const agg = aggregate(sales, adjustments, resolve, p.granularity);
  const total = new Map<string, Acc>();
  for (const m of agg.values()) {
    for (const [id, a] of m) {
      const cur = total.get(id) ?? { name: a.name, qty: 0, netCents: 0 };
      cur.qty += a.qty;
      cur.netCents += a.netCents;
      total.set(id, cur);
    }
  }
  const top = [...total.entries()].map(([productId, a]) => ({ productId, ...a })).filter((x) => x.qty > 0).sort(order).slice(0, p.limit);
  const keys = enumerateBuckets(p.granularity, p.fromDay, p.toDay);
  const buckets = keys.map((bucket) => {
    const products = [...(agg.get(bucket) ?? new Map<string, Acc>()).entries()]
      .map(([productId, a]) => ({ productId, name: a.name, qty: a.qty, netCents: a.netCents }))
      .filter((x) => x.qty > 0)
      .sort(order)
      .slice(0, p.limit);
    return { bucket, topProduct: products[0] ? { name: products[0].name, qty: products[0].qty } : null, products };
  });
  const series = top.map((t) => ({
    productId: t.productId,
    name: t.name,
    points: keys.map((bucket) => {
      const a = agg.get(bucket)?.get(t.productId);
      return { bucket, qty: a?.qty ?? 0, netCents: a?.netCents ?? 0 };
    }),
  }));
  return { buckets, series };
}

/** Equivalente local de GET /stats/product-series (un producto o una variante) + últimas ventas del mes final. */
export function localProductSeries(
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  resolve: ProductResolver,
  folios: Map<string, string>,
  p: { productId?: string; variantId?: string; granularity: Granularity; fromDay: string; toDay: string; lastLimit?: number },
): ProductSeries {
  const keep = (ref: ProductRef, variantId: string) => (p.variantId ? variantId === p.variantId : ref.productId === p.productId);
  const agg = aggregate(sales, adjustments, resolve, p.granularity, keep);
  const points = enumerateBuckets(p.granularity, p.fromDay, p.toDay).map((bucket) => {
    let qty = 0;
    let netCents = 0;
    for (const a of agg.get(bucket)?.values() ?? []) {
      qty += a.qty;
      netCents += a.netCents;
    }
    return { bucket, qty, netCents };
  });

  const month = p.toDay.slice(0, 7);
  const last: LastSale[] = [];
  for (const s of sales) {
    if (mxMonthKey(s.createdAt) !== month) continue;
    let qty = 0;
    let netCents = 0;
    let hit = false;
    for (const i of s.items) {
      if (!keep(resolve(i.variantId, i.productName), i.variantId)) continue;
      hit = true;
      qty += i.kind === 'extra' ? 0 : i.qty;
      netCents += i.netCents;
    }
    if (hit) last.push({ saleId: s.id, folio: folios.get(s.id) ?? s.id, createdAt: s.createdAt, qty, netCents });
  }
  last.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    points,
    totalQty: points.reduce((a, x) => a + x.qty, 0),
    totalNetCents: points.reduce((a, x) => a + x.netCents, 0),
    last: last.slice(0, p.lastLimit ?? 20),
  };
}
