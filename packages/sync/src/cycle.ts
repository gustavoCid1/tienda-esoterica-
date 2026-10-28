import type { LocalStore } from '@amara/database';
import { isOfflineError, SyncHttpError } from './protocol.ts';
import type { SyncApi } from './protocol.ts';

export interface CycleOptions {
  branchId: string;
  terminalId: string;
  batchSize?: number;
}

export interface CycleReport {
  online: boolean;
  /** 401/403: sesión vencida o sin permiso; el usuario debe volver a iniciar sesión. */
  authError: boolean;
  sent: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  pulled: boolean;
  remaining: number;
  error?: string;
}

/**
 * Un ciclo completo: empuja lo pendiente (en orden) y, si quedó todo confirmado, baja el catálogo
 * y las existencias. Seguro de reintentar en cualquier punto: si se cae la red después de que el
 * servidor aplicó una operación, el reintento recibe "duplicate" y se confirma sin duplicar.
 */
export async function runSyncCycle(store: LocalStore, api: SyncApi, opts: CycleOptions): Promise<CycleReport> {
  const report: CycleReport = { online: true, authError: false, sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0, pulled: false, remaining: 0 };
  const batch = opts.batchSize ?? 25;

  try {
    for (;;) {
      const ops = await store.nextPending(batch);
      if (ops.length === 0) break;
      const res = await api.push({ terminalId: opts.terminalId, ops });
      report.sent += ops.length;
      let progress = 0;
      for (const r of res.results) {
        await store.markAck(r);
        progress++;
        if (r.status === 'applied') report.applied++;
        else if (r.status === 'duplicate') report.duplicates++;
        else if (r.status === 'conflict') report.conflicts++;
        else report.rejected++;
      }
      if (progress === 0) break; // el servidor no confirmó nada: evitar ciclo infinito
    }

    report.remaining = await store.pendingCount();
    if (report.remaining === 0) {
      const since = await store.getMeta('last_pull_at');
      const payload = await api.pull({ branchId: opts.branchId, since });
      await store.applyPull(payload);
      report.pulled = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.error = msg;
    if (err instanceof SyncHttpError && (err.status === 401 || err.status === 403)) {
      report.authError = true;
    } else if (isOfflineError(err)) {
      report.online = false;
    }
    const pending = await store.nextPending(1000);
    for (const op of pending.slice(0, 25)) await store.markFailure(op.opId, msg);
    report.remaining = await store.pendingCount();
  }
  return report;
}
