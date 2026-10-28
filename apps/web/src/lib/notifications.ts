/**
 * Notificaciones de existencias (GET /stats/low-stock): productos en o bajo su mínimo.
 * Lógica pura (notifications.test.ts).
 */
import type { LowStockItem } from './types-v2.ts';

/** Cada cuánto se vuelve a consultar mientras la pestaña está abierta. */
export const LOW_STOCK_REFRESH_MS = 60_000;

export type StockSeverity = 'agotado' | 'bajo';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Agotado si no queda nada (cero o negativo heredado); "bajo" si está en o bajo el mínimo. */
export function severityOf(item: Pick<LowStockItem, 'qty'>): StockSeverity {
  return item.qty <= 0 ? 'agotado' : 'bajo';
}

/** Más urgente primero: agotados, luego menor proporción existencia/mínimo, luego nombre. */
export function sortByUrgency(items: LowStockItem[]): LowStockItem[] {
  const ratio = (i: LowStockItem) => (i.minStock > 0 ? i.qty / i.minStock : i.qty <= 0 ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      Number(severityOf(b) === 'agotado') - Number(severityOf(a) === 'agotado') ||
      ratio(a) - ratio(b) ||
      a.productName.localeCompare(b.productName, 'es') ||
      a.label.localeCompare(b.label, 'es'),
  );
}

/** Acepta `{ items }` o un arreglo; descarta filas sin variante y deja la lista por urgencia. */
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

export function filterByBranch(items: LowStockItem[], branchId: string): LowStockItem[] {
  return branchId ? items.filter((i) => i.branchId === branchId) : items;
}
