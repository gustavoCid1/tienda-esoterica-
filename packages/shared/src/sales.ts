/**
 * Cálculo de ventas: subtotales, descuentos, pagos y cambio.
 * Es la ÚNICA implementación; escritorio, móvil y API la comparten para que
 * los importes coincidan siempre.
 */
import type { PaymentLine, PaymentMethod, SaleItemKind } from './types.ts';
import { isIntCents } from './money.ts';

export class SaleValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SaleValidationError';
    this.code = code;
  }
}

export interface SaleLineInput {
  variantId: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
  lineDiscountCents?: number;
  /**
   * v2. Por omisión 'producto'. Una línea 'extra' (cargo adicional sobre un producto) exige qty = 1,
   * costo 0 y precio ≥ 0; admite descuento de línea y participa del descuento general como cualquier línea.
   */
  kind?: SaleItemKind;
}

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  /** Solo efectivo. Si se omite se asume pago exacto. */
  tenderedCents?: number;
}

export interface ComputedLine extends SaleLineInput {
  grossCents: number;
  lineDiscountCents: number;
  saleDiscountShareCents: number;
  netCents: number;
}

export interface ComputedSale {
  lines: ComputedLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: PaymentLine[];
  tenderedCents: number;
  changeCents: number;
}

/**
 * Reparte un descuento general entre las líneas, proporcional a su importe.
 * Los centavos sobrantes se asignan de uno en uno, sin exceder el importe de la línea.
 */
export function allocateDiscount(lineAmounts: number[], discountCents: number): number[] {
  const total = lineAmounts.reduce((a, b) => a + b, 0);
  if (discountCents < 0 || discountCents > total) {
    throw new SaleValidationError('descuento_invalido', 'El descuento no puede ser mayor al subtotal');
  }
  if (total === 0 || discountCents === 0) return lineAmounts.map(() => 0);
  const shares = lineAmounts.map((a) => Math.floor((discountCents * a) / total));
  let rest = discountCents - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0 && i < lineAmounts.length * 2; i++) {
    const idx = i % lineAmounts.length;
    if (shares[idx]! < lineAmounts[idx]!) {
      shares[idx]! += 1;
      rest -= 1;
    }
  }
  return shares;
}

export function computeSale(
  lines: SaleLineInput[],
  saleDiscountCents: number,
  payments: PaymentInput[],
): ComputedSale {
  if (lines.length === 0) throw new SaleValidationError('sin_lineas', 'La venta no tiene productos');
  if (!isIntCents(saleDiscountCents) || saleDiscountCents < 0) {
    throw new SaleValidationError('descuento_invalido', 'Descuento inválido');
  }

  const base = lines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new SaleValidationError('cantidad_invalida', 'La cantidad debe ser un entero mayor a cero');
    }
    if (l.kind !== undefined && l.kind !== 'producto' && l.kind !== 'extra') {
      throw new SaleValidationError('linea_invalida', 'Tipo de línea desconocido');
    }
    if (l.kind === 'extra') {
      if (l.qty !== 1) throw new SaleValidationError('cantidad_invalida', 'Una línea extra siempre es de 1 unidad');
      if (l.unitCostCents !== 0) throw new SaleValidationError('precio_invalido', 'Una línea extra no tiene costo');
    }
    if (!isIntCents(l.unitPriceCents) || l.unitPriceCents < 0 || !isIntCents(l.unitCostCents) || l.unitCostCents < 0) {
      throw new SaleValidationError('precio_invalido', 'Precio o costo inválido');
    }
    const gross = l.qty * l.unitPriceCents;
    const lineDisc = l.lineDiscountCents ?? 0;
    if (!isIntCents(lineDisc) || lineDisc < 0 || lineDisc > gross) {
      throw new SaleValidationError('descuento_invalido', 'Descuento de línea inválido');
    }
    return { l, gross, lineDisc, afterLine: gross - lineDisc };
  });

  const afterLineAmounts = base.map((b) => b.afterLine);
  const shares = allocateDiscount(afterLineAmounts, saleDiscountCents);

  const computed: ComputedLine[] = base.map((b, i) => ({
    ...b.l,
    grossCents: b.gross,
    lineDiscountCents: b.lineDisc,
    saleDiscountShareCents: shares[i]!,
    netCents: b.afterLine - shares[i]!,
  }));

  const subtotalCents = computed.reduce((a, l) => a + l.grossCents, 0);
  const lineDiscounts = computed.reduce((a, l) => a + l.lineDiscountCents, 0);
  const totalCents = computed.reduce((a, l) => a + l.netCents, 0);
  const discountCents = lineDiscounts + saleDiscountCents;

  if (payments.length === 0) throw new SaleValidationError('sin_pago', 'Falta el método de pago');
  const cashPayments = payments.filter((p) => p.method === 'efectivo');
  if (cashPayments.length > 1) {
    throw new SaleValidationError('pago_invalido', 'Solo se admite un pago en efectivo por venta');
  }

  let paid = 0;
  let tenderedCents = 0;
  let changeCents = 0;
  const outPayments: PaymentLine[] = payments.map((p) => {
    if (!isIntCents(p.amountCents) || p.amountCents <= 0) {
      throw new SaleValidationError('pago_invalido', 'Importe de pago inválido');
    }
    paid += p.amountCents;
    if (p.method === 'efectivo') {
      const tendered = p.tenderedCents ?? p.amountCents;
      if (!isIntCents(tendered) || tendered < p.amountCents) {
        throw new SaleValidationError('efectivo_insuficiente', 'El efectivo recibido es menor al importe a cobrar');
      }
      tenderedCents = tendered;
      changeCents = tendered - p.amountCents;
      return { method: p.method, amountCents: p.amountCents, tenderedCents: tendered, changeCents };
    }
    if (p.tenderedCents !== undefined && p.tenderedCents !== p.amountCents) {
      throw new SaleValidationError('pago_invalido', 'Solo el efectivo admite importe recibido distinto');
    }
    return { method: p.method, amountCents: p.amountCents };
  });

  if (paid !== totalCents) {
    throw new SaleValidationError('pago_no_coincide', 'La suma de los pagos no coincide con el total');
  }

  return { lines: computed, subtotalCents, discountCents, totalCents, payments: outPayments, tenderedCents, changeCents };
}

/**
 * Importe a devolver por `qtyNow` unidades de una línea, considerando lo ya devuelto.
 * Usa redondeo ACUMULADO: la suma de devoluciones parciales nunca excede el neto
 * de la línea y devolver todo suma exactamente netCents.
 */
export function refundAmountForLine(netCents: number, lineQty: number, alreadyQty: number, qtyNow: number): number {
  if (qtyNow <= 0 || alreadyQty + qtyNow > lineQty) {
    throw new SaleValidationError('devolucion_invalida', 'Cantidad a devolver inválida');
  }
  const upTo = (q: number) => Math.round((netCents * q) / lineQty);
  return upTo(alreadyQty + qtyNow) - upTo(alreadyQty);
}
