/**
 * Autenticación y autorización.
 *  - El token SOLO identifica; el rol, el estado activo y las sucursales se leen de la base
 *    en CADA petición. Cambiar un rol o desactivar un usuario surte efecto de inmediato.
 *  - Token de terminal (scope "terminal"): credencial de larga duración, solo para /sync/*,
 *    emitida por el gerente al activar una terminal y revocable (tokenVersion).
 *  - Reautenticación: acciones administrativas sensibles exigen un token "reauth" de 5 min.
 */
import { SignJWT, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { can } from '@amara/shared';
import type { Permission, Role } from '@amara/shared';
import { config } from './config.ts';
import { col } from './db.ts';
import { HttpError } from './http.ts';

const secret = new TextEncoder().encode(config.jwtSecret);

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  branchIds: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      terminal?: { id: string; code: string; branchId: string };
    }
  }
}

export async function signSession(userId: string, hours = 12): Promise<{ token: string; expiresAt: string }> {
  const exp = new Date(Date.now() + hours * 3600_000);
  const token = await new SignJWT({ scope: 'session' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(exp).sign(secret);
  return { token, expiresAt: exp.toISOString() };
}

export async function signReauth(userId: string): Promise<string> {
  return new SignJWT({ scope: 'reauth' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime('5m').sign(secret);
}

export async function signTerminal(terminalId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ scope: 'terminal', v: tokenVersion }).setProtectedHeader({ alg: 'HS256' }).setSubject(terminalId).setIssuedAt().setExpirationTime('400d').sign(secret);
}

async function verify(token: string) {
  try {
    return (await jwtVerify(token, secret, { algorithms: ['HS256'] })).payload;
  } catch {
    throw new HttpError(401, 'Sesión inválida o vencida');
  }
}

function bearer(req: Request): string {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'Falta iniciar sesión');
  return h.slice(7);
}

/** Acepta sesión de usuario o token de terminal. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const p = await verify(bearer(req));
    if (p.scope === 'terminal') {
      const t = await col('terminals').findOne({ _id: p.sub as any });
      if (!t || t.revoked || t.tokenVersion !== p.v) throw new HttpError(401, 'Terminal no autorizada o revocada');
      req.terminal = { id: t._id as any, code: t.code, branchId: t.branchId };
      return next();
    }
    if (p.scope !== 'session') throw new HttpError(401, 'Tipo de token no permitido');
    const u = await col('users').findOne({ _id: p.sub as any });
    if (!u || !u.active) throw new HttpError(401, 'Usuario inactivo o inexistente');
    req.user = { id: u._id as any, username: u.username, name: u.name, role: u.role, branchIds: u.branchIds ?? [] };
    next();
  } catch (e) {
    next(e);
  }
}

/** Solo usuarios con sesión (los tokens de terminal NO pasan). */
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(403, 'Se requiere una sesión de usuario'));
  next();
}

export const requirePerm =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(403, 'Se requiere una sesión de usuario'));
    if (!perms.every((p) => can(req.user!.role, p))) return next(new HttpError(403, 'No tienes permiso para esta acción'));
    next();
  };

/** Exige token de reautenticación reciente (cabecera x-reauth) para acciones sensibles. */
export async function requireReauth(req: Request, _res: Response, next: NextFunction) {
  try {
    const t = req.headers['x-reauth'];
    if (typeof t !== 'string') throw new HttpError(401, 'Confirma tu contraseña para continuar');
    const p = await verify(t);
    if (p.scope !== 'reauth' || p.sub !== req.user?.id) throw new HttpError(401, 'Confirmación inválida');
    next();
  } catch (e) {
    next(e);
  }
}

export function assertBranch(user: AuthUser, branchId: string) {
  if (!user.branchIds.includes(branchId)) throw new HttpError(403, 'No tienes acceso a esa sucursal');
}

/** Sucursales visibles para el usuario; si pide una específica, valida acceso. */
export function branchScope(user: AuthUser, requested?: string | null): string[] {
  if (requested && requested !== 'todas') {
    assertBranch(user, requested);
    return [requested];
  }
  return user.branchIds;
}
