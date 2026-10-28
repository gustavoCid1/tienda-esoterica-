/**
 * Caja: efectivo esperado, diferencia y desglose de billetes/monedas.
 *
 * REGLA CLAVE: el efectivo esperado NO es "ventas del día". Solo cuenta dinero
 * que físicamente entra o sale del cajón:
 *   esperado = fondo inicial
 *            + pagos en EFECTIVO de ventas de la sesión (ya sin el cambio devuelto)
 *            + entradas de efectivo
 *            - retiros - gastos
 *            - devoluciones/cancelaciones pagadas en efectivo
 * Tarjeta y transferencia NUNCA se suman al efectivo físico.
 */
import type { CashMovement, PaymentMethod, Sale, SaleAdjustment } from './types.ts';
import { PAYMENT_METHODS } from './types.ts';

export interface CashBreakdown {
  openingCents: number;
  cashSalesCents: number;
  cashInCents: number;
  withdrawalsCents: number;
  expensesCents: number;
  cashRefundsCents: number;
  expectedCents: number;
  byMethod: Record<PaymentMethod, number>;
  operations: number;
}

export function computeCashBreakdown(
  openingCents: number,
  sessionId: string,
  sales: Pick<Sale, 'cashSessionId' | 'payments'>[],
  adjustments: Pick<SaleAdjustment, 'cashSessionId' | 'payments'>[],
  movements: Pick<CashMovement, 'sessionId' | 'type' | 'amountCents'>[],
): CashBreakdown {
  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
  let cashSales = 0;
  let operations = 0;

  for (const s of sales) {
    if (s.cashSessionId !== sessionId) continue;
    operations++;
    for (const p of s.payments) {
      byMethod[p.method] += p.amountCents;
      if (p.method === 'efectivo') cashSales += p.amountCents;
    }
  }

  let cashRefunds = 0;
  for (const a of adjustments) {
    if (a.cashSessionId !== sessionId) continue;
    operations++;
    for (const p of a.payments) {
      byMethod[p.method] -= p.amountCents;
      if (p.method === 'efectivo') cashRefunds += p.amountCents;
    }
  }

  let cashIn = 0;
  let withdrawals = 0;
  let expenses = 0;
  for (const m of movements) {
    if (m.sessionId !== sessionId) continue;
    operations++;
    if (m.type === 'entrada') cashIn += m.amountCents;
    else if (m.type === 'retiro') withdrawals += m.amountCents;
    else expenses += m.amountCents;
  }

  const expectedCents = openingCents + cashSales + cashIn - withdrawals - expenses - cashRefunds;
  return {
    openingCents,
    cashSalesCents: cashSales,
    cashInCents: cashIn,
    withdrawalsCents: withdrawals,
    expensesCents: expenses,
    cashRefundsCents: cashRefunds,
    expectedCents,
    byMethod,
    operations,
  };
}

/** Diferencia = contado - esperado. Negativa = faltante; positiva = sobrante. */
export function cashDifference(expectedCents: number, countedCents: number): number {
  return countedCents - expectedCents;
}

/** Denominaciones MXN en centavos. Clave = etiqueta mostrada al usuario. */
export const MXN_DENOMINATIONS: Record<string, number> = {
  'Billete $1000': 100000,
  'Billete $500': 50000,
  'Billete $200': 20000,
  'Billete $100': 10000,
  'Billete $50': 5000,
  'Billete $20': 2000,
  'Moneda $20': 2000,
  'Moneda $10': 1000,
  'Moneda $5': 500,
  'Moneda $2': 200,
  'Moneda $1': 100,
  'Moneda $0.50': 50,
};

export function sumDenominations(counts: Record<string, number>): number {
  let total = 0;
  for (const [label, qty] of Object.entries(counts)) {
    const value = MXN_DENOMINATIONS[label];
    if (value === undefined) throw new Error(`Denominación desconocida: ${label}`);
    if (!Number.isInteger(qty) || qty < 0) throw new Error(`Cantidad inválida para ${label}`);
    total += value * qty;
  }
  return total;
}
