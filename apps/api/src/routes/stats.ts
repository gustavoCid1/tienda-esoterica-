/**
 * /stats: estadísticas financieras. SOLO gerente (permiso estadisticas.ver).
 * El `router.use` del inicio hace que CUALQUIER ruta bajo /stats (incluso inexistente o futura)
 * responda 403 al vendedor y al desarrollador antes de tocar datos.
 */
import { Router } from 'express';
import { z } from 'zod';
import { PROFIT_DISCLAIMER, monthlyTotals, summarizeSales } from '@amara/shared';
import { branchScope, requirePerm } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import {
  addMonths, buildDashboard, classifyStock, dailySeries, lowStockItems, monthStart, periodReport, productSeries, RangeInputError, resolveRange, resolverFrom, todayRange,
  toReportAdjustment, toReportSale, topProductsSeries, totalsByBranch,
} from '../stats.ts';
import type { PeriodKind, ResolvedRange, VariantInfo } from '../stats.ts';
import { dayStr, sessionUser } from '../util.ts';

export const statsRouter = Router();
statsRouter.use(requirePerm('estadisticas.ver'));

const rangeQuery = z.object({ from: dayStr.optional(), to: dayStr.optional(), branchId: z.string().optional() });

function range(q: { from?: string; to?: string }, defaultFrom: (today: string) => string): ResolvedRange {
  try {
    return resolveRange(q, new Date(), defaultFrom);
  } catch (e) {
    if (e instanceof RangeInputError) throw new HttpError(400, e.message);
    throw e;
  }
}

async function load(scope: string[], fromIso: string, toIso: string) {
  const filter = { branchId: { $in: scope }, createdAt: { $gte: fromIso, $lt: toIso } };
  const [sales, adjustments] = await Promise.all([col('sales').find(filter).toArray(), col('sale_adjustments').find(filter).toArray()]);
  return { sales: sales.map(toReportSale), adjustments: adjustments.map(toReportAdjustment) };
}

async function branchNames(scope: string[]): Promise<Map<string, string>> {
  const bs = await col('branches').find({ _id: { $in: scope } }).project({ name: 1 }).toArray();
  return new Map(bs.map((b) => [b._id as string, b.name as string]));
}

/** "Resumen de ventas de hoy": 00:00 → ahora, hora de México. */
statsRouter.get(
  '/today',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional() }), req.query);
    const scope = branchScope(user, q.branchId);
    const t = todayRange();
    const { sales, adjustments } = await load(scope, t.from, t.to);
    res.json({
      day: t.day, from: t.from, to: t.to, generatedAt: new Date().toISOString(),
      summary: summarizeSales(sales, adjustments, { from: t.from, to: t.to }, 10),
      byBranch: totalsByBranch(sales, adjustments, await branchNames(scope)),
      disclaimer: PROFIT_DISCLAIMER,
    });
  }),
);

statsRouter.get(
  '/summary',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(rangeQuery, req.query);
    const r = range(q, monthStart);
    const { sales, adjustments } = await load(branchScope(user, q.branchId), r.from, r.to);
    res.json({ range: { fromDay: r.fromDay, toDay: r.toDay }, summary: summarizeSales(sales, adjustments, { from: r.from, to: r.to }, 10), disclaimer: PROFIT_DISCLAIMER });
  }),
);

/** Ventas netas por mes y mes con mayor importe. Por omisión, los últimos 12 meses. */
statsRouter.get(
  '/months',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(rangeQuery, req.query);
    const r = range(q, (today) => addMonths(monthStart(today), -11));
    const { sales, adjustments } = await load(branchScope(user, q.branchId), r.from, r.to);
    const { months, best } = monthlyTotals(sales, adjustments, { from: r.from, to: r.to });
    res.json({ range: { fromDay: r.fromDay, toDay: r.toDay }, months, best });
  }),
);

statsRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(rangeQuery, req.query);
    const scope = branchScope(user, q.branchId);
    const r = range(q, monthStart);
    const [{ sales, adjustments }, names, stockRows, variants] = await Promise.all([
      load(scope, r.from, r.to),
      branchNames(scope),
      col('stock').find({ branchId: { $in: scope } }).project({ variantId: 1, branchId: 1, qty: 1 }).toArray(),
      col('variants').find({ status: 'activo' }).project({ productId: 1, label: 1, minStock: 1 }).toArray(),
    ]);
    const products = await col('products').find({ status: 'activo' }).project({ name: 1 }).toArray();
    const pNames = new Map(products.map((p) => [p._id as string, p.name as string]));
    const vMap = new Map(
      variants.filter((v) => pNames.has(v.productId)).map((v) => [v._id as string, { productName: pNames.get(v.productId)!, label: v.label as string, minStock: Number(v.minStock ?? 0), active: true }]),
    );
    const alerts = classifyStock(stockRows.map((s) => ({ variantId: s.variantId, branchId: s.branchId, qty: Number(s.qty ?? 0) })), vMap);
    res.json({
      ...buildDashboard(sales, adjustments, r, names),
      outOfStock: alerts.out.slice(0, 100), outOfStockCount: alerts.out.length,
      lowStock: alerts.low.slice(0, 100), lowStockCount: alerts.low.length,
      disclaimer: PROFIT_DISCLAIMER,
    });
  }),
);

/** Informes agregados por periodo (no son un corte de caja). */
const reportDefaults: Record<PeriodKind, (today: string) => string> = {
  daily: (today) => new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10),
  weekly: (today) => new Date(Date.parse(`${today}T00:00:00Z`) - 55 * 86_400_000).toISOString().slice(0, 10),
  monthly: (today) => addMonths(monthStart(today), -11),
};

for (const kind of ['daily', 'weekly', 'monthly'] as const) {
  statsRouter.get(
    `/reports/${kind}`,
    ah(async (req, res) => {
      const user = sessionUser(req);
      const q = parse(rangeQuery, req.query);
      const r = range(q, reportDefaults[kind]);
      const { sales, adjustments } = await load(branchScope(user, q.branchId), r.from, r.to);
      res.json({ range: { fromDay: r.fromDay, toDay: r.toDay }, ...periodReport(kind, sales, adjustments, r.fromDay, r.toDay), series: kind === 'daily' ? dailySeries(sales, adjustments, r.fromDay, r.toDay) : undefined, disclaimer: PROFIT_DISCLAIMER });
    }),
  );
}

// ───────────────────────────── v2 ─────────────────────────────

/** variantId → producto/categoría/mínimo. `onlyActive` limita a variantes y productos activos (alertas). */
async function variantIndex(onlyActive: boolean): Promise<Map<string, VariantInfo>> {
  const [variants, products] = await Promise.all([
    col('variants').find(onlyActive ? { status: 'activo' } : {}).project({ productId: 1, label: 1, minStock: 1, status: 1 }).toArray(),
    col('products').find(onlyActive ? { status: 'activo' } : {}).project({ name: 1, category: 1, status: 1 }).toArray(),
  ]);
  const pMap = new Map(products.map((p) => [p._id as string, p]));
  const out = new Map<string, VariantInfo>();
  for (const v of variants) {
    const p = pMap.get(v.productId);
    if (!p) continue;
    out.set(v._id as string, {
      productId: v.productId, productName: p.name, label: v.label, category: p.category ?? '', minStock: Number(v.minStock ?? 0),
      active: v.status === 'activo' && p.status === 'activo',
    });
  }
  return out;
}

/** Existencias por debajo (o igual) del mínimo configurado, y negativas heredadas; las más urgentes primero. */
statsRouter.get(
  '/low-stock',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional() }), req.query);
    const scope = branchScope(user, q.branchId);
    const [stockRows, index] = await Promise.all([
      col('stock').find({ branchId: { $in: scope } }).project({ variantId: 1, branchId: 1, qty: 1 }).toArray(),
      variantIndex(true),
    ]);
    const items = lowStockItems(stockRows.map((s) => ({ variantId: s.variantId, branchId: s.branchId, qty: Number(s.qty ?? 0) })), index);
    res.json({ items });
  }),
);

const seriesQuery = z.object({
  from: dayStr.optional(),
  to: dayStr.optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  branchId: z.string().optional(),
});
/** Por omisión: 30 días (granularidad día) o 12 meses (granularidad mes). */
const seriesRange = (q: { from?: string; to?: string; granularity: 'day' | 'month' }) =>
  range(q, q.granularity === 'month' ? (today) => addMonths(monthStart(today), -11) : (today) => new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10));

/** Productos más vendidos por día o mes, y la serie de los `limit` primeros del rango. */
statsRouter.get(
  '/top-products-series',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(seriesQuery.extend({ limit: z.coerce.number().int().min(1).max(20).default(5) }), req.query);
    const r = seriesRange(q);
    const [{ sales, adjustments }, index] = await Promise.all([load(branchScope(user, q.branchId), r.from, r.to), variantIndex(false)]);
    res.json({
      range: { fromDay: r.fromDay, toDay: r.toDay }, granularity: q.granularity,
      ...topProductsSeries(sales, adjustments, resolverFrom(index), { granularity: q.granularity, fromDay: r.fromDay, toDay: r.toDay, limit: q.limit }),
    });
  }),
);

/** Serie de un producto (productId) o de una variante (variantId) + últimas ventas del mes final del rango. */
statsRouter.get(
  '/product-series',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(seriesQuery.extend({ productId: z.string().min(1).optional(), variantId: z.string().min(1).optional() }), req.query);
    if (!q.productId && !q.variantId) throw new HttpError(400, 'Indica productId o variantId');
    const r = seriesRange(q);
    const scope = branchScope(user, q.branchId);
    const [{ sales, adjustments }, index] = await Promise.all([load(scope, r.from, r.to), variantIndex(false)]);
    const result = productSeries(sales, adjustments, resolverFrom(index), new Map(), { productId: q.productId, variantId: q.variantId, granularity: q.granularity, fromDay: r.fromDay, toDay: r.toDay });
    // Los folios solo se consultan para las pocas ventas que se muestran.
    const folioDocs = await col('sales').find({ _id: { $in: result.last.map((l) => l.saleId) } as any }).project({ folio: 1 }).toArray();
    const folios = new Map(folioDocs.map((d) => [d._id as string, d.folio as string]));
    res.json({
      range: { fromDay: r.fromDay, toDay: r.toDay }, granularity: q.granularity,
      ...result, last: result.last.map((l) => ({ ...l, folio: folios.get(l.saleId) ?? l.folio })),
    });
  }),
);
