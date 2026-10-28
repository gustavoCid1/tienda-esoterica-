/** Lógica pura de la tabla de inventario: estado de existencias, búsqueda y filtros. */
import type { InventoryRow } from './types.ts';

export type StockStatus = 'agotado' | 'bajo' | 'ok';

/** Agotado: sin existencia. Bajo mínimo: hay, pero no más que el mínimo configurado (y el mínimo es > 0). */
export function stockStatus(qty: number, minStock: number): StockStatus {
  if (qty <= 0) return 'agotado';
  if (minStock > 0 && qty <= minStock) return 'bajo';
  return 'ok';
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  agotado: 'Agotado',
  bajo: 'Bajo mínimo',
  ok: 'Disponible',
};

/** Minúsculas y sin acentos, para búsquedas tolerantes ("cristal" encuentra "Cristál"). */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function haystack(r: InventoryRow): string {
  return normalizeText(
    [r.productName, r.category, r.type, r.variantLabel, r.sku, r.barcode, r.code, r.location, r.branchName].join(' '),
  );
}

/** Todas las palabras de la búsqueda deben aparecer en nombre, categoría, variante, SKU o códigos. */
export function matchesQuery(r: InventoryRow, query: string): boolean {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const h = haystack(r);
  return tokens.every((t) => h.includes(t));
}

export interface InventoryFilters {
  q: string;
  status: 'todos' | StockStatus;
  branchId: string;
  category: string;
  showArchived: boolean;
}

export const DEFAULT_INVENTORY_FILTERS: InventoryFilters = {
  q: '',
  status: 'todos',
  branchId: '',
  category: '',
  showArchived: false,
};

export function filterInventory(rows: InventoryRow[], f: InventoryFilters): InventoryRow[] {
  return rows.filter((r) => {
    if (!f.showArchived && r.archived) return false;
    if (f.branchId && r.branchId !== f.branchId) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.status !== 'todos' && stockStatus(r.qty, r.minStock) !== f.status) return false;
    return matchesQuery(r, f.q);
  });
}

export function uniqueCategories(rows: InventoryRow[]): string[] {
  return [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Una fila por variante (si existe en varias sucursales, se queda la primera). */
export function dedupeVariants(rows: InventoryRow[]): InventoryRow[] {
  const seen = new Set<string>();
  const out: InventoryRow[] = [];
  for (const r of rows) {
    if (seen.has(r.variantId)) continue;
    seen.add(r.variantId);
    out.push(r);
  }
  return out;
}

export function countByStatus(rows: InventoryRow[]): Record<StockStatus, number> {
  const c: Record<StockStatus, number> = { agotado: 0, bajo: 0, ok: 0 };
  for (const r of rows) c[stockStatus(r.qty, r.minStock)]++;
  return c;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  venta: 'Venta',
  devolucion: 'Devolución',
  transferencia_salida: 'Transferencia (sale)',
  transferencia_entrada: 'Transferencia (entra)',
  conteo: 'Conteo',
};

/** "+5" / "-3" / "0" para mostrar el cambio de existencia con signo. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}
