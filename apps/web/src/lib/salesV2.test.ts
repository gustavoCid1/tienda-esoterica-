import { describe, expect, it } from 'vitest';
import { extraLineLabel, filterSalesByType, isExtraLine, saleTypeOf, sellerLabel } from './salesV2.ts';

describe('ventas v2', () => {
  it('el tipo por omisión es venta', () => {
    expect(saleTypeOf({})).toBe('venta');
    expect(saleTypeOf({ type: null })).toBe('venta');
    expect(saleTypeOf({ type: 'limpia' })).toBe('limpia');
    expect(saleTypeOf({ type: 'otra' })).toBe('venta');
  });
  it('filtro por tipo (Historial de Limpias)', () => {
    const rows = [{ id: 1 }, { id: 2, type: 'limpia' as const }, { id: 3, type: 'venta' as const }];
    expect(filterSalesByType(rows, '').map((r) => r.id)).toEqual([1, 2, 3]);
    expect(filterSalesByType(rows, 'limpia').map((r) => r.id)).toEqual([2]);
    expect(filterSalesByType(rows, 'venta').map((r) => r.id)).toEqual([1, 3]);
  });
  it('líneas extra con su etiqueta', () => {
    expect(isExtraLine({ kind: 'extra' })).toBe(true);
    expect(isExtraLine({})).toBe(false);
    expect(extraLineLabel({ kind: 'extra', extraNote: ' Bordado ' })).toBe('Extra: Bordado');
    expect(extraLineLabel({ kind: 'extra', extraNote: null })).toBe('Extra');
    expect(extraLineLabel({ kind: 'producto', extraNote: 'x' })).toBe('');
  });
  it('quién vendió solo se muestra al gerente', () => {
    expect(sellerLabel({ sellerName: 'Ana' }, true)).toBe('Ana');
    expect(sellerLabel({ sellerName: 'Ana' }, false)).toBeNull();
    expect(sellerLabel({ sellerName: '  ' }, true)).toBeNull();
    expect(sellerLabel({}, true)).toBeNull();
  });
});
