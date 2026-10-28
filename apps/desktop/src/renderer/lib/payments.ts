/**
 * Plan de pagos de una venta (lógica PURA). Modelo simple para la caja:
 *  - Tarjeta / transferencia / otro: importes que escribe el cajero.
 *  - Efectivo: es lo que FALTA por cobrar (total - lo anterior) y se captura cuánto entregó el cliente.
 * Así nunca hay dos renglones de efectivo y el cambio siempre es claro. El resultado se arma como
 * PaymentInput[] para el almacén local, que lo vuelve a validar con computeSale.
 */
import type { PaymentInput } from '@amara/shared';

export type NonCashMethod = 'tarjeta' | 'transferencia' | 'otro';

export interface PaymentDraft {
  totalCents: number;
  nonCash: Partial<Record<NonCashMethod, number>>;
  /** Lo que entregó el cliente en efectivo; null = pago exacto. */
  cashTenderedCents: number | null;
}

export type PaymentPlan =
  | { ok: true; payments: PaymentInput[]; cashDueCents: number; tenderedCents: number; changeCents: number }
  | { ok: false; error: string; cashDueCents: number };

export function planPayments(d: PaymentDraft): PaymentPlan {
  if (!Number.isInteger(d.totalCents) || d.totalCents <= 0) return { ok: false, error: 'No hay nada que cobrar.', cashDueCents: 0 };
  const payments: PaymentInput[] = [];
  let nonCashTotal = 0;
  for (const method of ['tarjeta', 'transferencia', 'otro'] as const) {
    const amount = d.nonCash[method] ?? 0;
    if (!Number.isInteger(amount) || amount < 0) return { ok: false, error: 'Importe inválido.', cashDueCents: 0 };
    if (amount > 0) {
      payments.push({ method, amountCents: amount });
      nonCashTotal += amount;
    }
  }
  if (nonCashTotal > d.totalCents) {
    return { ok: false, error: 'Tarjeta, transferencia y otros suman más que el total.', cashDueCents: 0 };
  }
  const cashDue = d.totalCents - nonCashTotal;
  if (cashDue === 0) {
    return { ok: true, payments, cashDueCents: 0, tenderedCents: 0, changeCents: 0 };
  }
  const tendered = d.cashTenderedCents ?? cashDue;
  if (!Number.isInteger(tendered) || tendered < cashDue) {
    return { ok: false, error: 'El efectivo recibido es menor a lo que falta por cobrar.', cashDueCents: cashDue };
  }
  payments.push({ method: 'efectivo', amountCents: cashDue, tenderedCents: tendered });
  return { ok: true, payments, cashDueCents: cashDue, tenderedCents: tendered, changeCents: tendered - cashDue };
}
