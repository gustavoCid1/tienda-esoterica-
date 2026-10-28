import { describe, expect, it } from 'vitest';
import { cashSessionKind, computeReturnAmount, grantState, minutesLeft, validateReturn } from './ops.ts';

describe('permisos temporales', () => {
  const g = { startsAt: '2026-10-22T10:00:00.000Z', expiresAt: '2026-10-22T11:00:00.000Z', revokedAt: null };
  it('calcula el estado', () => {
    expect(grantState(g, '2026-10-22T09:00:00.000Z')).toBe('programado');
    expect(grantState(g, '2026-10-22T10:30:00.000Z')).toBe('vigente');
    expect(grantState(g, '2026-10-22T11:00:00.000Z')).toBe('vencido');
    expect(grantState({ ...g, revokedAt: '2026-10-22T10:10:00.000Z' }, '2026-10-22T10:30:00.000Z')).toBe('revocado');
  });
  it('minutos restantes', () => {
    expect(minutesLeft(g.expiresAt, '2026-10-22T10:30:00.000Z')).toBe(30);
    expect(minutesLeft(g.expiresAt, '2026-10-22T12:00:00.000Z')).toBe(0);
  });
});

describe('devoluciones', () => {
  const items = [
    { id: 'i1', qty: 3, netCents: 1000, productName: 'A' },
    { id: 'i2', qty: 1, netCents: 5000, productName: 'B' },
  ];
  it('prorratea por cantidad y usa el neto exacto si se devuelve toda la línea', () => {
    expect(computeReturnAmount(items, [{ saleItemId: 'i1', qty: 1, restock: true }])).toBe(333);
    expect(computeReturnAmount(items, [{ saleItemId: 'i1', qty: 3, restock: true }, { saleItemId: 'i2', qty: 1, restock: false }])).toBe(6000);
    expect(computeReturnAmount(items, [{ saleItemId: 'x', qty: 1, restock: true }])).toBe(0);
  });
  it('valida selección, motivo y suma de pagos', () => {
    const sel = [{ saleItemId: 'i1', qty: 1, restock: true }];
    expect(validateReturn(items, [], 'motivo', [], 0)).toContain('Elige al menos un artículo a devolver');
    expect(validateReturn(items, sel, 'ab', [{ amountCents: 333 }], 333)).toContain('Escribe el motivo (mínimo 3 caracteres)');
    expect(validateReturn(items, sel, 'Producto dañado', [{ amountCents: 300 }], 333)).toHaveLength(1);
    expect(validateReturn(items, sel, 'Producto dañado', [{ amountCents: 333 }], 333)).toEqual([]);
    expect(validateReturn(items, [{ saleItemId: 'i1', qty: 9, restock: true }], 'Producto dañado', [{ amountCents: 1 }], 1)[0]).toContain('máximo 3');
  });
});

describe('cortes de caja', () => {
  it('distingue corte real, provisional, pendiente y sesión abierta', () => {
    expect(cashSessionKind({ status: 'cerrada' }).label).toBe('Corte real');
    expect(cashSessionKind({ status: 'cerrada', provisional: true }).label).toBe('Corte provisional');
    expect(cashSessionKind({ status: 'cerrada', provisional: true, pendingReconcile: 2 }).label).toBe('Pendiente de conciliación');
    expect(cashSessionKind({ status: 'abierta' }).label).toBe('Sesión abierta');
  });
});
