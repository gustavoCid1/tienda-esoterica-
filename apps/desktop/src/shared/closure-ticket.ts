/**
 * Ticket de CIERRE DE CAJA (v2). Lógica PURA y probada: arma los datos a partir de un corte ya guardado
 * (LocalStore.getClosure) y los dibuja como HTML de 58 u 80 mm con el mismo estilo del ticket de venta.
 *
 * Contenido: hora de apertura, monto inicial, ventas por método, entradas / retiros / gastos, esperado, contado,
 * diferencia y quién abrió, cerró y autorizó. Es un documento interno del gerente (lleva importes de caja).
 */
import { formatMXN, formatMxDateTime } from '@amara/shared';
import type { ActionAuthorization } from '@amara/shared';
import { BASE_CSS, escapeHtml, header } from './ticket-format.ts';
import { describeAuthorization } from './token-form.ts';

/** Lo que devuelve LocalStore.getClosure (solo los campos que usa el ticket). */
export interface ClosureRecordInput {
  id: string;
  status: 'abierta' | 'cerrada';
  openedAt: string;
  openingCents: number;
  closedAt: string | null;
  countedCents: number | null;
  expectedCents: number | null;
  differenceCents: number | null;
  provisional: boolean;
  closeAuthorization: ActionAuthorization | null;
  authorizedByName: string | null;
  openedByName: string | null;
  closedByName: string | null;
  /** closure_json guardado al cerrar: { breakdown, ... }. */
  closure: { breakdown?: Partial<BreakdownLike> } | null;
  notes: string | null;
}

interface BreakdownLike {
  openingCents: number;
  cashSalesCents: number;
  cashInCents: number;
  withdrawalsCents: number;
  expensesCents: number;
  cashRefundsCents: number;
  expectedCents: number;
  byMethod: Partial<Record<'efectivo' | 'tarjeta' | 'transferencia' | 'otro', number>>;
  operations: number;
}

export interface ClosureTicketData {
  business: string;
  branchName: string;
  terminalCode: string;
  openedAt: string;
  openingCents: number;
  closedAt: string;
  byMethod: { efectivo: number; tarjeta: number; transferencia: number; otro: number };
  cashSalesCents: number;
  cashInCents: number;
  withdrawalsCents: number;
  expensesCents: number;
  cashRefundsCents: number;
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
  provisional: boolean;
  operations: number;
  openedByName: string;
  closedByName: string;
  authorizedBy: string;
  notes: string | null;
}

export class ClosureTicketError extends Error {
  code = 'cierre_no_disponible';
}

/** Arma los datos del ticket. Lanza si la caja aún no se cerró. */
export function buildClosureTicketData(
  r: ClosureRecordInput,
  ctx: { business?: string; branchName: string; terminalCode: string; tokenLabel?: string | null },
): ClosureTicketData {
  if (r.status !== 'cerrada' || !r.closedAt || r.countedCents === null || r.expectedCents === null) {
    throw new ClosureTicketError('La caja todavía no se ha cerrado: no hay ticket de cierre.');
  }
  const b = r.closure?.breakdown ?? {};
  const m = b.byMethod ?? {};
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    business: ctx.business ?? 'Esotérica Amara',
    branchName: ctx.branchName,
    terminalCode: ctx.terminalCode,
    openedAt: r.openedAt,
    openingCents: r.openingCents,
    closedAt: r.closedAt,
    byMethod: { efectivo: n(m.efectivo), tarjeta: n(m.tarjeta), transferencia: n(m.transferencia), otro: n(m.otro) },
    cashSalesCents: n(b.cashSalesCents),
    cashInCents: n(b.cashInCents),
    withdrawalsCents: n(b.withdrawalsCents),
    expensesCents: n(b.expensesCents),
    cashRefundsCents: n(b.cashRefundsCents),
    expectedCents: r.expectedCents,
    countedCents: r.countedCents,
    differenceCents: r.differenceCents ?? r.countedCents - r.expectedCents,
    provisional: r.provisional,
    operations: n(b.operations),
    openedByName: r.openedByName ?? '-',
    closedByName: r.closedByName ?? '-',
    authorizedBy: describeAuthorization(r.closeAuthorization, r.authorizedByName, ctx.tokenLabel),
    notes: r.notes,
  };
}

/** "Sin diferencia", "Faltante $20.00" o "Sobrante $5.00". */
export function differenceText(diffCents: number): string {
  if (diffCents === 0) return 'Sin diferencia';
  return diffCents < 0 ? `Faltante ${formatMXN(-diffCents)}` : `Sobrante ${formatMXN(diffCents)}`;
}

export interface ClosureRenderOptions {
  paperMm: 58 | 80;
  logoSrc?: string;
  footer?: string;
}

export function closureBodyHtml(d: ClosureTicketData, o: Pick<ClosureRenderOptions, 'logoSrc' | 'footer'>): string {
  const row = (k: string, v: string, cls = '') => `<div class="row ${cls}"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;
  return [
    header(d, o),
    `<div class="c">${escapeHtml(d.branchName)} - Terminal ${escapeHtml(d.terminalCode)}</div>`,
    '<div class="copy">CIERRE DE CAJA</div>',
    d.provisional ? '<div class="reprint">CORTE PROVISIONAL (operaciones sin sincronizar)</div>' : '',
    row('Apertura', formatMxDateTime(d.openedAt)),
    row('Monto inicial', formatMXN(d.openingCents)),
    row('Cierre', formatMxDateTime(d.closedAt)),
    '<div class="sep"></div>',
    '<div class="strong"><b>Ventas por método</b></div>',
    row('Efectivo', formatMXN(d.byMethod.efectivo)),
    row('Tarjeta', formatMXN(d.byMethod.tarjeta)),
    row('Transferencia', formatMXN(d.byMethod.transferencia)),
    row('Otro', formatMXN(d.byMethod.otro)),
    '<div class="sep"></div>',
    '<div class="strong"><b>Movimientos de efectivo</b></div>',
    row('Ventas en efectivo', formatMXN(d.cashSalesCents)),
    row('Entradas', formatMXN(d.cashInCents)),
    row('Retiros', `-${formatMXN(d.withdrawalsCents)}`),
    row('Gastos', `-${formatMXN(d.expensesCents)}`),
    row('Devoluciones en efectivo', `-${formatMXN(d.cashRefundsCents)}`),
    '<div class="sep"></div>',
    row('Esperado en cajón', formatMXN(d.expectedCents)),
    row('Contado', formatMXN(d.countedCents)),
    row(differenceText(d.differenceCents), formatMXN(d.differenceCents), 'total'),
    '<div class="sep"></div>',
    row('Abrió', d.openedByName),
    row('Cerró', d.closedByName),
    `<div class="row"><span>Autorizó</span></div><div>${escapeHtml(d.authorizedBy)}</div>`,
    d.notes ? `<div class="sep"></div><div>Notas: ${escapeHtml(d.notes)}</div>` : '',
    `<div class="foot">${escapeHtml(o.footer ?? 'Documento interno de caja')}</div>`,
  ].join('');
}

export function buildClosureTicketHtml(d: ClosureTicketData, o: ClosureRenderOptions): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(`Cierre de caja ${formatMxDateTime(d.closedAt)}`)}</title><style>${BASE_CSS(o.paperMm)}</style></head><body><div class="t">${closureBodyHtml(d, o)}</div></body></html>`;
}
