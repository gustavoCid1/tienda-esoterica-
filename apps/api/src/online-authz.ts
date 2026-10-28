/**
 * Autorización de acciones sensibles hechas EN LÍNEA desde la API (cerrar caja, cancelar, devolver).
 *  - Gerente: su propia contraseña ya es de administrador → exige `x-reauth` como antes y no necesita `authorization`.
 *  - Vendedor: SIEMPRE necesita `authorization` (contraseña de un gerente o token). El servidor no recibe aquí el código:
 *    antes se comprobó con POST /security/verify, que deja una verificación de 10 minutos de UN solo uso; aquí se consume.
 *    Después `applySyncOp` la vuelve a validar (token vigente, gerente activo de la sucursal) y registra el uso.
 *  - Desarrollador y demás: nunca.
 */
import type { Request, Response } from 'express';
import { can } from '@amara/shared';
import type { ActionAuthorization, Permission, TokenPurpose } from '@amara/shared';
import { actionAuthorizationSchema } from '@amara/shared/schemas';
import { requireReauth } from './auth.ts';
import { col } from './db.ts';
import { HttpError } from './http.ts';
import { assertMayAttempt, verificationFilter } from './authz-rules.ts';
import { checkAuthorization } from './security.ts';
import { createMongoSyncRepo } from './sync-repo.ts';
import { runMw, sessionUser } from './util.ts';

/**
 * PRIMER paso de la ruta (antes de leer la base): rechaza al que no puede intentar la acción y, si es gerente, exige x-reauth.
 * Devuelve el modo: 'directo' (gerente) o 'autorizado' (vendedor con `authorization`).
 */
export async function preflight(req: Request, res: Response, perm: Permission): Promise<'directo' | 'autorizado'> {
  const user = sessionUser(req);
  const raw = (req.body as { authorization?: unknown } | undefined)?.authorization;
  const mode = assertMayAttempt(user.role, perm, raw !== undefined && raw !== null);
  if (mode === 'directo') await runMw(requireReauth, req, res);
  return mode;
}

/**
 * SEGUNDO paso (ya conocida la sucursal): para el vendedor valida la autorización con las reglas del servidor y consume la
 * verificación en línea. Devuelve la autorización a enviar a `applySyncOp` (undefined para el gerente).
 */
export async function authorizeOnline(
  req: Request,
  p: { perm: Permission; purpose: TokenPurpose; raw: unknown; branchId: string },
): Promise<ActionAuthorization | undefined> {
  const user = sessionUser(req);
  if (can(user.role, p.perm)) return undefined; // gerente: su contraseña (x-reauth) ya fue exigida en preflight
  const parsed = actionAuthorizationSchema.safeParse(p.raw);
  if (!parsed.success) throw new HttpError(400, 'authorization: formato inválido');
  const a = parsed.data as ActionAuthorization;
  if (!user.branchIds.includes(p.branchId)) throw new HttpError(403, 'No tienes acceso a esa sucursal');
  // En línea NO hay "operación ya ocurrida": si el servidor no acepta la autorización ahora (token agotado, gerente inactivo), se rechaza.
  const check = await checkAuthorization(createMongoSyncRepo(), a, { purpose: p.purpose, branchId: p.branchId, userId: user.id, opId: '', atIso: new Date().toISOString() });
  if (!check.ok) throw new HttpError(403, `La autorización no es válida: ${check.detail}`);
  const used = await col('security_verifications').findOneAndDelete(verificationFilter(user.id, p.purpose, p.branchId, a, new Date()));
  if (!used) throw new HttpError(403, 'Verifica primero el código o la contraseña de administrador: la verificación vale 10 minutos y se usa una sola vez');
  return a;
}
