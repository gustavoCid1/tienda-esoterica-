/** /cash: sesiones de caja. Las altas, movimientos y cortes pasan por applySyncOp (misma lógica que la sincronización). */
import { Router } from 'express';
import { z } from 'zod';
import { computeCashBreakdown, newId, sumDenominations } from '@amara/shared';
import type { SyncOp } from '@amara/shared';
import { cashCloseSchema, cents, uuid } from '@amara/shared/schemas';
import { assertBranch, branchScope, requirePerm } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, out, parse } from '../http.ts';
import { authorizeOnline, preflight } from '../online-authz.ts';
import { applySyncOp } from '../sync-apply.ts';
import type { ApplyContext } from '../sync-apply.ts';
import { createMongoSyncRepo } from '../sync-repo.ts';
import { dayRangeIso, dayStr, isoRangeFilter, pageQuery, rejectionToHttp, sessionUser } from '../util.ts';

export const cashRouter = Router();
const repo = createMongoSyncRepo();
const ctx = (): ApplyContext => ({ now: () => new Date(), source: 'servidor' });

cashRouter.get(
  '/sessions',
  requirePerm('caja.corte'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional(), from: dayStr.optional(), to: dayStr.optional() }).merge(pageQuery(100, 500)), req.query);
    const range = dayRangeIso(q.from, q.to);
    const filter = { branchId: { $in: branchScope(user, q.branchId) }, ...isoRangeFilter('openedAt', range.from, range.to) };
    const [total, items] = await Promise.all([
      col('cash_sessions').countDocuments(filter),
      col('cash_sessions').find(filter).sort({ openedAt: -1 }).skip(q.offset).limit(q.limit).toArray(),
    ]);
    res.json({ total, items: items.map((s) => out(s)) });
  }),
);

/** Sesión abierta de la terminal con el desglose esperado calculado en vivo. */
cashRouter.get(
  '/current',
  requirePerm('caja.abrir'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ terminalId: z.string().min(1) }), req.query);
    const terminal = await col('terminals').findOne({ _id: q.terminalId }, { projection: { branchId: 1 } });
    if (!terminal) throw new HttpError(404, 'Terminal no encontrada');
    assertBranch(user, terminal.branchId);
    const session = await col('cash_sessions').findOne({ terminalId: q.terminalId, status: 'abierta' });
    if (!session) return void res.json({ session: null, breakdown: null, movements: [] });
    const [data, movements] = await Promise.all([repo.cashDataForSession(session._id), col('cash_movements').find({ sessionId: session._id }).sort({ createdAt: 1 }).toArray()]);
    res.json({
      session: out(session),
      breakdown: computeCashBreakdown(session.openingCents, session._id, data.sales, data.adjustments, data.movements),
      movements: movements.map((m) => out(m)),
    });
  }),
);

cashRouter.post(
  '/open',
  requirePerm('caja.abrir'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const body = parse(z.object({ id: uuid.optional(), terminalId: z.string().min(1), branchId: z.string().min(1), openingCents: cents }), req.body);
    assertBranch(user, body.branchId);
    const terminal = await col('terminals').findOne({ _id: body.terminalId }, { projection: { branchId: 1, revoked: 1 } });
    if (!terminal || terminal.branchId !== body.branchId) throw new HttpError(400, 'La terminal no pertenece a la sucursal indicada');
    if (await col('cash_sessions').findOne({ terminalId: body.terminalId, status: 'abierta' }, { projection: { _id: 1 } })) {
      throw new HttpError(409, 'Ya hay una caja abierta en esta terminal');
    }
    const id = body.id ?? newId();
    const now = new Date().toISOString();
    const op: SyncOp = {
      opId: newId(), type: 'cash.open', branchId: body.branchId, terminalId: body.terminalId, userId: user.id, localTs: now,
      payload: { session: { id, branchId: body.branchId, terminalId: body.terminalId, openedBy: user.id, openedAt: now, openingCents: body.openingCents } },
    };
    const r = await applySyncOp(repo, op, ctx());
    if (r.status === 'rejected') throw rejectionToHttp(r.conflictKind, r.detail);
    if (r.conflictKind === 'caja_duplicada') throw new HttpError(409, 'Ya hay una caja abierta en esta terminal');
    res.status(201).json({ ok: true, session: out(await col('cash_sessions').findOne({ _id: id })) });
  }),
);

cashRouter.post(
  '/movements',
  requirePerm('caja.movimientos'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const body = parse(
      z.object({ id: uuid.optional(), sessionId: z.string().min(1), type: z.enum(['entrada', 'retiro', 'gasto']), amountCents: z.number().int().positive().max(100_000_000_00), concept: z.string().trim().min(3).max(200) }),
      req.body,
    );
    const session = await col('cash_sessions').findOne({ _id: body.sessionId });
    if (!session) throw new HttpError(404, 'Sesión de caja no encontrada');
    assertBranch(user, session.branchId);
    if (session.status !== 'abierta') throw new HttpError(409, 'La caja ya está cerrada');
    const id = body.id ?? newId();
    const op: SyncOp = {
      opId: newId(), type: 'cash.movement', branchId: session.branchId, terminalId: session.terminalId, userId: user.id, localTs: new Date().toISOString(),
      payload: { movement: { id, sessionId: session._id, type: body.type, amountCents: body.amountCents, concept: body.concept, userId: user.id, createdAt: new Date().toISOString() } },
    };
    const r = await applySyncOp(repo, op, ctx());
    if (r.status === 'rejected') throw rejectionToHttp(r.conflictKind, r.detail);
    res.status(201).json({ ok: true, id });
  }),
);

/**
 * Corte de caja. Gerente: con contraseña reciente (x-reauth). Vendedor: SOLO con `authorization` (contraseña de admin o token,
 * verificada antes con POST /security/verify, propósito `cierre_caja`). El esperado lo calcula el servidor, no el cliente.
 */
cashRouter.post(
  '/close',
  ah(async (req, res) => {
    const user = sessionUser(req);
    await preflight(req, res, 'caja.corte');
    const body = parse(cashCloseSchema.extend({ sessionId: z.string().min(1).optional(), terminalId: z.string().min(1).optional() }), req.body);
    if (!body.sessionId && !body.terminalId) throw new HttpError(400, 'Indica sessionId o terminalId');
    const session = await col('cash_sessions').findOne(body.sessionId ? { _id: body.sessionId } : { terminalId: body.terminalId, status: 'abierta' });
    if (!session) throw new HttpError(404, 'No hay una sesión de caja abierta');
    assertBranch(user, session.branchId);
    if (session.status !== 'abierta') throw new HttpError(409, 'La sesión de caja ya fue cerrada');
    if (body.denominations) {
      let sum: number;
      try {
        sum = sumDenominations(body.denominations);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Denominaciones inválidas');
      }
      if (sum !== body.countedCents) throw new HttpError(400, 'El desglose de billetes y monedas no suma el efectivo contado');
    }
    const authorization = await authorizeOnline(req, { perm: 'caja.corte', purpose: 'cierre_caja', raw: body.authorization, branchId: session.branchId });
    const now = new Date().toISOString();
    const op: SyncOp = {
      opId: newId(), type: 'cash.close', branchId: session.branchId, terminalId: session.terminalId, userId: user.id, localTs: now,
      payload: { sessionId: session._id, closedBy: user.id, closedAt: now, countedCents: body.countedCents, denominations: body.denominations ?? null, notes: body.notes ?? null, ...(authorization ? { authorization } : {}) },
    };
    const r = await applySyncOp(repo, op, ctx());
    if (r.status === 'rejected') throw rejectionToHttp(r.conflictKind, r.detail);
    const closed = await col('cash_sessions').findOne({ _id: session._id });
    res.json({
      ok: true, sessionId: session._id, expectedCents: closed?.expectedCents, countedCents: closed?.countedCents, differenceCents: closed?.differenceCents,
      provisional: !!closed?.provisional, breakdown: closed?.closure?.breakdown ?? null,
      closedBy: closed?.closedBy ?? user.id, authorization: closed?.closeAuthorization ?? null, authorizedBy: closed?.closeAuthorizedBy ?? null,
    });
  }),
);
