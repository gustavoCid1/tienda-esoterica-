/** Reglas PURAS de la autorización de acciones en línea (sin base de datos), separadas para poder probarlas. */
import { can } from '@amara/shared';
import type { ActionAuthorization, Permission, TokenPurpose } from '@amara/shared';
import { HttpError } from './http.ts';

/** Filtro de Mongo que identifica la verificación que respalda una autorización declarada. */
export function verificationFilter(userId: string, purpose: TokenPurpose, branchId: string, a: ActionAuthorization, now: Date): Record<string, unknown> {
  return {
    requesterKey: `u:${userId}`, purpose, branchId, 'authorization.kind': a.kind, expireAt: { $gt: now },
    ...(a.kind === 'token' ? { 'authorization.tokenId': a.tokenId } : { 'authorization.adminUserId': a.adminUserId }),
  };
}

/** Falla de inmediato (sin tocar la base) si el rol no puede iniciar la acción ni siquiera con autorización. */
export function assertMayAttempt(role: string, perm: Permission, hasAuthorization: boolean): 'directo' | 'autorizado' {
  if (can(role as any, perm)) return 'directo';
  if (role === 'vendedor') {
    if (!hasAuthorization) throw new HttpError(403, 'Esta acción necesita la autorización de un administrador (contraseña o token)');
    return 'autorizado';
  }
  throw new HttpError(403, 'No tienes permiso para esta acción');
}
