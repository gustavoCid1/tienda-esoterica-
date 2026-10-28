/**
 * Lectura TOLERANTE de las respuestas de /stats/today, /stats/summary y /cash/current.
 * docs/API.md no fija la forma exacta de la respuesta de /stats/today, así que se aceptan estas:
 *   A) { summary: SalesSummary, ... }      B) SalesSummary directamente
 * y se valida que las cifras sean enteros. Si no se entiende, se lanza un error claro (no se inventan cifras).
 * Ver docs/PENDIENTES-mobile.md.
 */
import { PAYMENT_METHODS } from '@amara/shared';
import type { MethodTotals, PaymentMethod, SalesSummary } from '@amara/shared';

export class StatsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatsParseError';
  }
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) throw new StatsParseError(`Respuesta del servidor inválida: "${name}" no es un entero.`);
  return v;
};
const optInt = (v: unknown, name: string): number => (v === undefined || v === null ? 0 : int(v, name));

export interface ParsedStats {
  summary: SalesSummary;
  /** Marca de tiempo del servidor, si la envía (generatedAt | serverTime | updatedAt). */
  updatedAt: string | null;
}

export function parseStatsResponse(json: unknown): ParsedStats {
  if (!isRec(json)) throw new StatsParseError('Respuesta del servidor inválida.');
  const raw = isRec(json.summary) ? json.summary : json;
  if (!('grossCents' in raw) || !('netCents' in raw)) throw new StatsParseError('La respuesta del servidor no trae el resumen de ventas esperado.');

  const byMethodRaw = isRec(raw.byMethod) ? raw.byMethod : {};
  const byMethod = Object.fromEntries(
    PAYMENT_METHODS.map((m) => {
      const r = isRec(byMethodRaw[m]) ? (byMethodRaw[m] as Record<string, unknown>) : {};
      const gross = optInt(r.grossCents, `byMethod.${m}.grossCents`);
      const refunded = optInt(r.refundedCents, `byMethod.${m}.refundedCents`);
      const totals: MethodTotals = { grossCents: gross, refundedCents: refunded, netCents: r.netCents === undefined ? gross - refunded : int(r.netCents, `byMethod.${m}.netCents`) };
      return [m, totals];
    }),
  ) as Record<PaymentMethod, MethodTotals>;

  const summary: SalesSummary = {
    grossCents: int(raw.grossCents, 'grossCents'),
    cancelledCents: optInt(raw.cancelledCents, 'cancelledCents'),
    refundedCents: optInt(raw.refundedCents, 'refundedCents'),
    netCents: int(raw.netCents, 'netCents'),
    ticketCount: optInt(raw.ticketCount, 'ticketCount'),
    cancelledCount: optInt(raw.cancelledCount, 'cancelledCount'),
    refundCount: optInt(raw.refundCount, 'refundCount'),
    avgTicketCents: optInt(raw.avgTicketCents, 'avgTicketCents'),
    byMethod,
    unitsSold: optInt(raw.unitsSold, 'unitsSold'),
    cogsCents: optInt(raw.cogsCents, 'cogsCents'),
    grossProfitCents: optInt(raw.grossProfitCents, 'grossProfitCents'),
    topByUnits: [],
    topByRevenue: [],
  };

  const stamp = [json.generatedAt, json.serverTime, json.updatedAt, isRec(json.summary) ? undefined : raw.generatedAt]
    .find((v): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)));
  return { summary, updatedAt: stamp ?? null };
}

/**
 * Efectivo esperado de /cash/current. Acepta { breakdown: { expectedCents } } o { expectedCents }.
 * Devuelve null si no hay caja abierta o no se entiende (la pantalla dice "no disponible").
 */
export function parseCashExpected(json: unknown): number | null {
  if (!isRec(json)) return null;
  const b = isRec(json.breakdown) ? json.breakdown : isRec(json.session) && isRec((json.session as Record<string, unknown>).breakdown) ? ((json.session as Record<string, unknown>).breakdown as Record<string, unknown>) : json;
  const v = b.expectedCents;
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}
