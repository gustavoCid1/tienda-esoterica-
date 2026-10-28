/** Utilidades compartidas por las rutas. */
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { can, mxDayBounds } from '@amara/shared';
import type { Role } from '@amara/shared';
import { HttpError } from './http.ts';
import type { AuthUser } from './auth.ts';

/** Ejecuta un middleware de Express como promesa (para usarlo de forma condicional dentro de un handler). */
export function runMw(mw: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      Promise.resolve(mw(req, res, (err?: unknown) => (err ? reject(err) : resolve()))).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

export function sessionUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(403, 'Se requiere una sesión de usuario');
  return req.user;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Quita propiedades undefined (el driver las guardaría como null). */
export function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Solo el gerente (quien puede editar precios) ve costos. */
export const canSeeCosts = (role: Role) => can(role, 'precios.editar');

/** Día calendario AAAA-MM-DD válido (no acepta 2026-02-31). */
export const dayStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Fecha inexistente');

export const pageQuery = (defaultLimit = 100, maxLimit = 500) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  });

/** [desde, hasta) en UTC a partir de días de México (ambos inclusive). */
export function dayRangeIso(from?: string, to?: string): { from?: string; to?: string } {
  return { from: from ? mxDayBounds(from).from : undefined, to: to ? mxDayBounds(to).to : undefined };
}

/** Filtro Mongo de rango sobre un campo ISO. */
export function isoRangeFilter(field: string, from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  const cond: Record<string, string> = {};
  if (from) cond.$gte = from;
  if (to) cond.$lt = to;
  return { [field]: cond };
}

/** Convierte el rechazo de una operación aplicada en el servidor en un error HTTP legible. */
export function rejectionToHttp(kind: string | undefined, detail: string | undefined): HttpError {
  const msg = detail ?? 'Operación rechazada';
  if (kind === 'sin_permiso' || kind === 'sin_acceso_sucursal') return new HttpError(403, msg);
  if (kind === 'venta_no_encontrada' || kind === 'sesion_no_encontrada' || kind === 'producto_no_encontrado') return new HttpError(404, msg);
  if (kind === 'ya_cancelada' || kind === 'ya_cerrada' || kind === 'tiene_devoluciones' || kind === 'devolucion_excedida') return new HttpError(409, msg);
  return new HttpError(400, msg);
}
