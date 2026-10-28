import { describe, expect, it } from 'vitest';
import { badgeText, countLowStock, filterByBranch, normalizeLowStock, severityOf, sortByUrgency } from './notifications.ts';

const item = (over: Record<string, unknown> = {}) => ({
  variantId: 'v1', productId: 'p1', productName: 'Incienso', label: 'Caja', category: 'Inciensos', branchId: 'b1', qty: 2, minStock: 5, ...over,
});

describe('notificaciones de existencias', () => {
  it('severidad: agotado (cero o negativo) o bajo', () => {
    expect(severityOf({ qty: 0 })).toBe('agotado');
    expect(severityOf({ qty: -2 })).toBe('agotado');
    expect(severityOf({ qty: 5 })).toBe('bajo');
  });
  it('acepta { items } o arreglo, y descarta filas sin variante', () => {
    expect(normalizeLowStock({ items: [item(), { productName: 'sin variante' }] })).toHaveLength(1);
    expect(normalizeLowStock([item()])).toHaveLength(1);
    expect(normalizeLowStock(null)).toEqual([]);
  });
  it('ordena por urgencia: agotados primero, luego menor proporción', () => {
    const sorted = sortByUrgency(normalizeLowStock([
      item({ variantId: 'a', productName: 'A', qty: 4, minStock: 5 }),
      item({ variantId: 'b', productName: 'B', qty: 0, minStock: 5 }),
      item({ variantId: 'c', productName: 'C', qty: 1, minStock: 5 }),
      item({ variantId: 'd', productName: 'D', qty: -3, minStock: 5 }),
    ]));
    expect(sorted.map((i) => i.productName)).toEqual(['D', 'B', 'C', 'A']);
  });
  it('cuenta, filtra por sucursal y formatea el contador', () => {
    const list = normalizeLowStock([item(), item({ variantId: 'v2', qty: 0 }), item({ variantId: 'v3', branchId: 'b2' })]);
    expect(countLowStock(list)).toEqual({ total: 3, agotados: 1, bajos: 2 });
    expect(filterByBranch(list, 'b2')).toHaveLength(1);
    expect(filterByBranch(list, '')).toHaveLength(3);
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(150)).toBe('99+');
  });
});
