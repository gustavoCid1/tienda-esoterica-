/**
 * Sincronización en segundo plano: runSyncCycle de @amara/sync (primero ENVÍA lo pendiente, y solo si
 * todo quedó confirmado BAJA catálogo y existencias). Es seguro reintentar en cualquier punto: el
 * servidor es idempotente por opId.
 */
import { HttpSyncApi, runSyncCycle } from '@amara/sync';
import type { CycleReport } from '@amara/sync';
import type { LocalStore } from '@amara/database';

export interface SyncDeps {
  store: LocalStore;
  baseUrl: string;
  /** Token de terminal (larga duración) o, si no hay, el de la sesión de usuario. */
  getToken: () => Promise<string | null>;
  branchId: string;
  terminalId: string;
}

export async function runSync(d: SyncDeps): Promise<CycleReport> {
  if (!d.baseUrl.trim()) {
    return { online: false, authError: false, sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0, pulled: false, remaining: await d.store.pendingCount(), error: 'Falta la dirección del servidor.' };
  }
  const api = new HttpSyncApi({ baseUrl: d.baseUrl, getToken: d.getToken, timeoutMs: 30_000 });
  return runSyncCycle(d.store, api, { branchId: d.branchId, terminalId: d.terminalId });
}
