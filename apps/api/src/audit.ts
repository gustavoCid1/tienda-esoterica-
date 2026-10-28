import { newId } from '@amara/shared';
import { col } from './db.ts';

/** Registro de auditoría: solo se agrega, nunca se modifica ni se borra desde la API. */
export async function audit(e: {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  branchId?: string | null;
  terminalId?: string | null;
  detail?: unknown;
  at?: string;
}): Promise<void> {
  const id = newId();
  await col('audit_log').insertOne({
    _id: id as any,
    id,
    at: e.at ?? new Date().toISOString(),
    userId: e.userId ?? null,
    action: e.action,
    entity: e.entity ?? null,
    entityId: e.entityId ?? null,
    branchId: e.branchId ?? null,
    terminalId: e.terminalId ?? null,
    detail: e.detail ?? null,
  });
}
