/** /sync: único grupo de rutas al que pasa un token de terminal (también acepta sesión de usuario con acceso a la sucursal). */
import { Router } from 'express';
import { z } from 'zod';
import { can } from '@amara/shared';
import type { SyncOp, SyncResult } from '@amara/shared';
import { syncPushSchema, isoDate } from '@amara/shared/schemas';
import { assertBranch } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import { buildPullPayload } from '../pull.ts';
import { applySyncOp } from '../sync-apply.ts';
import type { ApplyContext } from '../sync-apply.ts';
import { createMongoSyncRepo } from '../sync-repo.ts';

export const syncRouter = Router();
const repo = createMongoSyncRepo();

/** Una sesión de usuario solo puede sincronizar si su rol opera el punto de venta (el desarrollador no). */
function assertUserMaySync(user: NonNullable<Express.Request['user']>) {
  if (!can(user.role, 'productos.ver')) throw new HttpError(403, 'No tienes permiso para sincronizar datos');
}

syncRouter.post(
  '/push',
  ah(async (req, res) => {
    const body = parse(syncPushSchema, req.body);
    let ctx: ApplyContext;
    if (req.terminal) {
      if (body.terminalId !== req.terminal.id) throw new HttpError(403, 'El token no corresponde a esta terminal');
      ctx = { now: () => new Date(), source: 'terminal', terminal: req.terminal };
    } else if (req.user) {
      assertUserMaySync(req.user);
      ctx = { now: () => new Date(), source: 'usuario', sessionUserId: req.user.id };
    } else {
      throw new HttpError(401, 'Falta iniciar sesión');
    }

    // En orden y una por una: una venta debe existir antes que su cancelación.
    const results: SyncResult[] = [];
    try {
      for (const op of body.ops) results.push(await applySyncOp(repo, op as SyncOp, ctx));
    } catch (e) {
      // Si falla a la mitad se responde lo ya confirmado; el dispositivo reenvía el resto (idempotente).
      if (results.length === 0) throw e;
      console.error('[sync] push interrumpido tras', results.length, 'operaciones:', e);
    }
    if (req.terminal) {
      await col('terminals').updateOne({ _id: req.terminal.id }, { $set: { lastSyncAt: new Date().toISOString() } }).catch(() => undefined);
    }
    res.json({ results, serverTime: new Date().toISOString() });
  }),
);

syncRouter.get(
  '/pull',
  ah(async (req, res) => {
    const q = parse(z.object({ branchId: z.string().min(1).optional(), since: isoDate.optional() }), req.query);
    let branchId: string;
    if (req.terminal) {
      branchId = req.terminal.branchId;
      if (q.branchId && q.branchId !== branchId) throw new HttpError(403, 'El token de terminal solo accede a su sucursal');
    } else if (req.user) {
      assertUserMaySync(req.user);
      if (!q.branchId) throw new HttpError(400, 'Falta branchId');
      assertBranch(req.user, q.branchId);
      branchId = q.branchId;
    } else {
      throw new HttpError(401, 'Falta iniciar sesión');
    }
    const payload = await buildPullPayload([branchId], q.since);
    if (req.terminal) await col('terminals').updateOne({ _id: req.terminal.id }, { $set: { lastPullAt: payload.serverTime } }).catch(() => undefined);
    res.json(payload);
  }),
);
