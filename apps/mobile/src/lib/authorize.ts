/**
 * Autorización de acciones sensibles en el móvil (cerrar caja, cancelar, devolver, Limpias de un vendedor).
 *
 * Reglas (docs/CAMBIOS-v2.md §1):
 *  - Gerente: confirma con SU contraseña (queda como authorizedBy).
 *  - Vendedor: contraseña de un administrador O un token vigente con el propósito correcto.
 *  - Primero se comprueba LOCALMENTE (LocalStore.verifyActionAuthorization: hashes de tokens y verificadores de
 *    gerentes del último pull). Si eso no basta y hay internet, se pregunta al servidor (POST /security/verify).
 *  - Si no se puede comprobar, se DENIEGA. Jamás se guarda la contraseña ni el código; solo viaja `authorization`.
 *
 * Lógica sin React: se prueba con un LocalStore real (test/authorize.test.ts).
 */
import type { LocalStore } from '@amara/database';
import type { ActionAuthorization, Role, TokenPurpose } from '@amara/shared';

export type AuthMode = 'password' | 'token';

export const PURPOSE_ACTION: Record<TokenPurpose, string> = {
  cierre_caja: 'cerrar la caja',
  devolucion: 'registrar una devolución',
  cancelacion: 'cancelar el ticket',
  limpias: 'entrar a Limpias',
};

/** El gerente solo usa su contraseña; el vendedor puede usar contraseña de admin o token. */
export function modesFor(role: Role): AuthMode[] {
  return role === 'gerente' ? ['password'] : ['password', 'token'];
}

export interface AuthRequest {
  purpose: TokenPurpose;
  branchId: string;
  userId: string;
  role: Role;
  mode: AuthMode;
  /** Contraseña o código de token tal como lo escribió la persona. No se conserva. */
  secret: string;
}

export type AuthOutcome =
  | {
      ok: true;
      authorization: ActionAuthorization;
      /** true = lo validó el servidor en línea (el token puede no estar en la caché local). Se pasa como authorizationTrusted. */
      trusted: boolean;
      authorizedBy: string | null;
      authorizedByName: string | null;
      via: 'local' | 'servidor';
    }
  | { ok: false; reason: string; message: string };

/** Pregunta al servidor (POST /security/verify). Debe lanzar si no hay conexión. */
export type OnlineVerify = (body: Record<string, unknown>) => Promise<unknown>;

/** Motivos locales que merecen preguntar al servidor (la caché puede estar vieja). Los definitivos no se reintentan. */
export function shouldTryOnline(reason: string): boolean {
  return ['no_coincide', 'sin_verificador', 'sin_administrador', 'contrasena_incorrecta'].includes(reason);
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);

/** Lee la respuesta de POST /security/verify (200 con ok:true|false). Tolerante; nunca lanza. */
export function parseVerifyResponse(json: unknown): AuthOutcome {
  if (!isDict(json)) return { ok: false, reason: 'respuesta_invalida', message: 'Respuesta inválida del servidor' };
  if (json.ok !== true) {
    return { ok: false, reason: typeof json.reason === 'string' ? json.reason : 'denegado', message: typeof json.message === 'string' && json.message ? json.message : 'El servidor no autorizó la acción' };
  }
  const a = json.authorization;
  let authorization: ActionAuthorization | null = null;
  if (isDict(a) && a.kind === 'admin_password' && typeof a.adminUserId === 'string' && a.adminUserId) authorization = { kind: 'admin_password', adminUserId: a.adminUserId };
  else if (isDict(a) && a.kind === 'token' && typeof a.tokenId === 'string' && a.tokenId) authorization = { kind: 'token', tokenId: a.tokenId };
  else if (typeof json.tokenId === 'string' && json.tokenId) authorization = { kind: 'token', tokenId: json.tokenId };
  if (!authorization) return { ok: false, reason: 'respuesta_invalida', message: 'El servidor no indicó quién autoriza' };
  return {
    ok: true,
    authorization,
    trusted: true,
    authorizedBy: typeof json.authorizedBy === 'string' ? json.authorizedBy : null,
    authorizedByName: typeof json.authorizedByName === 'string' ? json.authorizedByName : null,
    via: 'servidor',
  };
}

export async function authorizeAction(store: LocalStore, req: AuthRequest, onlineVerify: OnlineVerify | null): Promise<AuthOutcome> {
  const secret = req.mode === 'token' ? req.secret.trim() : req.secret;
  if (secret === '') {
    return { ok: false, reason: 'datos_faltantes', message: req.mode === 'token' ? 'Escribe el código del token' : 'Escribe la contraseña' };
  }
  if (!modesFor(req.role).includes(req.mode)) {
    return { ok: false, reason: 'modo_invalido', message: 'Tu rol solo puede autorizar con su contraseña' };
  }
  // Gerente: solo SU contraseña. Vendedor con contraseña: la de cualquier gerente de la sucursal.
  const adminUserId = req.mode === 'password' && req.role === 'gerente' ? req.userId : undefined;

  const local = await store.verifyActionAuthorization(
    req.mode === 'token'
      ? { code: secret, purpose: req.purpose, branchId: req.branchId, userId: req.userId }
      : { adminPassword: secret, adminUserId, purpose: req.purpose, branchId: req.branchId, userId: req.userId },
  );
  if (local.ok) {
    return { ok: true, authorization: local.authorization, trusted: false, authorizedBy: local.authorizedBy, authorizedByName: local.authorizedByName, via: 'local' };
  }
  if (!onlineVerify || !shouldTryOnline(local.reason)) return { ok: false, reason: local.reason, message: local.message };

  try {
    const json = await onlineVerify(
      req.mode === 'token'
        ? { code: secret, purpose: req.purpose, branchId: req.branchId }
        : { adminPassword: secret, ...(adminUserId ? { adminUserId } : {}), purpose: req.purpose, branchId: req.branchId },
    );
    const parsed = parseVerifyResponse(json);
    if (parsed.ok && req.mode === 'password' && adminUserId && parsed.authorization.kind === 'admin_password' && parsed.authorization.adminUserId !== adminUserId) {
      return { ok: false, reason: 'otra_cuenta', message: 'La contraseña no corresponde a tu cuenta' };
    }
    return parsed;
  } catch {
    // Sin conexión (o error del servidor): no se pudo comprobar, así que se deniega con el motivo local.
    return { ok: false, reason: local.reason, message: `${local.message}. No se pudo comprobar en línea.` };
  }
}
