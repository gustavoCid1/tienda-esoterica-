import { describe, expect, it } from 'vitest';
import {
  WIDGETS, bestMonth, pickSummary, monthBars, moveWidget, normalizeDashboardExtra, normalizePrefs, rankBars, resolveWidgets,
  sumCashSessions, toggleHidden,
} from './dashboard.ts';

describe('preferencias del tablero', () => {
  it('descarta basura y ids desconocidos', () => {
    expect(normalizePrefs(null)).toEqual({ order: [], hidden: [] });
    expect(normalizePrefs({ order: ['kpi_week', 'nope', 5, 'kpi_week'], hidden: 'x' })).toEqual({ order: ['kpi_week'], hidden: [] });
  });
  it('resuelve orden guardado y agrega indicadores nuevos al final', () => {
    const r = resolveWidgets({ order: ['kpi_week', 'kpi_today'], hidden: ['kpi_today'] });
    expect(r.map((w) => w.def.id).slice(0, 2)).toEqual(['kpi_week', 'kpi_today']);
    expect(r).toHaveLength(WIDGETS.length);
    expect(r.find((w) => w.def.id === 'kpi_today')!.visible).toBe(false);
    expect(r.find((w) => w.def.id === 'kpi_week')!.visible).toBe(true);
  });
  it('mueve y oculta', () => {
    expect(moveWidget(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveWidget(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveWidget(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(toggleHidden([], 'a')).toEqual(['a']);
    expect(toggleHidden(['a'], 'a')).toEqual([]);
  });
});

describe('gráficas', () => {
  const months = [
    { month: '2026-09', grossCents: 100000, netCents: 90000 },
    { month: '2026-08', grossCents: 50000, netCents: 50000 },
    { month: '2026-10', grossCents: 80000, netCents: 90000 },
  ];
  it('mes con mayor importe neto (empate: el más reciente)', () => {
    expect(bestMonth(months)!.month).toBe('2026-10');
    expect(bestMonth([])).toBeNull();
  });
  it('ordena meses y convierte a pesos', () => {
    const bars = monthBars(months);
    expect(bars.map((b) => b.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(bars[0]).toMatchObject({ label: 'ago 2026', neto: 500, bruto: 500 });
  });
  it('barras de productos: unidades enteras e ingresos en pesos', () => {
    const ranks = [{ variantId: 'v', name: 'Vela', units: 4, revenueCents: 12050 }];
    expect(rankBars(ranks, 'units')).toEqual([{ name: 'Vela', value: 4 }]);
    expect(rankBars(ranks, 'revenue')).toEqual([{ name: 'Vela', value: 120.5 }]);
  });
});

describe('normalización de respuestas', () => {
  it('acepta nombres alternos de agotados y bajo mínimo', () => {
    expect(normalizeDashboardExtra({ agotados: [1], bajoMinimo: [2, 3] })).toEqual({ outOfStock: [1], lowStock: [2, 3] });
    expect(normalizeDashboardExtra(undefined)).toEqual({ outOfStock: [], lowStock: [] });
  });
  it('suma efectivo solo de cortes cerrados y cuenta provisionales', () => {
    const t = sumCashSessions([
      { status: 'cerrada', expectedCents: 1000, countedCents: 900 },
      { status: 'cerrada', expectedCents: 500, countedCents: 500, provisional: true },
      { status: 'abierta', expectedCents: 7000 },
    ]);
    expect(t).toEqual({ expectedCents: 1500, countedCents: 1400, closed: 2, open: 1, provisional: 1 });
  });
});

describe('pickSummary', () => {
  it('acepta resumen directo o envuelto y rechaza otras formas', () => {
    expect(pickSummary({ netCents: 5 })).toEqual({ netCents: 5 });
    expect(pickSummary({ summary: { netCents: 7 } })).toEqual({ netCents: 7 });
    expect(pickSummary({ foo: 1 })).toBeNull();
    expect(pickSummary(null)).toBeNull();
  });
});
