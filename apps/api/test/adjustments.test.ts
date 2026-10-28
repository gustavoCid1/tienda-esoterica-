import { describe, expect, it } from 'vitest';
import type { Sale, SaleAdjustment } from '@amara/shared';
import { AdjustmentError, buildCancellation, buildReturn } from '../src/adjustments.ts';
import { makeSale } from './fixtures.ts';

const base = { id: 'adj-1', userId: 'u', terminalId: 't', reason: 'Producto defectuoso', now: '2026-10-22T18:00:00.000Z', cashSessionId: 'ses' as string | null };

function twoLineSale(): Sale {
  const s = makeSale({ qty: 3 });
  s.payments = [{ method: 'efectivo', amountCents: 10000 }, { method: 'tarjeta', amountCents: 17000 }];
  s.tenderedCents = 10000;
  return s;
}

describe('buildCancellation', () => {
  it('genera un ajuste con todas las partidas, reintegro por los mismos métodos y restock', () => {
    const s = twoLineSale();
    const a = buildCancellation(s, [], base);
    expect(a.type).toBe('cancelacion');
    expect(a.amountCents).toBe(27000);
    expect(a.items.every((i) => i.restock)).toBe(true);
    expect(a.payments).toEqual([{ method: 'efectivo', amountCents: 10000 }, { method: 'tarjeta', amountCents: 17000 }]);
  });
  it('no cancela una venta ya cancelada ni con devoluciones previas', () => {
    const s = twoLineSale();
    expect(() => buildCancellation({ ...s, status: 'cancelada' }, [], base)).toThrow(AdjustmentError);
    expect(() => buildCancellation(s, [{ id: 'x' } as SaleAdjustment], base)).toThrow(/devoluciones/);
  });
  it('exige caja abierta para devolver efectivo y motivo', () => {
    const s = twoLineSale();
    expect(() => buildCancellation(s, [], { ...base, cashSessionId: null })).toThrow(/caja/i);
    expect(() => buildCancellation(s, [], { ...base, reason: ' a ' })).toThrow(/motivo/i);
  });
});

describe('buildReturn', () => {
  const sale = () => makeSale({ qty: 3 }); // 27000, una línea
  const line = (s: Sale, qty: number, restock = true) => ({ saleItemId: s.items[0]!.id, qty, restock });

  it('calcula el importe con redondeo acumulado y valida los pagos', () => {
    const s = sale();
    const a = buildReturn(s, [], { ...base, lines: [line(s, 1)], payments: [{ method: 'efectivo', amountCents: 9000 }] });
    expect(a.amountCents).toBe(9000);
    expect(a.items[0]!.netCents).toBe(9000);
  });
  it('los pagos devueltos deben sumar el importe', () => {
    const s = sale();
    expect(() => buildReturn(s, [], { ...base, lines: [line(s, 1)], payments: [{ method: 'efectivo', amountCents: 8000 }] })).toThrow(/sumar/);
  });
  it('no se puede devolver por un método más de lo cobrado', () => {
    const s = sale();
    expect(() => buildReturn(s, [], { ...base, lines: [line(s, 1)], payments: [{ method: 'tarjeta', amountCents: 9000 }] })).toThrow(/tarjeta/);
  });
  it('descuenta devoluciones previas al validar cantidades y métodos', () => {
    const s = sale();
    const first = buildReturn(s, [], { ...base, lines: [line(s, 2)], payments: [{ method: 'efectivo', amountCents: 18000 }] });
    expect(() => buildReturn(s, [first], { ...base, id: 'adj-2', lines: [line(s, 2)], payments: [{ method: 'efectivo', amountCents: 18000 }] })).toThrow(AdjustmentError);
    const second = buildReturn(s, [first], { ...base, id: 'adj-2', lines: [line(s, 1)], payments: [{ method: 'efectivo', amountCents: 9000 }] });
    expect(first.amountCents + second.amountCents).toBe(27000);
  });
  it('partida ajena o cantidad cero', () => {
    const s = sale();
    expect(() => buildReturn(s, [], { ...base, lines: [{ saleItemId: 'otra', qty: 1, restock: true }], payments: [{ method: 'efectivo', amountCents: 9000 }] })).toThrow(/no pertenece/);
  });
  it('efectivo sin caja abierta se rechaza; tarjeta no lo necesita', () => {
    const s = twoLineSale();
    s.items[0]!.netCents = 27000;
    expect(() => buildReturn(s, [], { ...base, cashSessionId: null, lines: [line(s, 1)], payments: [{ method: 'efectivo', amountCents: 9000 }] })).toThrow(/caja/i);
    const ok = buildReturn(s, [], { ...base, cashSessionId: null, lines: [line(s, 1)], payments: [{ method: 'tarjeta', amountCents: 9000 }] });
    expect(ok.cashSessionId).toBeNull();
  });
});
