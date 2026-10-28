/**
 * Informes de ventas. Una sola implementación para API, web, escritorio y móvil,
 * así "ventas de hoy" coincide en todas las pantallas.
 *
 * Criterio contable (por FECHA DE CADA REGISTRO, igual que la caja):
 *   - Vendido (bruto)   = suma de totales de ventas creadas en el período.
 *   - Cancelaciones     = cancelaciones registradas en el período (aunque la venta sea de otro día).
 *   - Devoluciones      = devoluciones registradas en el período.
 *   - Ventas netas      = vendido - cancelaciones - devoluciones.
 *   - Utilidad bruta    = ventas netas - costo de lo vendido neto de devoluciones.
 * Limitaciones de la utilidad: usa el costo vigente al momento de la venta
 * (no costo promedio ni por lote), no resta gastos de operación ni comisiones
 * de tarjeta, y las mermas (devoluciones sin reingreso) quedan fuera del costo.
 */
import type { AdjustmentItem, PaymentMethod } from './types.ts';
import { PAYMENT_METHODS } from './types.ts';
import { mxMonthKey } from './time.ts';

export interface ReportSaleItem {
  variantId: string;
  productName: string;
  variantLabel: string;
  qty: number;
  unitCostCents: number;
  netCents: number;
}

export interface ReportSale {
  id: string;
  branchId: string;
  createdAt: string;
  totalCents: number;
  payments: { method: PaymentMethod; amountCents: number }[];
  items: ReportSaleItem[];
}

export interface ReportAdjustment {
  id: string;
  saleId: string;
  branchId: string;
  type: 'cancelacion' | 'devolucion';
  createdAt: string;
  amountCents: number;
  payments: { method: PaymentMethod; amountCents: number }[];
  items: (Pick<AdjustmentItem, 'variantId' | 'productName' | 'variantLabel' | 'qty' | 'unitCostCents' | 'netCents'> & {
    restock?: boolean;
  })[];
}

export interface ReportFilter {
  /** Inclusive, ISO UTC. */
  from?: string;
  /** Exclusivo, ISO UTC. */
  to?: string;
  branchId?: string | null;
}

export interface MethodTotals {
  grossCents: number;
  refundedCents: number;
  netCents: number;
}

export interface ProductRank {
  variantId: string;
  name: string;
  units: number;
  revenueCents: number;
}

export interface SalesSummary {
  grossCents: number;
  cancelledCents: number;
  refundedCents: number;
  netCents: number;
  ticketCount: number;
  cancelledCount: number;
  refundCount: number;
  avgTicketCents: number;
  byMethod: Record<PaymentMethod, MethodTotals>;
  unitsSold: number;
  cogsCents: number;
  grossProfitCents: number;
  topByUnits: ProductRank[];
  topByRevenue: ProductRank[];
}

export const PROFIT_DISCLAIMER =
  'Utilidad bruta estimada: ventas netas menos el costo registrado al momento de la venta. ' +
  'No incluye gastos de operación, comisiones ni mermas, y no usa costo promedio por lote.';

function within(iso: string, f: ReportFilter, branchId: string): boolean {
  if (f.branchId && branchId !== f.branchId) return false;
  if (f.from && iso < f.from) return false;
  if (f.to && iso >= f.to) return false;
  return true;
}

export function summarizeSales(
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  filter: ReportFilter = {},
  topN = 10,
): SalesSummary {
  const byMethod = Object.fromEntries(
    PAYMENT_METHODS.map((m) => [m, { grossCents: 0, refundedCents: 0, netCents: 0 }]),
  ) as Record<PaymentMethod, MethodTotals>;

  let gross = 0;
  let ticketCount = 0;
  let units = 0;
  let cogs = 0;
  const products = new Map<string, ProductRank>();

  const bump = (variantId: string, name: string, units_: number, revenue: number) => {
    const cur = products.get(variantId) ?? { variantId, name, units: 0, revenueCents: 0 };
    cur.units += units_;
    cur.revenueCents += revenue;
    products.set(variantId, cur);
  };

  for (const s of sales) {
    if (!within(s.createdAt, filter, s.branchId)) continue;
    ticketCount++;
    gross += s.totalCents;
    for (const p of s.payments) byMethod[p.method].grossCents += p.amountCents;
    for (const it of s.items) {
      units += it.qty;
      cogs += it.qty * it.unitCostCents;
      bump(it.variantId, `${it.productName} ${it.variantLabel}`.trim(), it.qty, it.netCents);
    }
  }

  let cancelled = 0;
  let refunded = 0;
  let cancelledCount = 0;
  let refundCount = 0;
  for (const a of adjustments) {
    if (!within(a.createdAt, filter, a.branchId)) continue;
    if (a.type === 'cancelacion') {
      cancelled += a.amountCents;
      cancelledCount++;
    } else {
      refunded += a.amountCents;
      refundCount++;
    }
    for (const p of a.payments) byMethod[p.method].refundedCents += p.amountCents;
    for (const it of a.items) {
      units -= it.qty;
      // Solo lo que volvió a existencias reduce el costo; lo dañado (restock=false) sigue siendo costo.
      if (it.restock !== false) cogs -= it.qty * it.unitCostCents;
      bump(it.variantId, `${it.productName} ${it.variantLabel}`.trim(), -it.qty, -it.netCents);
    }
  }

  for (const m of PAYMENT_METHODS) byMethod[m].netCents = byMethod[m].grossCents - byMethod[m].refundedCents;

  const netCents = gross - cancelled - refunded;
  const netTickets = Math.max(0, ticketCount - cancelledCount);
  const ranks = [...products.values()];
  const topByUnits = [...ranks].sort((a, b) => b.units - a.units || b.revenueCents - a.revenueCents).slice(0, topN);
  const topByRevenue = [...ranks].sort((a, b) => b.revenueCents - a.revenueCents || b.units - a.units).slice(0, topN);

  return {
    grossCents: gross,
    cancelledCents: cancelled,
    refundedCents: refunded,
    netCents,
    ticketCount,
    cancelledCount,
    refundCount,
    avgTicketCents: netTickets > 0 ? Math.round(netCents / netTickets) : 0,
    byMethod,
    unitsSold: units,
    cogsCents: cogs,
    grossProfitCents: netCents - cogs,
    topByUnits,
    topByRevenue,
  };
}

export interface MonthTotal {
  month: string;
  grossCents: number;
  netCents: number;
}

/** Ventas netas por mes (hora de México) y mes con mayor importe vendido. */
export function monthlyTotals(
  sales: ReportSale[],
  adjustments: ReportAdjustment[],
  filter: ReportFilter = {},
): { months: MonthTotal[]; best: MonthTotal | null } {
  const map = new Map<string, MonthTotal>();
  const get = (key: string) => {
    const cur = map.get(key) ?? { month: key, grossCents: 0, netCents: 0 };
    map.set(key, cur);
    return cur;
  };
  for (const s of sales) {
    if (!within(s.createdAt, filter, s.branchId)) continue;
    const m = get(mxMonthKey(s.createdAt));
    m.grossCents += s.totalCents;
    m.netCents += s.totalCents;
  }
  for (const a of adjustments) {
    if (!within(a.createdAt, filter, a.branchId)) continue;
    get(mxMonthKey(a.createdAt)).netCents -= a.amountCents;
  }
  const months = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  const best = months.reduce<MonthTotal | null>((acc, m) => (!acc || m.netCents > acc.netCents ? m : acc), null);
  return { months, best };
}
