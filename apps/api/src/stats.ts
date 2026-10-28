/**
 * Cálculo de estadísticas (PURO, sin base de datos). Las rutas /stats/* solo cargan datos y llaman aquí.
 * Todo el criterio contable vive en @amara/shared/reports.ts (summarizeSales, monthlyTotals); este módulo
 * añade rangos de fechas en hora de México, series diarias, informes por periodo y alertas de existencias.
 */
import { monthlyTotals, mxDayBounds, mxDayKey, mxMonthKey, summarizeSales } from '@amara/shared';
import type { MonthTotal, ReportAdjustment, ReportSale, SalesSummary } from '@amara/shared';

type Doc = Record<string, any>;

export class RangeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeInputError';
  }
}

/** Máximo de días consultables en un solo informe. */
export const MAX_RANGE_DAYS = 1100;

// ───────────────────────────── Fechas (hora de México) ─────────────────────────────

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

export function addMonths(day: string, n: number): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 10);
}

export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

/** Lunes de la semana de `day` (las semanas de los informes empiezan en lunes). */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

export const daysBetween = (fromDay: string, toDay: string) =>
  Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);

/** "Hoy": desde las 00:00 de México hasta ahora (límite superior exclusivo = ahora + 1 ms). */
export function todayRange(now: Date = new Date()): { day: string; from: string; to: string } {
  const day = mxDayKey(now);
  return { day, from: mxDayBounds(day).from, to: new Date(now.getTime() + 1).toISOString() };
}

export interface ResolvedRange {
  fromDay: string;
  toDay: string;
  /** Inicio inclusive, UTC. */
  from: string;
  /** Fin exclusivo, UTC. */
  to: string;
}

/** Rango por días (ambos inclusive). Sin parámetros usa `defaultFrom(hoy)` … hoy. */
export function resolveRange(q: { from?: string; to?: string }, now: Date, defaultFrom: (today: string) => string): ResolvedRange {
  const today = mxDayKey(now);
  const toDay = q.to ?? today;
  const fromDay = q.from ?? defaultFrom(today);
  if (fromDay > toDay) throw new RangeInputError('La fecha inicial no puede ser posterior a la final');
  if (daysBetween(fromDay, toDay) + 1 > MAX_RANGE_DAYS) throw new RangeInputError(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
  return { fromDay, toDay, from: mxDayBounds(fromDay).from, to: mxDayBounds(toDay).to };
}

// ───────────────────────────── Conversión de documentos ─────────────────────────────

export function toReportSale(s: Doc): ReportSale {
  return {
    id: s._id ?? s.id,
    branchId: s.branchId,
    createdAt: s.createdAt,
    totalCents: s.totalCents,
    payments: (s.payments ?? []).map((p: Doc) => ({ method: p.method, amountCents: p.amountCents })),
    items: (s.items ?? []).map((i: Doc) => ({
      variantId: i.variantId, productName: i.productName, variantLabel: i.variantLabel, qty: i.qty, unitCostCents: i.unitCostCents, netCents: i.netCents,
    })),
  };
}

export function toReportAdjustment(a: Doc): ReportAdjustment {
  return {
    id: a._id ?? a.id,
    saleId: a.saleId,
    branchId: a.branchId,
    type: a.type,
    createdAt: a.createdAt,
    amountCents: a.amountCents,
    payments: (a.payments ?? []).map((p: Doc) => ({ method: p.method, amountCents: p.amountCents })),
    items: (a.items ?? []).map((i: Doc) => ({
      variantId: i.variantId, productName: i.productName, variantLabel: i.variantLabel, qty: i.qty, unitCostCents: i.unitCostCents, netCents: i.netCents, restock: i.restock,
    })),
  };
}

// ───────────────────────────── Series e informes ─────────────────────────────

export interface DayPoint {
  day: string;
  tickets: number;
  grossCents: number;
  /** Cancelaciones + devoluciones registradas ese día. */
  refundsCents: number;
  netCents: number;
}

/** Una fila por día del rango (con ceros), por fecha de CADA registro, igual que el criterio de reports.ts. */
export function dailySeries(sales: ReportSale[], adjustments: ReportAdjustment[], fromDay: string, toDay: string): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) map.set(d, { day: d, tickets: 0, grossCents: 0, refundsCents: 0, netCents: 0 });
  for (const s of sales) {
    const p = map.get(mxDayKey(s.createdAt));
    if (!p) continue;
    p.tickets++;
    p.grossCents += s.totalCents;
    p.netCents += s.totalCents;
  }
  for (const a of adjustments) {
    const p = map.get(mxDayKey(a.createdAt));
    if (!p) continue;
    p.refundsCents += a.amountCents;
    p.netCents -= a.amountCents;
  }
  return [...map.values()];
}

export type PeriodKind = 'daily' | 'weekly' | 'monthly';

export interface PeriodRow {
  key: string;
  fromDay: string;
  toDay: string;
  summary: SalesSummary;
}

export const AGGREGATE_REPORT_NOTE =
  'Informe agregado de ventas por periodo. NO sustituye al corte de caja: el efectivo esperado se calcula por sesión de caja.';

function periodKey(kind: PeriodKind, iso: string): string {
  const day = mxDayKey(iso);
  return kind === 'daily' ? day : kind === 'weekly' ? mondayOf(day) : mxMonthKey(iso);
}

/** Informe diario/semanal/mensual: un `SalesSummary` por periodo, incluyendo periodos vacíos. */
export function periodReport(
  kind: PeriodKind,
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  fromDay: string,
  toDay: string,
  topN = 5,
): { kind: PeriodKind; note: string; rows: PeriodRow[]; total: SalesSummary } {
  const keys: string[] = [];
  if (kind === 'daily') for (let d = fromDay; d <= toDay; d = addDays(d, 1)) keys.push(d);
  else if (kind === 'weekly') for (let d = mondayOf(fromDay); d <= toDay; d = addDays(d, 7)) keys.push(d);
  else for (let d = monthStart(fromDay); d <= toDay; d = addMonths(d, 1)) keys.push(d.slice(0, 7));

  const bySales = new Map<string, ReportSale[]>();
  const byAdj = new Map<string, ReportAdjustment[]>();
  for (const s of sales) {
    const k = periodKey(kind, s.createdAt);
    (bySales.get(k) ?? bySales.set(k, []).get(k)!).push(s);
  }
  for (const a of adjustments) {
    const k = periodKey(kind, a.createdAt);
    (byAdj.get(k) ?? byAdj.set(k, []).get(k)!).push(a);
  }

  const rows: PeriodRow[] = keys.map((key) => {
    const start = kind === 'monthly' ? `${key}-01` : key;
    const end = kind === 'daily' ? key : kind === 'weekly' ? addDays(key, 6) : addDays(addMonths(start, 1), -1);
    return {
      key,
      fromDay: start < fromDay ? fromDay : start,
      toDay: end > toDay ? toDay : end,
      summary: summarizeSales(bySales.get(key) ?? [], byAdj.get(key) ?? [], {}, topN),
    };
  });
  return { kind, note: AGGREGATE_REPORT_NOTE, rows, total: summarizeSales(sales, adjustments, {}, topN) };
}

export interface BranchTotals {
  branchId: string;
  name: string;
  tickets: number;
  grossCents: number;
  netCents: number;
}

export function totalsByBranch(sales: ReportSale[], adjustments: ReportAdjustment[], names: Map<string, string>): BranchTotals[] {
  const ids = new Set<string>([...sales.map((s) => s.branchId), ...adjustments.map((a) => a.branchId)]);
  return [...ids]
    .map((branchId) => {
      const s = summarizeSales(sales, adjustments, { branchId }, 0);
      return { branchId, name: names.get(branchId) ?? branchId, tickets: s.ticketCount, grossCents: s.grossCents, netCents: s.netCents };
    })
    .sort((a, b) => b.netCents - a.netCents);
}

// ───────────────────────────── Existencias ─────────────────────────────

export type StockState = 'agotado' | 'bajo' | 'ok';

/** agotado: 0 o menos · bajo: por debajo o igual al mínimo configurado (si hay mínimo) · ok. */
export function stockState(qty: number, minStock: number): StockState {
  if (qty <= 0) return 'agotado';
  if (minStock > 0 && qty <= minStock) return 'bajo';
  return 'ok';
}

export interface StockAlertRow {
  variantId: string;
  branchId: string;
  productName: string;
  label: string;
  qty: number;
  minStock: number;
}

/** Agotados y bajo mínimo SOLO entre variantes activas que tienen fila de existencias en esa sucursal. */
export function classifyStock(
  rows: { variantId: string; branchId: string; qty: number }[],
  variants: Map<string, { productName: string; label: string; minStock: number; active: boolean }>,
): { out: StockAlertRow[]; low: StockAlertRow[] } {
  const out: StockAlertRow[] = [];
  const low: StockAlertRow[] = [];
  for (const r of rows) {
    const v = variants.get(r.variantId);
    if (!v || !v.active) continue;
    const state = stockState(r.qty, v.minStock);
    const row: StockAlertRow = { variantId: r.variantId, branchId: r.branchId, productName: v.productName, label: v.label, qty: r.qty, minStock: v.minStock };
    if (state === 'agotado') out.push(row);
    else if (state === 'bajo') low.push(row);
  }
  out.sort((a, b) => a.productName.localeCompare(b.productName, 'es'));
  low.sort((a, b) => a.qty / a.minStock - b.qty / b.minStock || a.productName.localeCompare(b.productName, 'es'));
  return { out, low };
}

// ───────────────────────────── Tablero ─────────────────────────────

export interface Dashboard {
  range: { fromDay: string; toDay: string };
  summary: SalesSummary;
  months: MonthTotal[];
  bestMonth: MonthTotal | null;
  daily: DayPoint[];
  byBranch: BranchTotals[];
}

export function buildDashboard(
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  range: ResolvedRange,
  branchNames: Map<string, string>,
): Dashboard {
  const filter = { from: range.from, to: range.to };
  const { months, best } = monthlyTotals(sales, adjustments, filter);
  return {
    range: { fromDay: range.fromDay, toDay: range.toDay },
    summary: summarizeSales(sales, adjustments, filter, 10),
    months,
    bestMonth: best,
    daily: dailySeries(sales, adjustments, range.fromDay, range.toDay),
    byBranch: totalsByBranch(sales, adjustments, branchNames),
  };
}
