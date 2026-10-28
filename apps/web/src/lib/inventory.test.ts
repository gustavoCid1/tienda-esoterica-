import { describe, expect, it } from 'vitest';
import { DEFAULT_INVENTORY_FILTERS, countByStatus, dedupeVariants, filterInventory, matchesQuery, stockStatus } from './inventory.ts';
import type { InventoryRow } from './types.ts';

const row = (o: Partial<InventoryRow> = {}): InventoryRow => ({
  variantId: 'v1', productId: 'p1', productName: 'Cuarzo rosa', category: 'Minerales', variantLabel: 'Piedra chica',
  sku: 'MIN-001', barcode: '7501', code: 'AMA00000001', branchId: 'b1', qty: 10, minStock: 3, costCents: 1000, priceCents: 2500, ...o,
});

describe('estado de existencias', () => {
  it('agotado, bajo mínimo y disponible', () => {
    expect(stockStatus(0, 3)).toBe('agotado');
    expect(stockStatus(-1, 0)).toBe('agotado');
    expect(stockStatus(3, 3)).toBe('bajo');
    expect(stockStatus(4, 3)).toBe('ok');
    expect(stockStatus(1, 0)).toBe('ok');
  });
});

describe('búsqueda y filtros', () => {
  it('busca por nombre, categoría, variante, SKU y códigos sin acentos', () => {
    const r = row({ productName: 'Cristál de cuarzo' });
    expect(matchesQuery(r, 'cristal')).toBe(true);
    expect(matchesQuery(r, 'minerales chica')).toBe(true);
    expect(matchesQuery(r, 'min-001')).toBe(true);
    expect(matchesQuery(r, '7501')).toBe(true);
    expect(matchesQuery(r, 'ama00000001')).toBe(true);
    expect(matchesQuery(r, 'velas')).toBe(false);
  });
  it('filtra por estado, sucursal y archivados', () => {
    const rows = [row(), row({ variantId: 'v2', qty: 0 }), row({ variantId: 'v3', qty: 2 }), row({ variantId: 'v4', branchId: 'b2', archived: true })];
    expect(filterInventory(rows, { ...DEFAULT_INVENTORY_FILTERS, status: 'agotado' }).map((r) => r.variantId)).toEqual(['v2']);
    expect(filterInventory(rows, { ...DEFAULT_INVENTORY_FILTERS, status: 'bajo' }).map((r) => r.variantId)).toEqual(['v3']);
    expect(filterInventory(rows, DEFAULT_INVENTORY_FILTERS)).toHaveLength(3);
    expect(filterInventory(rows, { ...DEFAULT_INVENTORY_FILTERS, showArchived: true, branchId: 'b2' })).toHaveLength(1);
    expect(countByStatus(rows)).toEqual({ agotado: 1, bajo: 1, ok: 2 });
  });
  it('quita variantes repetidas entre sucursales', () => {
    expect(dedupeVariants([row(), row({ branchId: 'b2' }), row({ variantId: 'v2' })])).toHaveLength(2);
  });
});
