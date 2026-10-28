/** Acceso a entradas de mercancía: junta los datos locales y aplica lib/entry-guard (lógica pura). */
import type { Actor, LocalStore } from '@amara/database';
import type { Grant } from '@amara/shared';
import { evaluateEntryAccess } from '../lib/entry-guard.ts';
import type { EntryAccess } from '../lib/entry-guard.ts';

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export async function loadEntryAccess(store: LocalStore, actor: Actor, branchId: string, nowMs: number = Date.now()): Promise<EntryAccess> {
  const rows = await store.db.all<any>('SELECT * FROM grants_local WHERE seller_id = ? AND branch_id = ?', [actor.userId, branchId]);
  const grants: Grant[] = rows.map((r) => ({
    id: r.id,
    sellerId: r.seller_id,
    branchId: r.branch_id,
    functions: parseJson<string[]>(r.functions_json, []),
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    grantedBy: r.granted_by,
  }));
  // Los permisos se actualizan completos en cada pull: su "frescura" es la del último pull (hora del servidor).
  const lastPull = (await store.getMeta('last_pull_at')) ?? null;
  const highWater = (await store.getMeta('clock_high_water')) ?? null;
  return evaluateEntryAccess({
    role: actor.role,
    userId: actor.userId,
    branchId,
    grants,
    grantsFetchedAt: lastPull,
    nowMs,
    lastServerTimeIso: lastPull,
    clockHighWaterIso: highWater,
  });
}

/**
 * Marca de agua del reloj: la mayor hora del teléfono que la app ha visto. Si luego el reloj aparece
 * MÁS ATRASADO, se sospecha manipulación (ver entry-guard). `force` se usa cuando la hora quedó
 * verificada contra el servidor tras un pull correcto.
 */
export async function touchClockHighWater(store: LocalStore, nowMs: number = Date.now(), force = false): Promise<void> {
  const cur = await store.getMeta('clock_high_water');
  const curMs = cur ? Date.parse(cur) : NaN;
  if (force || !Number.isFinite(curMs) || nowMs >= curMs) await store.setMeta('clock_high_water', new Date(nowMs).toISOString());
}
