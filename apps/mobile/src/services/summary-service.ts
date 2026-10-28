/**
 * Carga del "Resumen de ventas" del gerente: servidor primero; sin conexión, cálculo local.
 * NUNCA se combinan (ver lib/summary-model). El servidor es quien autoriza: un vendedor recibe 403.
 */
import { mxRangeBounds } from '@amara/shared';
import type { LocalStore } from '@amara/database';
import { isTodayRange } from '../lib/date-range';
import { parseCashExpected, parseStatsResponse } from '../lib/stats-parse';
import { buildLocalView, buildServerView } from '../lib/summary-model';
import type { SummaryContext, SummaryView } from '../lib/summary-model';
import { ApiClient, ApiError } from './api';

export interface SummaryQuery {
  fromDay: string;
  toDay: string;
  /** null = consolidado de todas las sucursales autorizadas. */
  branchId: string | null;
  branchLabel: string;
  todayKey: string;
}

export class SummaryForbiddenError extends Error {
  constructor() {
    super('Tu rol no puede ver el resumen de ventas.');
    this.name = 'SummaryForbiddenError';
  }
}

export interface SummaryDeps {
  api: ApiClient;
  store: LocalStore;
  /** Según NetInfo. Si es false ni siquiera se intenta el servidor. */
  online: boolean;
  nowIso: string;
}

export async function loadSummaryView(deps: SummaryDeps, q: SummaryQuery): Promise<SummaryView> {
  const context: SummaryContext = { fromDay: q.fromDay, toDay: q.toDay, branchId: q.branchId, branchLabel: q.branchLabel, consolidated: q.branchId === null };
  const status = await deps.store.syncStatus();
  let serverProblem: string | null = null;

  if (deps.online) {
    const branchParam = encodeURIComponent(q.branchId ?? 'todas');
    // "Hoy": endpoint dedicado. Otros días o intervalos: /stats/summary (días AAAA-MM-DD, hora de México).
    const path = isTodayRange(q.fromDay, q.toDay, q.todayKey)
      ? `/stats/today?branchId=${branchParam}`
      : `/stats/summary?from=${q.fromDay}&to=${q.toDay}&branchId=${branchParam}`;
    try {
      const json = await deps.api.get<unknown>(path, { timeoutMs: 12_000 });
      const parsed = parseStatsResponse(json);
      return buildServerView(parsed.summary, context, { updatedAt: parsed.updatedAt ?? deps.nowIso, pendingOps: status.pending, lastSyncOkAt: status.lastSyncOkAt });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) throw new SummaryForbiddenError();
      if (e instanceof ApiError && e.status === 401) serverProblem = 'La sesión en línea venció; inicia sesión con internet para consultar al servidor.';
      else if (e instanceof ApiError && e.unreachable) serverProblem = null; // simplemente sin conexión
      else serverProblem = `El servidor no pudo dar el resumen (${e instanceof Error ? e.message : 'error'}).`;
    }
  }

  const { from, to } = mxRangeBounds(q.fromDay, q.toDay);
  const local = await deps.store.summary({ from, to, branchId: q.branchId });
  const view = buildLocalView(local.summary, context, { nowIso: deps.nowIso, pendingOps: local.pendingOps, lastSyncOkAt: local.lastSyncOkAt });
  if (serverProblem) view.notices.unshift({ kind: 'warn', text: serverProblem });
  return view;
}

export interface CashExpected {
  /** null = no hay dato (sin caja abierta o no disponible). */
  cents: number | null;
  source: 'servidor' | 'local' | null;
  note: string;
}

/**
 * Efectivo esperado de la caja de ESTA terminal. Se calcula aparte de las ventas
 * (computeCashBreakdown): solo cuenta dinero físico del cajón.
 */
export async function loadCashExpected(deps: SummaryDeps, terminalId: string): Promise<CashExpected> {
  if (deps.online) {
    try {
      const json = await deps.api.get<unknown>(`/cash/current?terminalId=${encodeURIComponent(terminalId)}`, { timeoutMs: 8_000 });
      const cents = parseCashExpected(json);
      if (cents !== null) return { cents, source: 'servidor', note: 'Calculado por el servidor para la caja abierta de esta terminal.' };
      // Sin dato del servidor: se intenta lo local (puede haber caja abierta sin sincronizar).
    } catch {
      /* se intenta lo local */
    }
  }
  const open = await deps.store.currentSession(terminalId);
  if (!open) return { cents: null, source: null, note: 'No hay una caja abierta en esta terminal.' };
  const { breakdown } = await deps.store.cashBreakdown(open.id);
  return { cents: breakdown.expectedCents, source: 'local', note: 'Cálculo LOCAL de esta terminal; no incluye movimientos de caja hechos en otro equipo.' };
}
