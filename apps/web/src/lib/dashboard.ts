/** Lógica pura del tablero: indicadores personalizables, datos de gráficas y normalización de respuestas. */
import type { MonthTotal, ProductRank, SalesSummary } from '@amara/shared';
import { monthLabel } from './format.ts';
import type { CashSessionRow, DashboardExtra, DashboardPrefs, InventoryRow } from './types.ts';

export interface WidgetDef {
  id: string;
  title: string;
  /** Ancho en la cuadrícula: 1 = tarjeta, 2 = bloque ancho. */
  span: 1 | 2;
}

/** Catálogo de indicadores disponibles, en su orden por defecto. */
export const WIDGETS: WidgetDef[] = [
  { id: 'kpi_today', title: 'Ventas de hoy', span: 1 },
  { id: 'kpi_week', title: 'Ventas de la semana', span: 1 },
  { id: 'kpi_month', title: 'Ventas del mes', span: 1 },
  { id: 'kpi_period', title: 'Importe del período', span: 1 },
  { id: 'kpi_tickets', title: 'Tickets', span: 1 },
  { id: 'kpi_units', title: 'Unidades vendidas', span: 1 },
  { id: 'kpi_cogs', title: 'Costo de mercancía vendida', span: 1 },
  { id: 'kpi_profit', title: 'Utilidad bruta estimada', span: 1 },
  { id: 'best_month', title: 'Mes con mayor importe', span: 1 },
  { id: 'cash', title: 'Efectivo en cortes del período', span: 2 },
  { id: 'by_branch', title: 'Ventas por sucursal', span: 2 },
  { id: 'top_units', title: 'Productos más vendidos (unidades)', span: 2 },
  { id: 'top_revenue', title: 'Productos con mayores ingresos', span: 2 },
  { id: 'months', title: 'Ingresos por mes', span: 2 },
  { id: 'out_of_stock', title: 'Agotados', span: 1 },
  { id: 'low_stock', title: 'Bajo mínimo', span: 1 },
];

export const DEFAULT_PREFS: DashboardPrefs = { order: WIDGETS.map((w) => w.id), hidden: [] };

/** Acepta cualquier cosa que devuelva el servidor y produce preferencias bien formadas. */
export function normalizePrefs(raw: unknown): DashboardPrefs {
  const known = new Set(WIDGETS.map((w) => w.id));
  const o = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; hidden?: unknown };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && known.has(x)) : []);
  const order = [...new Set(strings(o.order))];
  const hidden = [...new Set(strings(o.hidden))];
  return { order, hidden };
}

export interface ResolvedWidget {
  def: WidgetDef;
  visible: boolean;
}

/** Orden efectivo: primero lo guardado, después los indicadores nuevos en su orden por defecto. */
export function resolveWidgets(prefs: DashboardPrefs): ResolvedWidget[] {
  const byId = new Map(WIDGETS.map((w) => [w.id, w]));
  const ids = [...prefs.order.filter((id) => byId.has(id))];
  for (const w of WIDGETS) if (!ids.includes(w.id)) ids.push(w.id);
  const hidden = new Set(prefs.hidden);
  return ids.map((id) => ({ def: byId.get(id)!, visible: !hidden.has(id) }));
}

/** Mueve un indicador una posición arriba (-1) o abajo (+1) dentro del orden resuelto. */
export function moveWidget(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function toggleHidden(hidden: string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
}

/** Mes con mayor importe NETO del período (empates: el más reciente). */
export function bestMonth(months: MonthTotal[]): MonthTotal | null {
  let best: MonthTotal | null = null;
  for (const m of months) if (!best || m.netCents >= best.netCents) best = m;
  return best;
}

export interface MonthBar {
  month: string;
  label: string;
  /** Importe neto en pesos (las gráficas usan pesos; las tablas y tarjetas, centavos con formatMXN). */
  neto: number;
  bruto: number;
}

export function monthBars(months: MonthTotal[]): MonthBar[] {
  return [...months]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ month: m.month, label: monthLabel(m.month), neto: m.netCents / 100, bruto: m.grossCents / 100 }));
}

export interface RankBar {
  name: string;
  value: number;
}

/** Datos de barras: unidades (enteros) o ingresos en pesos. Recorta nombres largos. */
export function rankBars(ranks: ProductRank[], by: 'units' | 'revenue', max = 8): RankBar[] {
  return ranks.slice(0, max).map((r) => ({
    name: r.name.length > 26 ? `${r.name.slice(0, 25).trimEnd()}…` : r.name,
    value: by === 'units' ? r.units : r.revenueCents / 100,
  }));
}

function listOf<T>(...candidates: unknown[]): T[] {
  for (const c of candidates) if (Array.isArray(c)) return c as T[];
  return [];
}

/** Extrae agotados y bajo mínimo de GET /stats/dashboard aceptando nombres alternos. */
export function normalizeDashboardExtra(raw: unknown): DashboardExtra {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    outOfStock: listOf<InventoryRow>(o.outOfStock, o.agotados, o.out),
    lowStock: listOf<InventoryRow>(o.lowStock, o.bajoMinimo, o.low),
  };
}

export interface CashTotals {
  expectedCents: number;
  countedCents: number;
  closed: number;
  open: number;
  provisional: number;
}

/** Suma de efectivo esperado y contado SOLO de cortes cerrados (los abiertos no tienen conteo). */
export function sumCashSessions(sessions: Pick<CashSessionRow, 'status' | 'expectedCents' | 'countedCents' | 'provisional' | 'pendingReconcile'>[]): CashTotals {
  const t: CashTotals = { expectedCents: 0, countedCents: 0, closed: 0, open: 0, provisional: 0 };
  for (const s of sessions) {
    if (s.status === 'abierta') {
      t.open++;
      continue;
    }
    t.closed++;
    t.expectedCents += s.expectedCents ?? 0;
    t.countedCents += s.countedCents ?? 0;
    if (s.provisional || (s.pendingReconcile ?? 0) > 0) t.provisional++;
  }
  return t;
}

/** Acepta SalesSummary directo o envuelto en { summary }. Devuelve null si no tiene la forma esperada. */
export function pickSummary(raw: unknown): SalesSummary | null {
  const o = raw as { summary?: unknown; netCents?: unknown } | null;
  const s = (o && typeof o === 'object' && o.summary && typeof o.summary === 'object' ? o.summary : o) as SalesSummary | null;
  return s && typeof s === 'object' && typeof s.netCents === 'number' ? s : null;
}
