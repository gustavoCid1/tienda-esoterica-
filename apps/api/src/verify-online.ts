/**
 * Verificación EN LÍNEA de un token o de la contraseña de un gerente (v2). Lógica pura: los datos entran por `VerifyDeps`.
 * Es lo que usa POST /security/verify. Nunca devuelve ni registra el código o la contraseña.
 */
import { tokenDenyMessage } from '@amara/shared';
import type { ActionAuthorization, CachedSecurityToken, TokenPurpose } from '@amara/shared';
import { matchTokenCode } from './security.ts';
import type { AdminRec } from './security.ts';

export interface AdminWithHash extends AdminRec {
  username?: string;
  passwordHash?: string | null;
}

export interface VerifyDeps {
  /** Tokens que pudieran servir en esa sucursal (de esa sucursal o de todas). */
  candidateTokens(branchId: string): Promise<CachedSecurityToken[]>;
  getUser(id: string): Promise<AdminWithHash | null>;
  /** Gerentes activos de la sucursal (opcionalmente filtrados por usuario). */
  branchAdmins(branchId: string, filter: { adminUserId?: string; adminUsername?: string }): Promise<AdminWithHash[]>;
  /** Compara en tiempo constante; con `hash` nulo igual consume el tiempo de un hash falso. */
  checkPassword(hash: string | null | undefined, password: string): boolean;
}

export interface VerifyInput {
  code?: string;
  adminPassword?: string;
  adminUserId?: string;
  adminUsername?: string;
  purpose: TokenPurpose;
  branchId: string;
}

export type VerifyOutcome =
  | { ok: true; authorization: ActionAuthorization; authorizedBy: string; authorizedByName: string | null; tokenId: string | null; expiresAt: string | null; label: string | null }
  | { ok: false; reason: string; message: string };

const deny = (reason: string, message: string): VerifyOutcome => ({ ok: false, reason, message });

/** `requesterUserId` es el usuario con sesión ('' para una terminal): los tokens "solo para" un usuario lo exigen. */
export async function verifyOnline(deps: VerifyDeps, input: VerifyInput, requesterUserId: string, atIso: string): Promise<VerifyOutcome> {
  if (input.code) {
    const m = matchTokenCode(input.code, await deps.candidateTokens(input.branchId), { purpose: input.purpose, branchId: input.branchId, userId: requesterUserId, atIso });
    if (!m.ok) return deny(m.reason, tokenDenyMessage(m.reason));
    const creator = await deps.getUser(m.token.createdBy);
    return {
      ok: true, authorization: { kind: 'token', tokenId: m.token.id }, authorizedBy: m.token.createdBy, authorizedByName: creator?.name ?? null,
      tokenId: m.token.id, expiresAt: m.token.expiresAt, label: m.token.label,
    };
  }

  const admins = await deps.branchAdmins(input.branchId, { adminUserId: input.adminUserId, adminUsername: input.adminUsername });
  if (admins.length === 0) {
    deps.checkPassword(null, input.adminPassword ?? '');
    return deny('no_coincide', 'Contraseña de administrador incorrecta');
  }
  for (const a of admins) {
    if (a.role !== 'gerente' || !a.active || !a.branchIds.includes(input.branchId)) continue;
    if (deps.checkPassword(a.passwordHash, input.adminPassword ?? '')) {
      return { ok: true, authorization: { kind: 'admin_password', adminUserId: a.id }, authorizedBy: a.id, authorizedByName: a.name, tokenId: null, expiresAt: null, label: null };
    }
  }
  return deny('no_coincide', 'Contraseña de administrador incorrecta');
}
