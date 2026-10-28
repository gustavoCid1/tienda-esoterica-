/**
 * Existencias en o bajo el mínimo (solo gerente) y alertas SIN REPETIR. Lógica PURA (test/low-stock.test.ts).
 *
 * Regla de la alerta: se avisa UNA vez por producto/sucursal mientras siga en mínimo. Se vuelve a avisar solo si
 *  (a) pasó de "bajo" a "agotado", o (b) se recuperó (salió de la lista) y volvió a caer.
 * El estado ya avisado se guarda en la base local (meta), por usuario, para que sobreviva a reinicios.
 */
import type { CatalogHit } from '@amara/database';

export interface LowStockItem {
  variantId: string;
  productId: string;
  productName: string;
  label: string;
  category: string;
  branchId: string;
  /** Existencia tal como la conoce la fuente (puede ser negativa heredada). Para mostrar usa `shownQty`. */
  qty: number;
  minStock: number;
}

export type StockSeverity = 'agotado' | 'bajo';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Nunca se muestra una existencia negativa: se enseña 0. */
export function shownQty(qty: number): number {
  return Math.max(0, qty);
}

/** Negativo heredado (de una venta sin conexión que ya salió físicamente): se enseña 0 con aviso "por corregir". */
export function isLegacyNegative(qty: number): boolean {
  return qty < 0;
}

/** Agotado si no queda nada (cero o negativo heredado); "bajo" si está en o bajo el mínimo. */
export function severityOf(item: Pick<LowStockItem, 'qty'>): StockSeverity {
  return item.qty <= 0 ? 'agotado' : 'bajo';
}

/** Más urgente primero: negativos, agotados, menor proporción existencia/mínimo, nombre. */
export function sortByUrgency(items: LowStockItem[]): LowStockItem[] {
  const ratio = (i: LowStockItem) => (i.minStock > 0 ? i.qty / i.minStock : i.qty <= 0 ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      Number(severityOf(b) === 'agotado') - Number(severityOf(a) === 'agotado') ||
      Number(b.qty < 0) - Number(a.qty < 0) ||
      ratio(a) - ratio(b) ||
      a.productName.localeCompare(b.productName, 'es') ||
      a.label.localeCompare(b.label, 'es'),
  );
}

/** Acepta `{ items }` o un arreglo (GET /stats/low-stock); descarta filas sin variante y ordena por urgencia. */
export function normalizeLowStock(raw: unknown): LowStockItem[] {
  const list = Array.isArray(raw) ? raw : isDict(raw) && Array.isArray(raw.items) ? raw.items : [];
  const out: LowStockItem[] = [];
  for (const it of list) {
    if (!isDict(it) || !s(it.variantId)) continue;
    out.push({
      variantId: s(it.variantId),
      productId: s(it.productId),
      productName: s(it.productName) || 'Producto',
      label: s(it.label) || s(it.variantLabel),
      category: s(it.category),
      branchId: s(it.branchId),
      qty: n(it.qty),
      minStock: n(it.minStock),
    });
  }
  return sortByUrgency(out);
}

/**
 * Misma regla que el servidor (apps/api lowStockItems), sobre el catálogo LOCAL de una sucursal:
 * mínimo > 0 y existencia <= mínimo, o cualquier existencia negativa heredada. Solo variantes activas
 * (inventoryList ya las filtra).
 */
export function lowStockFromHits(hits: CatalogHit[], branchId: string): LowStockItem[] {
  const out: LowStockItem[] = [];
  for (const h of hits) {
    if (h.status !== 'activo') continue;
    if (!(h.qty < 0 || (h.minStock > 0 && h.qty <= h.minStock))) continue;
    out.push({ variantId: h.variantId, productId: h.productId, productName: h.productName, label: h.label, category: h.category, branchId, qty: h.qty, minStock: h.minStock });
  }
  return sortByUrgency(out);
}

export interface LowStockCounts {
  total: number;
  agotados: number;
  bajos: number;
}

export function countLowStock(items: LowStockItem[]): LowStockCounts {
  const agotados = items.filter((i) => severityOf(i) === 'agotado').length;
  return { total: items.length, agotados, bajos: items.length - agotados };
}

/** Contador del menú: "99+" a partir de 100; '' si no hay nada que avisar. */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

// ───────────── Alertas sin repetir ─────────────

export interface AlertState {
  v: 1;
  /** `${variantId}|${branchId}` -> nivel con el que se avisó la última vez. */
  seen: Record<string, StockSeverity>;
}

export const EMPTY_ALERT_STATE: AlertState = { v: 1, seen: {} };

export const alertKey = (i: Pick<LowStockItem, 'variantId' | 'branchId'>): string => `${i.variantId}|${i.branchId}`;

export function alertStateMetaKey(userId: string, branchId: string): string {
  return `mobile_alerts_state:${userId}:${branchId}`;
}

export function parseAlertState(raw: string | null | undefined): AlertState {
  if (!raw) return { v: 1, seen: {} };
  try {
    const o = JSON.parse(raw) as unknown;
    if (!isDict(o) || !isDict(o.seen)) return { v: 1, seen: {} };
    const seen: Record<string, StockSeverity> = {};
    for (const [k, val] of Object.entries(o.seen)) if (val === 'bajo' || val === 'agotado') seen[k] = val;
    return { v: 1, seen };
  } catch {
    return { v: 1, seen: {} };
  }
}

export const serializeAlertState = (st: AlertState): string => JSON.stringify(st);

export interface AlertPlan {
  /** Productos que hay que avisar AHORA (no avisados antes, o que empeoraron). */
  fresh: LowStockItem[];
  /** Estado a guardar SOLO si la notificación se pudo entregar. */
  next: AlertState;
}

/** Decide qué avisar y cuál es el nuevo estado. Los productos que ya no están en mínimo salen del estado. */
export function planLowStockAlerts(current: LowStockItem[], state: AlertState): AlertPlan {
  const fresh: LowStockItem[] = [];
  const seen: Record<string, StockSeverity> = {};
  for (const it of current) {
    const key = alertKey(it);
    const level = severityOf(it);
    const before = state.seen[key];
    if (before === undefined || (before === 'bajo' && level === 'agotado')) fresh.push(it);
    seen[key] = level;
  }
  return { fresh: sortByUrgency(fresh), next: { v: 1, seen } };
}

export interface AlertMessage {
  title: string;
  body: string;
}

/** Texto de la notificación del teléfono (una sola, aunque haya varios productos). */
export function alertMessage(fresh: LowStockItem[]): AlertMessage | null {
  if (fresh.length === 0) return null;
  const line = (i: LowStockItem) => `${i.productName}${i.label ? ` (${i.label})` : ''}`;
  if (fresh.length === 1) {
    const i = fresh[0]!;
    const detail = severityOf(i) === 'agotado' ? 'agotado' : `quedan ${shownQty(i.qty)}, mínimo ${i.minStock}`;
    return { title: 'Producto en mínimo', body: `${line(i)}: ${detail}.` };
  }
  const names = fresh.slice(0, 3).map(line).join(', ');
  const more = fresh.length > 3 ? ` y ${fresh.length - 3} más` : '';
  return { title: `${fresh.length} productos en mínimo`, body: `${names}${more}.` };
}
