/**
 * Utilidades puras de varias pantallas de la v2: empleados que venden, Limpias, categorías de Extras,
 * resumen "de hoy" y ajustes (devoluciones/cancelaciones).
 */
import type { Sale, SaleAdjustment, TodaySaleSummary } from '@amara/shared';
import { normalizeCategory, sanitizeExtraCategories } from '@amara/shared';

// ───────────── Empleados (ventana de cobro) ─────────────

export interface Employee {
  id: string;
  name: string;
  role: string;
}

/** Empleados activos de la sucursal (vendedores y gerentes), por nombre. Si la lista local está vacía se usa al usuario actual. */
export function employeesForBranch(
  rows: { id: string; name: string; role: string; active: number | boolean; branch_ids_json: string }[],
  branchId: string,
  current: { id: string; name: string; role: string },
): Employee[] {
  const out: Employee[] = [];
  for (const r of rows) {
    if (!r.active || (r.role !== 'vendedor' && r.role !== 'gerente')) continue;
    let ids: unknown = [];
    try {
      ids = JSON.parse(r.branch_ids_json);
    } catch {
      ids = [];
    }
    if (Array.isArray(ids) && ids.includes(branchId)) out.push({ id: r.id, name: r.name, role: r.role });
  }
  if (!out.some((e) => e.id === current.id)) out.push({ id: current.id, name: current.name, role: current.role });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ───────────── Limpias ─────────────

export interface LimpiaArticle {
  variantId: string;
  name: string;
  label: string;
  priceCents: number;
  qty: number;
  /** Existencia conocida al agregar (para no pasarse). */
  available: number;
}

export const LIMPIA_SERVICE_NOTE = 'Servicio de limpia';

/**
 * Líneas de la venta 'limpia': los artículos (descuentan inventario) y, si hay cargo por servicio, UNA línea 'extra'
 * colgada de la variante del primer artículo (el contrato exige variante padre; el extra no mueve inventario).
 * Una limpia necesita al menos un artículo.
 */
export function limpiaSaleItems(
  articles: LimpiaArticle[],
  serviceCents: number,
): { variantId: string; qty: number; kind?: 'extra'; unitPriceCents?: number; extraNote?: string }[] {
  const items: { variantId: string; qty: number; kind?: 'extra'; unitPriceCents?: number; extraNote?: string }[] = articles
    .filter((a) => a.qty > 0)
    .map((a) => ({ variantId: a.variantId, qty: a.qty }));
  if (items.length > 0 && serviceCents > 0) {
    items.push({ variantId: items[0]!.variantId, qty: 1, kind: 'extra', unitPriceCents: serviceCents, extraNote: LIMPIA_SERVICE_NOTE });
  }
  return items;
}

export function limpiaTotalCents(articles: LimpiaArticle[], serviceCents: number): number {
  return articles.reduce((a, x) => a + x.qty * x.priceCents, 0) + Math.max(0, serviceCents);
}

export function addLimpiaArticle(list: LimpiaArticle[], a: Omit<LimpiaArticle, 'qty'>): { list: LimpiaArticle[]; error: string | null } {
  const cur = list.find((x) => x.variantId === a.variantId);
  const next = (cur?.qty ?? 0) + 1;
  const avail = Math.max(0, a.available);
  if (avail <= 0) return { list, error: `"${a.name}" no tiene existencia.` };
  if (next > avail) return { list, error: `Solo hay ${avail} de "${a.name}".` };
  if (cur) return { list: list.map((x) => (x.variantId === a.variantId ? { ...x, qty: next, available: avail } : x)), error: null };
  return { list: [...list, { ...a, available: avail, qty: 1 }], error: null };
}

export function setLimpiaQty(list: LimpiaArticle[], variantId: string, qty: number): { list: LimpiaArticle[]; error: string | null } {
  const cur = list.find((x) => x.variantId === variantId);
  if (!cur) return { list, error: null };
  if (qty <= 0) return { list: list.filter((x) => x.variantId !== variantId), error: null };
  if (qty > cur.available) return { list, error: `Solo hay ${cur.available} de "${cur.name}".` };
  return { list: list.map((x) => (x.variantId === variantId ? { ...x, qty } : x)), error: null };
}

// ───────────── Extras (categorías) ─────────────

/** Categorías que existen en el catálogo (únicas, sin distinguir acentos), para elegirlas con un toque. */
export function distinctCategories(all: string[]): string[] {
  const seen = new Map<string, string>();
  for (const c of all) {
    const name = String(c ?? '').trim();
    const key = normalizeCategory(name);
    if (key && !seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

export function toggleCategory(selected: string[], name: string): string[] {
  const key = normalizeCategory(name);
  const has = selected.some((s) => normalizeCategory(s) === key);
  return sanitizeExtraCategories(has ? selected.filter((s) => normalizeCategory(s) !== key) : [...selected, name]);
}

export function isSelectedCategory(selected: string[], name: string): boolean {
  const key = normalizeCategory(name);
  return selected.some((s) => normalizeCategory(s) === key);
}

/** Respuesta de GET /settings/extra-categories -> lista, o null si no se entiende. */
export function parseExtraCategories(json: unknown): string[] | null {
  if (!json || typeof json !== 'object') return null;
  const c = (json as { categories?: unknown }).categories;
  return Array.isArray(c) ? sanitizeExtraCategories(c.map(String)) : null;
}

// ───────────── Resumen de hoy ─────────────

export interface TodayView {
  items: TodaySaleSummary[];
  /** Total vendido de hoy sin contar canceladas. */
  totalCents: number;
  count: number;
}

export function summarizeToday(items: TodaySaleSummary[]): TodayView {
  const live = items.filter((i) => i.status !== 'cancelada');
  return { items, totalCents: live.reduce((a, i) => a + i.totalCents, 0), count: items.length };
}

/** Lee GET /sales/today-summary (`{ items }` o arreglo). Descarta filas sin id/folio. */
export function parseTodaySummary(json: unknown): TodaySaleSummary[] {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' && Array.isArray((json as { items?: unknown }).items) ? ((json as { items: unknown[] }).items) : [];
  const out: TodaySaleSummary[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, any>;
    if (typeof o.saleId !== 'string' || typeof o.folio !== 'string') continue;
    out.push({
      saleId: o.saleId,
      folio: o.folio,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      status: o.status === 'cancelada' ? 'cancelada' : 'completada',
      type: o.type === 'limpia' ? 'limpia' : 'venta',
      sellerId: typeof o.sellerId === 'string' ? o.sellerId : null,
      sellerName: typeof o.sellerName === 'string' ? o.sellerName : null,
      totalCents: Number.isFinite(o.totalCents) ? Number(o.totalCents) : 0,
      items: (Array.isArray(o.items) ? o.items : []).map((i: Record<string, any>) => ({
        name: String(i?.name ?? ''),
        label: String(i?.label ?? ''),
        qty: Number.isFinite(i?.qty) ? Number(i.qty) : 0,
        unitPriceCents: Number.isFinite(i?.unitPriceCents) ? Number(i.unitPriceCents) : 0,
        netCents: Number.isFinite(i?.netCents) ? Number(i.netCents) : 0,
        kind: i?.kind === 'extra' ? 'extra' : 'producto',
        extraNote: typeof i?.extraNote === 'string' ? i.extraNote : null,
      })),
    });
  }
  return out;
}

/** "Mis ventas": las que vendió este empleado (sellerId). Las anteriores a la v2 no traen empleado y no se asignan. */
export function mySales(items: TodaySaleSummary[], userId: string): TodaySaleSummary[] {
  return items.filter((i) => i.sellerId === userId);
}

// ───────────── Devoluciones y cancelaciones ─────────────

export interface RefundableLine {
  saleItemId: string;
  name: string;
  label: string;
  kind: 'producto' | 'extra';
  qty: number;
  refundedQty: number;
  remaining: number;
  unitNetCents: number;
}

/** Unidades ya devueltas por partida, a partir de los ajustes registrados de la venta. */
export function refundedByLine(adjustments: Pick<SaleAdjustment, 'items'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of adjustments) for (const it of a.items) m.set(it.saleItemId, (m.get(it.saleItemId) ?? 0) + it.qty);
  return m;
}

export function refundableLines(sale: Sale, adjustments: Pick<SaleAdjustment, 'items'>[]): RefundableLine[] {
  const done = refundedByLine(adjustments);
  return sale.items.map((i) => {
    const refundedQty = done.get(i.id) ?? 0;
    return {
      saleItemId: i.id,
      name: i.productName,
      label: i.variantLabel,
      kind: i.kind === 'extra' ? 'extra' : 'producto',
      qty: i.qty,
      refundedQty,
      remaining: Math.max(0, i.qty - refundedQty),
      unitNetCents: i.qty > 0 ? Math.round(i.netCents / i.qty) : i.netCents,
    };
  });
}

/** ¿Se puede cancelar completa? Solo si está completada y no tiene devoluciones previas. */
export function canCancelWhole(sale: Sale, adjustments: Pick<SaleAdjustment, 'items'>[]): { ok: boolean; reason?: string } {
  if (sale.status !== 'completada') return { ok: false, reason: 'El ticket ya está cancelado.' };
  if (adjustments.length > 0) return { ok: false, reason: 'El ticket ya tiene devoluciones: usa devolución para el resto.' };
  return { ok: true };
}
