import { describe, expect, it } from 'vitest';
import type { ReportAdjustment, ReportSale } from '@amara/shared';
import {
  addDays, addMonths, buildDashboard, bucketsInRange, classifyStock, dailySeries, lowStockItems, mondayOf, periodReport, productSeries, RangeInputError, resolveRange, resolverFrom,
  stockState, todayRange, toReportAdjustment, toReportSale, topProductsSeries,
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
    expect(r).toEqual({ id: 'x', branchId: 'b', createdAt: 'c', totalCents: 5, payments: [{ method: 'efectivo', amountCents: 5 }], items: [{ variantId: 'v', productName: 'p', variantLabel: 'l', qty: 1, unitCostCents: 1, netCents: 5, kind: 'producto' }] });
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


describe('v2: extras y series por producto', () => {
  const variants = new Map([
    ['v1', { productId: 'p1', productName: 'Vela' }],
    ['v1b', { productId: 'p1', productName: 'Vela' }],
    ['v2', { productId: 'p2', productName: 'Incienso' }],
  ]);
  const resolve = resolverFrom(variants);
  const line = (variantId: string, name: string, qty: number, net: number, kind: 'producto' | 'extra' = 'producto') => ({
    variantId, productName: name, variantLabel: 'x', qty, unitCostCents: kind === 'extra' ? 0 : 1000, netCents: net, kind,
  });
  const mk = (id: string, createdAt: string, items: ReturnType<typeof line>[]): ReportSale => ({
    id, branchId: 'b1', createdAt, totalCents: items.reduce((a, i) => a + i.netCents, 0), payments: [{ method: 'efectivo', amountCents: items.reduce((a, i) => a + i.netCents, 0) }], items,
  });
  const sales = [
    mk('s1', '2026-10-20T18:00:00.000Z', [line('v1', 'Vela', 3, 9000), line('v2', 'Incienso', 1, 2000)]),
    mk('s2', '2026-10-20T19:00:00.000Z', [line('v1b', 'Vela', 2, 6000), line('v1', 'Vela', 1, 2500, 'extra')]),
    mk('s3', '2026-10-22T18:00:00.000Z', [line('v2', 'Incienso', 4, 8000)]),
    mk('s4', '2026-09-30T18:00:00.000Z', [line('v2', 'Incienso', 9, 18000)]),
  ];
  const refund: ReportAdjustment = {
    id: 'a1', saleId: 's1', branchId: 'b1', type: 'devolucion', createdAt: '2026-10-22T20:00:00.000Z', amountCents: 3000, payments: [{ method: 'efectivo', amountCents: 3000 }],
    items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'x', qty: 1, unitCostCents: 1000, netCents: 3000, restock: true, kind: 'producto' }],
  };

  it('kind viaja de los documentos a los informes y por omisión es producto', () => {
    const doc = { _id: 'x', branchId: 'b1', createdAt: '2026-10-20T18:00:00.000Z', totalCents: 1, payments: [], items: [{ variantId: 'v', productName: 'A', variantLabel: 'a', qty: 1, unitCostCents: 0, netCents: 1, kind: 'extra' }, { variantId: 'v', productName: 'A', variantLabel: 'a', qty: 1, unitCostCents: 0, netCents: 1 }] };
    expect(toReportSale(doc).items.map((i) => i.kind)).toEqual(['extra', 'producto']);
    expect(toReportAdjustment({ ...doc, items: doc.items.map((i) => ({ ...i, restock: false })) }).items.map((i) => i.kind)).toEqual(['extra', 'producto']);
  });

  it('cubetas del rango: días y meses, incluso vacíos', () => {
    expect(bucketsInRange('day', '2026-10-19', '2026-10-21')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(bucketsInRange('month', '2026-08-15', '2026-10-02')).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('top por día: agrupa variantes del mismo producto, el extra suma importe y no unidades, y la devolución resta en su fecha', () => {
    const r = topProductsSeries(sales.slice(0, 3), [refund], resolve, { granularity: 'day', fromDay: '2026-10-20', toDay: '2026-10-22', limit: 5 });
    expect(r.buckets.map((b) => b.bucket)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    const d20 = r.buckets[0]!;
    expect(d20.topProduct).toEqual({ name: 'Vela', qty: 5 });
    expect(d20.products.find((p) => p.productId === 'p1')).toEqual({ productId: 'p1', name: 'Vela', qty: 5, netCents: 9000 + 6000 + 2500 });
    expect(r.buckets[1]!.topProduct).toBeNull();
    const d22 = r.buckets[2]!;
    expect(d22.topProduct).toEqual({ name: 'Incienso', qty: 4 });
    expect(d22.products.map((p) => p.productId)).toEqual(['p2']); // Vela quedó en -1: no aparece
    const vela = r.series.find((s) => s.productId === 'p1')!;
    expect(vela.points.map((p) => p.qty)).toEqual([5, 0, -1]);
    expect(vela.points.map((p) => p.netCents)).toEqual([17500, 0, -3000]);
  });

  it('top: respeta el límite y ordena la serie por unidades de todo el rango', () => {
    const r = topProductsSeries(sales, [], resolve, { granularity: 'month', fromDay: '2026-09-01', toDay: '2026-10-31', limit: 1 });
    expect(r.buckets.map((b) => b.bucket)).toEqual(['2026-09', '2026-10']);
    expect(r.buckets[0]!.topProduct).toEqual({ name: 'Incienso', qty: 9 });
    expect(r.buckets[1]!.products).toHaveLength(1);
    expect(r.series).toHaveLength(1);
    expect(r.series[0]!.productId).toBe('p2'); // 13 unidades contra 5
    expect(r.series[0]!.points.map((p) => p.qty)).toEqual([9, 5]);
  });

  it('sin ventas: cubetas vacías y sin series', () => {
    const r = topProductsSeries([], [], resolve, { granularity: 'day', fromDay: '2026-10-01', toDay: '2026-10-02', limit: 5 });
    expect(r.series).toEqual([]);
    expect(r.buckets.every((b) => b.topProduct === null && b.products.length === 0)).toBe(true);
  });

  it('una variante borrada usa su id y el nombre guardado en la venta', () => {
    const r = topProductsSeries([mk('s9', '2026-10-20T18:00:00.000Z', [line('vX', 'Antiguo', 2, 500)])], [], resolve, { granularity: 'day', fromDay: '2026-10-20', toDay: '2026-10-20', limit: 5 });
    expect([r.series[0]!.productId, r.series[0]!.name]).toEqual(['vX', 'Antiguo']);
  });

  it('serie de un producto: puntos, totales netos y últimas ventas del mes con su folio', () => {
    const r = productSeries(sales, [refund], resolve, new Map([['s1', 'AMA-1'], ['s2', 'AMA-2']]), { productId: 'p1', granularity: 'day', fromDay: '2026-10-20', toDay: '2026-10-22' });
    expect(r.points).toEqual([
      { bucket: '2026-10-20', qty: 5, netCents: 17500 },
      { bucket: '2026-10-21', qty: 0, netCents: 0 },
      { bucket: '2026-10-22', qty: -1, netCents: -3000 },
    ]);
    expect(r.totalQty).toBe(4);
    expect(r.totalNetCents).toBe(14500);
    expect(r.last.map((l) => l.folio)).toEqual(['AMA-2', 'AMA-1']);
    expect(r.last[0]).toEqual({ saleId: 's2', folio: 'AMA-2', createdAt: '2026-10-20T19:00:00.000Z', qty: 2, netCents: 8500 });
  });

  it('serie de una variante: ignora las demás variantes del producto; sin folio cae al id; solo ventas del mes final', () => {
    const r = productSeries(sales, [], resolve, new Map(), { variantId: 'v1b', granularity: 'month', fromDay: '2026-09-01', toDay: '2026-10-31' });
    expect(r.points).toEqual([{ bucket: '2026-09', qty: 0, netCents: 0 }, { bucket: '2026-10', qty: 2, netCents: 6000 }]);
    expect(r.last).toEqual([{ saleId: 's2', folio: 's2', createdAt: '2026-10-20T19:00:00.000Z', qty: 2, netCents: 6000 }]);
    const sep = productSeries(sales, [], resolve, new Map(), { productId: 'p2', granularity: 'month', fromDay: '2026-09-01', toDay: '2026-09-30' });
    expect(sep.totalQty).toBe(9);
    expect(sep.last.map((l) => l.saleId)).toEqual(['s4']);
  });

  it('lowStockItems: bajo mínimo, agotados con mínimo, negativos heredados; ignora inactivas y sin mínimo; ordena por urgencia', () => {
    const info = (name: string, minStock: number, active = true) => ({ productId: `p-${name}`, productName: name, label: 'u', category: 'Veladoras', minStock, active });
    const vs = new Map([
      ['a', info('A', 10)], ['b', info('B', 10)], ['c', info('C', 0)], ['d', info('D', 5, false)], ['e', info('E', 4)], ['f', info('F', 0)], ['g', info('G', 10)],
    ]);
    const rows = [
      { variantId: 'a', branchId: 'b1', qty: 5 }, { variantId: 'b', branchId: 'b1', qty: 0 }, { variantId: 'c', branchId: 'b1', qty: 0 },
      { variantId: 'd', branchId: 'b1', qty: 1 }, { variantId: 'e', branchId: 'b1', qty: 4 }, { variantId: 'f', branchId: 'b1', qty: -2 },
      { variantId: 'g', branchId: 'b1', qty: 11 }, { variantId: 'zz', branchId: 'b1', qty: 0 },
    ];
    const r = lowStockItems(rows, vs);
    expect(r.map((x) => x.variantId)).toEqual(['f', 'b', 'a', 'e']);
    expect(r[0]).toEqual({ variantId: 'f', productId: 'p-F', productName: 'F', label: 'u', category: 'Veladoras', branchId: 'b1', qty: -2, minStock: 0 });
  });
});
