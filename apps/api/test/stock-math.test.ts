import { describe, expect, it } from 'vitest';
import { deltaMatchesType, diffStock, movementDelta, StockInputError } from '../src/stock-math.ts';

describe('movementDelta', () => {
  it('entrada, salida, ajuste', () => {
    expect(movementDelta('entrada', 5, 10)).toBe(5);
    expect(movementDelta('salida', 3, 10)).toBe(-3);
    expect(movementDelta('ajuste', -2, 10)).toBe(-2);
  });
  it('conteo registra la diferencia, no pisa la existencia', () => {
    expect(movementDelta('conteo', 7, 10)).toBe(-3);
    expect(movementDelta('conteo', 12, 10)).toBe(2);
    expect(movementDelta('conteo', 10, 10)).toBe(0);
  });
  it('rechaza cantidades inválidas', () => {
    expect(() => movementDelta('entrada', 0, 0)).toThrow(StockInputError);
    expect(() => movementDelta('salida', -1, 0)).toThrow(StockInputError);
    expect(() => movementDelta('ajuste', 0, 0)).toThrow(StockInputError);
    expect(() => movementDelta('conteo', -1, 0)).toThrow(StockInputError);
    expect(() => movementDelta('entrada', 1.5, 0)).toThrow(StockInputError);
  });
});

describe('deltaMatchesType', () => {
  it('coherencia tipo/signo', () => {
    expect(deltaMatchesType('entrada', 1)).toBe(true);
    expect(deltaMatchesType('entrada', -1)).toBe(false);
    expect(deltaMatchesType('salida', -1)).toBe(true);
    expect(deltaMatchesType('salida', 0)).toBe(false);
    expect(deltaMatchesType('ajuste', 0)).toBe(false);
    expect(deltaMatchesType('conteo', 0)).toBe(true);
    expect(deltaMatchesType('entrada', 1.2)).toBe(false);
  });
});

describe('diffStock (base de reconcileStock)', () => {
  const k = (variantId: string, branchId: string, qty: number) => ({ variantId, branchId, qty });
  it('sin diferencias', () => {
    expect(diffStock([k('v', 'b', 5)], [k('v', 'b', 5)])).toEqual([]);
  });
  it('fila desviada', () => {
    expect(diffStock([k('v', 'b', 5)], [k('v', 'b', 7)])).toEqual([{ variantId: 'v', branchId: 'b', was: 7, shouldBe: 5 }]);
  });
  it('fila faltante (movimiento sin $inc)', () => {
    expect(diffStock([k('v', 'b', 3)], [])).toEqual([{ variantId: 'v', branchId: 'b', was: null, shouldBe: 3 }]);
  });
  it('suma cero sin fila no es desviación', () => {
    expect(diffStock([k('v', 'b', 0)], [])).toEqual([]);
  });
  it('fila sin movimientos con cantidad distinta de cero se lleva a 0', () => {
    expect(diffStock([], [k('v', 'b', 4)])).toEqual([{ variantId: 'v', branchId: 'b', was: 4, shouldBe: 0 }]);
  });
});
