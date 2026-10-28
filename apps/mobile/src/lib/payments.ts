/**
 * Pagos de una venta en pantalla (previo a registerSale, que vuelve a validar todo).
 * Reglas (las mismas de computeSale): un solo pago en efectivo; la suma de los pagos aplicados
 * debe ser igual al total; el efectivo puede recibirse de más y se devuelve cambio.
 */
import type { PaymentInput } from '@amara/shared';
import type { PaymentMethod } from '@amara/shared';

export interface PaymentDraft {
  method: PaymentMethod;
  /** Importe aplicado a la venta. */
  amountCents: number;
  /** Solo efectivo: lo que entregó el cliente. */
  tenderedCents?: number;
}

export interface PaymentSummary {
  paidCents: number;
  remainingCents: number;
  changeCents: number;
  complete: boolean;
}

export function summarizePayments(totalCents: number, payments: PaymentDraft[]): PaymentSummary {
  const paid = payments.reduce((a, p) => a + p.amountCents, 0);
  const cash = payments.find((p) => p.method === 'efectivo');
  const change = cash ? Math.max(0, (cash.tenderedCents ?? cash.amountCents) - cash.amountCents) : 0;
  return { paidCents: paid, remainingCents: Math.max(0, totalCents - paid), changeCents: change, complete: totalCents > 0 && paid === totalCents };
}

/** Valida un pago nuevo contra lo ya agregado. Devuelve mensaje de error o null. */
export function validateNewPayment(totalCents: number, existing: PaymentDraft[], next: PaymentDraft): string | null {
  if (!Number.isInteger(next.amountCents) || next.amountCents <= 0) return 'Escribe un importe mayor a cero.';
  const paid = existing.reduce((a, p) => a + p.amountCents, 0);
  if (paid + next.amountCents > totalCents) return 'El pago excede lo que falta por cobrar.';
  if (next.method === 'efectivo') {
    if (existing.some((p) => p.method === 'efectivo')) return 'Solo se admite un pago en efectivo por venta.';
    const tendered = next.tenderedCents ?? next.amountCents;
    if (tendered < next.amountCents) return 'El efectivo recibido es menor al importe.';
  } else if (next.tenderedCents !== undefined && next.tenderedCents !== next.amountCents) {
    return 'Solo el efectivo admite importe recibido distinto.';
  }
  return null;
}

export function toPaymentInputs(payments: PaymentDraft[]): PaymentInput[] {
  return payments.map((p) =>
    p.method === 'efectivo'
      ? { method: p.method, amountCents: p.amountCents, tenderedCents: p.tenderedCents ?? p.amountCents }
      : { method: p.method, amountCents: p.amountCents },
  );
}
