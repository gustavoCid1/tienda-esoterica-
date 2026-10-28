import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Envuelve handlers async para que los errores lleguen al manejador central. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Valida con Zod; responde 400 con el primer mensaje legible. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, `${issue?.path.join('.') || 'datos'}: ${issue?.message ?? 'inválido'}`);
  }
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.code === 11000) return res.status(409).json({ error: 'Registro duplicado' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno del servidor' });
}

export const withId = <T extends { id: string }>(doc: T) => ({ _id: doc.id, ...doc });
export const out = <T extends { _id?: any }>(doc: T | null | undefined) => {
  if (!doc) return doc;
  const { _id, ...rest } = doc as any;
  return { id: _id, ...rest };
};
