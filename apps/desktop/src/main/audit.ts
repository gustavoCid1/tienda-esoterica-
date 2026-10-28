/** Auditoría local de eventos del escritorio (el historial no se puede borrar ni modificar: triggers). */
import type { LocalStore } from '@amara/database';
import { newId } from '@amara/shared';

export async function auditLocal(
  store: LocalStore,
  a: { userId?: string | null; action: string; entity?: string; entityId?: string; branchId?: string; terminalId?: string; detail?: unknown },
): Promise<void> {
  try {
    await store.db.run(
      'INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, branch_id, terminal_id, detail_json) VALUES (?,?,?,?,?,?,?,?,?)',
      [newId(), new Date().toISOString(), a.userId ?? null, a.action, a.entity ?? null, a.entityId ?? null, a.branchId ?? null, a.terminalId ?? null, a.detail ? JSON.stringify(a.detail) : null],
    );
  } catch {
    /* la auditoría de sesión no debe impedir trabajar */
  }
}
