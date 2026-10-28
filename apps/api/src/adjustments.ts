/**
 * Construcción de cancelaciones y devoluciones hechas en línea (desde la web).
 * Lógica pura: nunca borra ni edita la venta; produce un REGISTRO NUEVO (ajuste) que `applySyncOp`
 * guarda, regresa existencias y cambia el estado de la venta a "cancelada" cuando corresponde.
 */
import { refundAmountForLine } from '@amara/shared';
import type { AdjustmentItem, PaymentMethod, Sale, SaleAdjustment } from '@amara/shared';

export class AdjustmentError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AdjustmentError';
    this.code = code;
    this.status = status;
  }
}

interface Base {
  id: string;
  userId: string;
  terminalId: string;
  reason: string;
  /** ISO UTC. */
  now: string;
  /** Sesión de caja de la que sale el dinero (null si no hay caja abierta). */
  cashSessionId: string | null;
}

function checkReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 3) throw new AdjustmentError(400, 'motivo_requerido', 'Escribe el motivo');
  return r;
}

const priorQty = (priors: SaleAdjustment[]) => {
  const m = new Map<string, number>();
  for (const a of priors) for (const it of a.items) m.set(it.saleItemId, (m.get(it.saleItemId) ?? 0) + it.qty);
  return m;
};

export function buildCancellation(sale: Sale, priors: SaleAdjustment[], p: Base): SaleAdjustment {
  const reason = checkReason(p.reason);
  if (sale.status !== 'completada') throw new AdjustmentError(409, 'ya_cancelada', 'La venta ya está cancelada');
  if (priors.length > 0) throw new AdjustmentError(409, 'tiene_devoluciones', 'La venta ya tiene devoluciones; registra devoluciones para el resto');
  if (!p.cashSessionId && sale.payments.some((x) => x.method === 'efectivo')) {
    throw new AdjustmentError(409, 'caja_cerrada', 'Abre la caja para devolver el efectivo de la cancelación');
  }
  return {
    id: p.id, saleId: sale.id, branchId: sale.branchId, terminalId: p.terminalId, userId: p.userId, type: 'cancelacion', createdAt: p.now,
    reason, amountCents: sale.totalCents, payments: sale.payments.map((x) => ({ method: x.method, amountCents: x.amountCents })),
    items: sale.items.map((i) => ({
      saleItemId: i.id, variantId: i.variantId, productName: i.productName, variantLabel: i.variantLabel, qty: i.qty,
      unitCostCents: i.unitCostCents, netCents: i.netCents, restock: true,
    })),
    cashSessionId: p.cashSessionId,
  };
}

export function buildReturn(
  sale: Sale,
  priors: SaleAdjustment[],
  p: Base & { lines: { saleItemId: string; qty: number; restock: boolean }[]; payments: { method: PaymentMethod; amountCents: number }[] },
): SaleAdjustment {
  const reason = checkReason(p.reason);
  if (sale.status !== 'completada') throw new AdjustmentError(409, 'ya_cancelada', 'La venta está cancelada');
  const used = priorQty(priors);
  const items: AdjustmentItem[] = [];
  let amount = 0;
  for (const l of p.lines) {
    const line = sale.items.find((i) => i.id === l.saleItemId);
    if (!line) throw new AdjustmentError(400, 'partida_invalida', 'La partida no pertenece a la venta');
    let refund: number;
    try {
      refund = refundAmountForLine(line.netCents, line.qty, used.get(line.id) ?? 0, l.qty);
    } catch {
      throw new AdjustmentError(409, 'devolucion_excedida', `Cantidad a devolver inválida para ${line.productName}`);
    }
    used.set(line.id, (used.get(line.id) ?? 0) + l.qty);
    amount += refund;
    items.push({
      saleItemId: line.id, variantId: line.variantId, productName: line.productName, variantLabel: line.variantLabel, qty: l.qty,
      unitCostCents: line.unitCostCents, netCents: refund, restock: l.restock,
    });
  }
  if (items.length === 0 || amount <= 0) throw new AdjustmentError(400, 'sin_partidas', 'No hay partidas por devolver');

  // El dinero devuelto debe cuadrar con el importe y no exceder lo cobrado por cada método (neto de devoluciones previas).
  const paidBy = new Map<PaymentMethod, number>();
  for (const x of sale.payments) paidBy.set(x.method, (paidBy.get(x.method) ?? 0) + x.amountCents);
  for (const a of priors) for (const x of a.payments) paidBy.set(x.method, (paidBy.get(x.method) ?? 0) - x.amountCents);
  const refundBy = new Map<PaymentMethod, number>();
  for (const x of p.payments) refundBy.set(x.method, (refundBy.get(x.method) ?? 0) + x.amountCents);
  const refundedTotal = p.payments.reduce((a, x) => a + x.amountCents, 0);
  if (refundedTotal !== amount) throw new AdjustmentError(400, 'pagos_no_coinciden', 'Los pagos devueltos deben sumar el importe de la devolución');
  for (const [method, cents] of refundBy) {
    if (cents > (paidBy.get(method) ?? 0)) throw new AdjustmentError(409, 'metodo_excedido', `No se puede devolver más de lo cobrado en ${method}`);
  }
  if (!p.cashSessionId && (refundBy.get('efectivo') ?? 0) > 0) {
    throw new AdjustmentError(409, 'caja_cerrada', 'Abre la caja para devolver efectivo');
  }
  return {
    id: p.id, saleId: sale.id, branchId: sale.branchId, terminalId: p.terminalId, userId: p.userId, type: 'devolucion', createdAt: p.now,
    reason, amountCents: amount, payments: [...refundBy].map(([method, amountCents]) => ({ method, amountCents })), items, cashSessionId: p.cashSessionId,
  };
}
