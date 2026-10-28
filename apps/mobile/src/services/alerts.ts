/**
 * Existencias en mínimo: carga (servidor si hay conexión; si no, la base local) y alerta del teléfono SIN repetir.
 * Solo el gerente usa esto: el servidor igualmente da 403 a quien no lo es.
 */
import type { LocalStore } from '@amara/database';
import {
  alertMessage, alertStateMetaKey, lowStockFromHits, normalizeLowStock, parseAlertState, planLowStockAlerts, serializeAlertState,
} from '../lib/low-stock';
import type { LowStockItem } from '../lib/low-stock';
import { ApiClient, ApiError } from './api';
import { showAlert } from './notifications';

export interface LowStockLoad {
  items: LowStockItem[];
  source: 'servidor' | 'local';
  /** Aviso para la pantalla (p. ej. por qué se usó lo local). */
  note: string | null;
}

export class LowStockForbiddenError extends Error {
  constructor() {
    super('Tu rol no puede ver las notificaciones de existencias.');
    this.name = 'LowStockForbiddenError';
  }
}

/** Productos en o bajo su mínimo: GET /stats/low-stock en línea; sin conexión, el cálculo local con LocalStore. */
export async function loadLowStock(d: { api: ApiClient | null; store: LocalStore; online: boolean; branchId: string }): Promise<LowStockLoad> {
  let note: string | null = null;
  if (d.api && d.online) {
    try {
      const json = await d.api.get<unknown>(`/stats/low-stock?branchId=${encodeURIComponent(d.branchId)}`, { timeoutMs: 10_000 });
      return { items: normalizeLowStock(json), source: 'servidor', note: null };
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) throw new LowStockForbiddenError();
      note = e instanceof ApiError && e.status === 401 ? 'La sesión en línea venció: se muestran los datos guardados en este teléfono.' : 'No se pudo consultar al servidor: se muestran los datos guardados en este teléfono.';
    }
  }
  const hits = await d.store.inventoryList({ branchId: d.branchId, filter: 'todos', limit: 5000 });
  return {
    items: lowStockFromHits(hits, d.branchId),
    source: 'local',
    note: note ?? 'Sin conexión: cálculo con las existencias guardadas en este teléfono (última sincronización).',
  };
}

const running = new Map<string, Promise<number>>();

/**
 * Aplica la regla de "no repetir": avisa solo lo nuevo o lo que empeoró. Devuelve cuántos productos se avisaron.
 * El estado ya avisado solo se guarda si el sistema aceptó la notificación (sin permiso no se pierde la alerta).
 */
export function notifyNewLowStock(store: LocalStore, userId: string, branchId: string, items: LowStockItem[]): Promise<number> {
  const key = alertStateMetaKey(userId, branchId);
  const prev = running.get(key);
  if (prev) return prev;
  const p = (async () => {
    const state = parseAlertState(await store.getMeta(key));
    const plan = planLowStockAlerts(items, state);
    const msg = alertMessage(plan.fresh);
    if (msg) {
      const shown = await showAlert(msg);
      if (!shown) return 0;
      await store.setMeta(key, serializeAlertState(plan.next));
      return plan.fresh.length;
    }
    // Nada nuevo: se podan del estado los productos que ya se recuperaron.
    if (serializeAlertState(plan.next) !== serializeAlertState(state)) await store.setMeta(key, serializeAlertState(plan.next));
    return 0;
  })();
  running.set(key, p);
  void p.then(
    () => running.delete(key),
    () => running.delete(key),
  );
  return p;
}
