import { describe, expect, it } from 'vitest';
import type { ReportAdjustment, ReportSale } from '@amara/shared';
import {
  addDays, addMonths, buildDashboard, classifyStock, dailySeries, mondayOf, periodReport, RangeInputError, resolveRange, stockState, todayRange, toReportSale,
} from '../src/stats.ts';

const sale = (id: string, createdAt: string, total: number, method: 'efectivo' | 'tarjeta' = 'efectivo', branchId = 'b1', qty = 1, cost = 4000): ReportSale => ({
  id, branchId, createdAt, totalCents: total, payments: [{ method, amountCents: total }],
  items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'Chica', qty, unitCostCents: cost, netCents: total }],
});
const cancel = (saleId: string, createdAt: string, amount: number, branchId = 'b1'): ReportAdjustment => ({
  id: `a-${saleId}`, saleId, branchId, type: 'cancelacion', createdAt, amountCents: amount, payments: [{ method: 'efectivo', amountCents: amount }],
  items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'Chica', qty: 1, unitCostCents: 4000, netCents: amount, restock: true }],
});

describe('fechas de México', () => {
  it('"hoy" empieza a las 00:00 de México (06:00Z) y termina ahora', () => {
    const t = todayRange(new Date('2026-10-22T03:30:00.000Z')); // 21/oct 21:30 en México
    expect(t.day).toBe('2026-10-21');
    expect(t.from).toBe('2026-10-21T06:00:00.000Z');
    expect(t.to).toBe('2026-10-22T03:30:00.001Z');
  });

  it('una venta de las 23:30 de México cuenta en ese día y no en el siguiente', () => {
    const late = sale('s1', '2026-10-22T05:30:00.000Z', 1000); // 21/oct 23:30 MX
    const s = dailySeries([late], [], '2026-10-21', '2026-10-22');
    expect(s.map((d) => d.tickets)).toEqual([1, 0]);
  });

  it('semanas empiezan en lunes', () => {
    expect(mondayOf('2026-10-22')).toBe('2026-10-19'); // jueves
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // domingo
  });

  it('aritmética de días y meses', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addMonths('2026-10-01', -11)).toBe('2025-11-01');
  });

  it('resolveRange valida orden y tamaño', () => {
    const now = new Date('2026-10-22T18:00:00.000Z');
    expect(() => resolveRange({ from: '2026-10-22', to: '2026-10-01' }, now, (t) => t)).toThrow(RangeInputError);
    expect(() => resolveRange({ from: '2020-01-01', to: '2026-10-01' }, now, (t) => t)).toThrow(RangeInputError);
    const r = resolveRange({}, now, (t) => `${t.slice(0, 7)}-01`);
    expect(r.fromDay).toBe('2026-10-01');
    expect(r.toDay).toBe('2026-10-22');
    expect(r.from).toBe('2026-10-01T06:00:00.000Z');
    expect(r.to).toBe('2026-10-23T06:00:00.000Z');
  });
});

describe('series, informes y tablero', () => {
  const sales = [sale('s1', '2026-10-20T18:00:00.000Z', 10000), sale('s2', '2026-10-21T18:00:00.000Z', 20000, 'tarjeta'), sale('s3', '2026-10-22T18:00:00.000Z', 5000)];
  const adjs = [cancel('s2', '2026-10-22T19:00:00.000Z', 20000)];

  it('serie diaria incluye días vacíos y resta cancelaciones el día en que se registran', () => {
    const s = dailySeries(sales, adjs, '2026-10-19', '2026-10-22');
    expect(s.map((d) => d.day)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
    expect(s.map((d) => d.netCents)).toEqual([0, 10000, 20000, 5000 - 20000]);
    expect(s[3]!.refundsCents).toBe(20000);
  });

  it('informe diario: un resumen por día, total coherente con summarizeSales', () => {
    const rep = periodReport('daily', sales, adjs, '2026-10-20', '2026-10-22');
    expect(rep.rows).toHaveLength(3);
    expect(rep.total.grossCents).toBe(35000);
    expect(rep.total.cancelledCents).toBe(20000);
    expect(rep.total.netCents).toBe(15000);
    expect(rep.rows.reduce((a, r) => a + r.summary.netCents, 0)).toBe(rep.total.netCents);
    expect(rep.note).toMatch(/NO sustituye al corte de caja/);
  });

  it('informe semanal agrupa por lunes y recorta al rango', () => {
    const rep = periodReport('weekly', sales, adjs, '2026-10-20', '2026-10-22');
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0]!.key).toBe('2026-10-19');
    expect(rep.rows[0]!.fromDay).toBe('2026-10-20');
    expect(rep.rows[0]!.toDay).toBe('2026-10-22');
  });

  it('informe mensual', () => {
    const old = sale('s0', '2026-09-15T18:00:00.000Z', 7000);
    const rep = periodReport('monthly', [old, ...sales], adjs, '2026-09-01', '2026-10-22');
    expect(rep.rows.map((r) => r.key)).toEqual(['2026-09', '2026-10']);
    expect(rep.rows[0]!.summary.netCents).toBe(7000);
  });

  it('tablero: mes con mayor importe, utilidad bruta y reparto por sucursal', () => {
    const r = resolveRange({ from: '2026-09-01', to: '2026-10-22' }, new Date('2026-10-22T18:00:00.000Z'), (t) => t);
    const other = sale('s9', '2026-09-10T18:00:00.000Z', 90000, 'efectivo', 'b2', 2, 4000);
    const d = buildDashboard([...sales, other], adjs, r, new Map([['b1', 'Sucursal 1'], ['b2', 'Sucursal 2']]));
    expect(d.bestMonth?.month).toBe('2026-09');
    expect(d.summary.grossCents).toBe(125000);
    // costo = 1*4000*3 (b1) + 2*4000 (b2) − 1*4000 (cancelación con restock) = 16000
    expect(d.summary.cogsCents).toBe(16000);
    expect(d.summary.grossProfitCents).toBe(d.summary.netCents - 16000);
    expect(d.byBranch.map((b) => b.name)).toEqual(['Sucursal 2', 'Sucursal 1']);
    expect(d.daily.length).toBe(52);
  });

  it('toReportSale elimina campos internos y mantiene los necesarios para el informe', () => {
    const r = toReportSale({ _id: 'x', branchId: 'b', createdAt: 'c', totalCents: 5, payments: [{ method: 'efectivo', amountCents: 5, tenderedCents: 10 }], items: [{ variantId: 'v', productName: 'p', variantLabel: 'l', qty: 1, unitCostCents: 1, netCents: 5, sku: 'x' }], receivedAt: 'z' });
    expect(r).toEqual({ id: 'x', branchId: 'b', createdAt: 'c', totalCents: 5, payments: [{ method: 'efectivo', amountCents: 5 }], items: [{ variantId: 'v', productName: 'p', variantLabel: 'l', qty: 1, unitCostCents: 1, netCents: 5 }] });
  });
});

describe('existencias bajas y agotadas', () => {
  it('stockState', () => {
    expect(stockState(0, 3)).toBe('agotado');
    expect(stockState(-2, 0)).toBe('agotado');
    expect(stockState(3, 3)).toBe('bajo');
    expect(stockState(4, 3)).toBe('ok');
    expect(stockState(1, 0)).toBe('ok'); // sin mínimo configurado nunca es "bajo"
  });

  it('classifyStock ignora variantes archivadas o desconocidas y ordena', () => {
    const variants = new Map([
      ['v1', { productName: 'Vela', label: 'Chica', minStock: 5, active: true }],
      ['v2', { productName: 'Incienso', label: 'Rosa', minStock: 4, active: true }],
      ['v3', { productName: 'Archivado', label: 'x', minStock: 1, active: false }],
    ]);
    const r = classifyStock(
      [
        { variantId: 'v1', branchId: 'b1', qty: 0 },
        { variantId: 'v2', branchId: 'b1', qty: 2 },
        { variantId: 'v2', branchId: 'b2', qty: 1 },
        { variantId: 'v3', branchId: 'b1', qty: 0 },
        { variantId: 'zz', branchId: 'b1', qty: 0 },
      ],
      variants,
    );
    expect(r.out.map((x) => x.productName)).toEqual(['Vela']);
    expect(r.low.map((x) => `${x.branchId}:${x.qty}`)).toEqual(['b2:1', 'b1:2']);
  });
});
