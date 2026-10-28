/** /prefs: preferencias del tablero por usuario. No otorgan permisos: solo personalizan lo que ya puede ver. */
import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth.ts';
import { col } from '../db.ts';
import { ah, parse } from '../http.ts';
import { sessionUser } from '../util.ts';

export const prefsRouter = Router();
prefsRouter.use(requirePerm('estadisticas.ver'));

/** Evita claves con '$' o '.' (operadores de MongoDB) en cualquier nivel de lo que guarda el usuario. */
function keysAreSafe(v: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(v)) return v.every((x) => keysAreSafe(x, depth + 1));
  if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => /^[A-Za-z0-9_-]{1,40}$/.test(k) && keysAreSafe(x, depth + 1));
  return true;
}

const prefsSchema = z
  .object({
    widgets: z.array(z.string().max(40)).max(40).optional(),
    range: z.string().max(20).optional(),
    branchId: z.string().max(64).nullable().optional(),
    compact: z.boolean().optional(),
  })
  .passthrough()
  .refine((v) => JSON.stringify(v).length <= 8000, 'Preferencias demasiado grandes')
  .refine((v) => keysAreSafe(v), 'Nombres de preferencia no válidos');

prefsRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const d = await col('dashboard_prefs').findOne({ _id: sessionUser(req).id });
    res.json({ prefs: d?.prefs ?? {}, updatedAt: d?.updatedAt ?? null });
  }),
);

prefsRouter.put(
  '/dashboard',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const prefs = parse(prefsSchema, req.body);
    const updatedAt = new Date().toISOString();
    await col('dashboard_prefs').updateOne({ _id: user.id }, { $set: { userId: user.id, prefs, updatedAt } }, { upsert: true });
    res.json({ prefs, updatedAt });
  }),
);
