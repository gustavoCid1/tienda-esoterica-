/**
 * Modelo de vista del "Resumen de ventas de hoy" (solo gerente). Lógica PURA.
 *
 * Reglas que protege este módulo:
 *  1. El resumen del SERVIDOR y el LOCAL nunca se suman. Cuando hay servidor se usa SOLO el del
 *     servidor; el local es únicamente un respaldo sin conexión. Así, al reconectar, las ventas de este
 *     teléfono (que ya subieron) no se cuentan dos veces.
 *  2. "Ventas netas" = total vendido - cancelaciones - devoluciones (criterio de @amara/shared/reports).
 *  3. Esto son VENTAS, no dinero físico. El efectivo esperado en caja es otra cifra, calculada aparte
 *     (computeCashBreakdown) y mostrada en otra tarjeta.
 */
import { formatMXN, PAYMENT_METHODS } from '@amara/shared';
import type { PaymentMethod, SalesSummary } from '@amara/shared';
import { humanAge } from './staleness.ts';

export type SummarySource = 'servidor' | 'local';

export interface SummaryContext {
  fromDay: string;
  toDay: string;
  /** null = consolidado de todas las sucursales autorizadas. */
  branchId: string | null;
  branchLabel: string;
  consolidated: boolean;
}

export interface Notice {
  kind: 'info' | 'warn';
  text: string;
}

export interface SummaryView {
  source: SummarySource;
  summary: SalesSummary;
  /** ISO de la última actualización de ESTOS datos (hora del servidor si la dio; si no, la del teléfono). */
  updatedAt: string;
  context: SummaryContext;
  pendingOps: number;
  lastSyncOkAt: string | null;
  notices: Notice[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildServerView(
  summary: SalesSummary,
  context: SummaryContext,
  extra: { updatedAt: string; pendingOps: number; lastSyncOkAt?: string | null },
): SummaryView {
  const notices: Notice[] = [];
  if (extra.pendingOps > 0) {
    notices.push({
      kind: 'warn',
      text: `${plural(extra.pendingOps, 'operación', 'operaciones')} de este teléfono todavía no llegan al servidor y no están incluidas en este resumen. Se agregarán solas al sincronizar; no se suman dos veces.`,
    });
  }
  return { source: 'servidor', summary, updatedAt: extra.updatedAt, context, pendingOps: extra.pendingOps, lastSyncOkAt: extra.lastSyncOkAt ?? null, notices };
}

export function buildLocalView(
  summary: SalesSummary,
  context: SummaryContext,
  extra: { nowIso: string; pendingOps: number; lastSyncOkAt: string | null },
): SummaryView {
  const notices: Notice[] = [
    { kind: 'warn', text: 'DATOS LOCALES de este teléfono: no se pudo consultar al servidor.' },
    {
      kind: 'warn',
      text: 'Puede estar INCOMPLETO: solo incluye ventas y ajustes que este teléfono conoce; faltan las de otras terminales o de la PC que no se hayan descargado.',
    },
  ];
  if (extra.lastSyncOkAt) {
    const age = Date.parse(extra.nowIso) - Date.parse(extra.lastSyncOkAt);
    notices.push({ kind: 'info', text: `Última sincronización correcta: hace ${humanAge(age)}.` });
  } else {
    notices.push({ kind: 'warn', text: 'Este teléfono nunca ha sincronizado con el servidor.' });
  }
  notices.push({
    kind: extra.pendingOps > 0 ? 'warn' : 'info',
    text:
      extra.pendingOps > 0
        ? `${plural(extra.pendingOps, 'operación pendiente', 'operaciones pendientes')} de enviar (ya están contadas en estas cifras locales).`
        : 'No hay operaciones pendientes de enviar.',
  });
  return { source: 'local', summary, updatedAt: extra.nowIso, context, pendingOps: extra.pendingOps, lastSyncOkAt: extra.lastSyncOkAt, notices };
}

/**
 * Elige qué mostrar. El servidor SIEMPRE gana; el local solo se usa si no hay servidor.
 * (Nunca se combinan: ver regla 1.)
 */
export function chooseView(server: SummaryView | null | undefined, local: SummaryView | null | undefined): SummaryView | null {
  return server ?? local ?? null;
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otros',
};

export interface MethodRow {
  method: PaymentMethod;
  label: string;
  grossCents: number;
  refundedCents: number;
  netCents: number;
}

export function methodRows(s: SalesSummary): MethodRow[] {
  return PAYMENT_METHODS.map((m) => ({
    method: m,
    label: METHOD_LABEL[m],
    grossCents: s.byMethod[m]?.grossCents ?? 0,
    refundedCents: s.byMethod[m]?.refundedCents ?? 0,
    netCents: s.byMethod[m]?.netCents ?? 0,
  }));
}

/** Texto que explica de dónde sale "ventas netas". */
export function netExplanation(s: SalesSummary): string[] {
  const lines = [
    `Ventas netas = total vendido ${formatMXN(s.grossCents)} - cancelaciones ${formatMXN(s.cancelledCents)} - devoluciones ${formatMXN(s.refundedCents)} = ${formatMXN(s.grossCents - s.cancelledCents - s.refundedCents)}.`,
    'Una cancelación anula una venta completa; una devolución regresa solo parte de ella. Se cuentan en la fecha en que se registraron, aunque la venta original sea de otro día.',
  ];
  if (s.grossCents - s.cancelledCents - s.refundedCents !== s.netCents) {
    lines.push(`Aviso: el servidor reporta ${formatMXN(s.netCents)} como ventas netas, distinto de la resta anterior. Revisa con el administrador.`);
  }
  return lines;
}

export const CASH_VS_SALES_NOTE =
  'Efectivo esperado = fondo inicial + cobros en efectivo (sin el cambio) + entradas - retiros - gastos - devoluciones pagadas en efectivo. ' +
  'Tarjeta y transferencia no entran. NO es lo mismo que lo vendido.';
