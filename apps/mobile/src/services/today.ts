/**
 * Tickets de hoy (solo gerente): GET /sales/today-summary en línea; sin conexión, LocalStore.listTodaySalesSummary.
 * Solo lo vendido (producto, cantidad, precio) e importe: NO el ticket impreso.
 */
import type { TodaySaleSummary } from '@amara/shared';
import type { LocalStore } from '@amara/database';
import { parseTodaySummary } from '../lib/misc-v2';
import { ApiClient, ApiError } from './api';

export interface TodayLoad {
  items: TodaySaleSummary[];
  source: 'servidor' | 'local';
  note: string | null;
}

export async function loadToday(d: { api: ApiClient; store: LocalStore; online: boolean; branchId: string }): Promise<TodayLoad> {
  let note: string | null = null;
  if (d.online) {
    try {
      const json = await d.api.get<unknown>(`/sales/today-summary?branchId=${encodeURIComponent(d.branchId)}`, { timeoutMs: 12_000 });
      return { items: parseTodaySummary(json), source: 'servidor', note: null };
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) throw new Error('Tu rol no puede consultar los tickets de hoy.');
      note = e instanceof ApiError && e.unreachable ? null : 'No se pudo consultar al servidor.';
    }
  }
  return {
    items: await d.store.listTodaySalesSummary({ branchId: d.branchId }),
    source: 'local',
    note: `${note ? `${note} ` : ''}DATOS LOCALES de este teléfono: pueden estar INCOMPLETOS (no incluyen ventas de otras terminales que no se hayan descargado).`,
  };
}
