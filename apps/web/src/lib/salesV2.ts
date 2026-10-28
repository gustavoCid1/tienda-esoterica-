/**
 * Ventas v2 en el panel: tipo (venta / limpia), quién vendió y líneas Extra. Lógica pura
 * (salesV2.test.ts). `sellerName` solo se muestra al gerente y nunca se imprime en el ticket.
 */
import type { SaleItemV2, SaleType } from './types-v2.ts';

export type SaleTypeFilter = '' | SaleType;

/** Tipo efectivo: por omisión 'venta' (las ventas anteriores a la v2 no traen el campo). */
export function saleTypeOf(sale: { type?: SaleType | string | null }): SaleType {
  return sale.type === 'limpia' ? 'limpia' : 'venta';
}

export const SALE_TYPE_LABEL: Record<SaleType, string> = { venta: 'Venta', limpia: 'Limpia' };

/** Filtro por tipo en el navegador (respaldo por si el servidor ignora el parámetro `type`). */
export function filterSalesByType<T extends { type?: SaleType | string | null }>(rows: T[], type: SaleTypeFilter): T[] {
  return type === '' ? rows : rows.filter((r) => saleTypeOf(r) === type);
}

export function isExtraLine(item: Pick<SaleItemV2, 'kind'>): boolean {
  return item.kind === 'extra';
}

/** Texto de una línea Extra: "Extra: <nota>" (o solo "Extra" si no tiene nota). */
export function extraLineLabel(item: Pick<SaleItemV2, 'kind' | 'extraNote'>): string {
  if (!isExtraLine(item)) return '';
  const note = (item.extraNote ?? '').trim();
  return note ? `Extra: ${note}` : 'Extra';
}

/** Quién vendió, listo para mostrar; null si no hay dato o la persona no es gerente. */
export function sellerLabel(sale: { sellerName?: string | null }, isManager: boolean): string | null {
  if (!isManager) return null;
  const name = (sale.sellerName ?? '').trim();
  return name === '' ? null : name;
}
