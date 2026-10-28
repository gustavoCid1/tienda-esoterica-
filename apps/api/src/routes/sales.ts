/** /sales: archivo de tickets, ventas propias, cancelaciones y devoluciones (siempre como ajustes nuevos). */
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { can, mxTodayKey, newId } from '@amara/shared';
import type { ActionAuthorization, SaleAdjustment, SyncOp } from '@amara/shared';
import { actionAuthorizationSchema, paymentMethodSchema, uuid } from '@amara/shared/schemas';
import { AdjustmentError, buildCancellation, buildReturn } from '../adjustments.ts';
import { assertBranch, branchScope, requirePerm } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import { authorizeOnline, preflight } from '../online-authz.ts';
import { adjustmentView, saleView, toTodaySaleSummary } from '../serialize.ts';
import { applySyncOp } from '../sync-apply.ts';
import { createMongoSyncRepo } from '../sync-repo.ts';
import { canSeeCosts, dayRangeIso, dayStr, isoRangeFilter, pageQuery, rejectionToHttp, sessionUser } from '../util.ts';

export const salesRouter = Router();
const repo = createMongoSyncRepo();

salesRouter.get(
  '/',
  requirePerm('tickets.archivo'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(
      z
        .object({
          date: dayStr.optional(), from: dayStr.optional(), to: dayStr.optional(), branchId: z.string().optional(), folio: z.string().trim().max(60).optional(),
          userId: z.string().optional(), terminalId: z.string().optional(), status: z.enum(['completada', 'cancelada']).optional(),
        })
        .merge(pageQuery(100, 500)),
      req.query,
    );
    const range = dayRangeIso(q.date ?? q.from, q.date ?? q.to);
    const filter: Record<string, unknown> = { branchId: { $in: branchScope(user, q.branchId) }, ...isoRangeFilter('createdAt', range.from, range.to) };
    if (q.folio) filter.folio = q.folio;
    if (q.userId) filter.userId = q.userId;
    if (q.terminalId) filter.terminalId = q.terminalId;
    if (q.status) filter.status = q.status;
    const [total, docs] = await Promise.all([
      col('sales').countDocuments(filter),
      col('sales').find(filter).sort({ createdAt: -1 }).skip(q.offset).limit(q.limit).toArray(),
    ]);
    res.json({ total, items: docs.map((d) => saleView(d, true)) });
  }),
);

/**
 * v2. Tickets de HOY (hora de México) solo con lo vendido, cantidades y precios; sin ticket impreso, pagos ni costos.
 * Solo gerente. Debe declararse antes de `/:id`.
 */
salesRouter.get(
  '/today-summary',
  requirePerm('tickets.archivo'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional() }), req.query);
    const day = mxTodayKey();
    const range = dayRangeIso(day, day);
    const docs = await col('sales')
      .find({ branchId: { $in: branchScope(user, q.branchId) }, ...isoRangeFilter('createdAt', range.from, range.to) })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();
    const items = docs.map(toTodaySaleSummary);
    res.json({ day, count: items.length, totalCents: items.filter((i) => i.status !== 'cancelada').reduce((a, i) => a + i.totalCents, 0), items });
  }),
);

/** Ventas del propio usuario. Sin costos ni acumulados: el vendedor no ve totales financieros. */
salesRouter.get(
  '/mine',
  requirePerm('ventas.ver_propias'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ date: dayStr.optional() }).merge(pageQuery(200, 500)), req.query);
    const date = q.date ?? mxTodayKey();
    const range = dayRangeIso(date, date);
    const docs = await col('sales')
      .find({ userId: user.id, branchId: { $in: user.branchIds }, ...isoRangeFilter('createdAt', range.from, range.to) })
      .sort({ createdAt: -1 })
      .skip(q.offset)
      .limit(q.limit)
      .toArray();
    res.json({ date, items: docs.map((d) => saleView(d, false)) });
  }),
);

salesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const user = sessionUser(req);
    // Primero el permiso (sin tocar la base): solo quien ve el archivo o sus propias ventas puede consultar una venta.
    if (!can(user.role, 'tickets.archivo') && !can(user.role, 'ventas.ver_propias')) throw new HttpError(403, 'No tienes permiso para ver ventas');
    const sale = await col('sales').findOne({ _id: req.params.id! });
    if (!sale) throw new HttpError(404, 'Venta no encontrada');
    // Archivo completo (gerente) o dueño de la venta.
    const archive = can(user.role, 'tickets.archivo');
    const owner = sale.userId === user.id && can(user.role, 'ventas.ver_propias');
    if (!archive && !owner) throw new HttpError(403, 'No tienes permiso para ver esta venta');
    assertBranch(user, sale.branchId);
    const withCost = archive && canSeeCosts(user.role);
    const adjustments = archive ? await col('sale_adjustments').find({ saleId: sale._id }).sort({ createdAt: 1 }).toArray() : [];
    res.json({ sale: saleView(sale, withCost), adjustments: adjustments.map((a) => adjustmentView(a, withCost)) });
  }),
);

/** Caja de la que sale el dinero de una cancelación/devolución hecha desde la web. */
async function pickCashSession(branchId: string, terminalId?: string): Promise<{ sessionId: string | null; terminalId: string }> {
  if (terminalId) {
    const t = await col('terminals').findOne({ _id: terminalId }, { projection: { branchId: 1 } });
    if (!t || t.branchId !== branchId) throw new HttpError(400, 'La terminal no pertenece a la sucursal de la venta');
    const s = await col('cash_sessions').findOne({ terminalId, status: 'abierta' }, { projection: { _id: 1 } });
    return { sessionId: s?._id ?? null, terminalId };
  }
  const open = await col('cash_sessions').find({ branchId, status: 'abierta' }).limit(2).toArray();
  if (open.length > 1) throw new HttpError(409, 'Hay varias cajas abiertas en la sucursal: indica terminalId');
  return { sessionId: open[0]?._id ?? null, terminalId: open[0]?.terminalId ?? 'servidor' };
}

async function applyAdjustment(req: Request, adj: SaleAdjustment, authorization?: ActionAuthorization) {
  const user = sessionUser(req);
  const op: SyncOp = {
    opId: adj.id, type: 'sale.adjust', branchId: adj.branchId, terminalId: adj.terminalId, userId: user.id, localTs: adj.createdAt,
    payload: { adjustment: adj, ...(authorization ? { authorization } : {}) },
  };
  const r = await applySyncOp(repo, op, { now: () => new Date(), source: 'servidor' });
  if (r.status === 'rejected') throw rejectionToHttp(r.conflictKind, r.detail);
  return r;
}

const asHttp = (e: unknown) => (e instanceof AdjustmentError ? new HttpError(e.status, e.message) : e);

salesRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    const user = sessionUser(req);
    await preflight(req, res, 'ventas.cancelar');
    const body = parse(z.object({ id: uuid.optional(), reason: z.string().trim().min(3).max(200), terminalId: z.string().optional(), authorization: actionAuthorizationSchema.optional() }), req.body);
    const sale = await repo.getSale(req.params.id!);
    if (!sale) throw new HttpError(404, 'Venta no encontrada');
    assertBranch(user, sale.branchId);
    const priors = await repo.listAdjustmentsForSale(sale.id);
    const existing = body.id ? priors.find((a) => a.id === body.id) : undefined;
    if (existing) return void res.json({ ok: true, duplicate: true, adjustment: existing });
    const cash = await pickCashSession(sale.branchId, body.terminalId);
    let adj: SaleAdjustment;
    try {
      adj = buildCancellation(sale, priors, { id: body.id ?? newId(), userId: user.id, terminalId: cash.terminalId, reason: body.reason, now: new Date().toISOString(), cashSessionId: cash.sessionId });
    } catch (e) {
      throw asHttp(e);
    }
    const authorization = await authorizeOnline(req, { perm: 'ventas.cancelar', purpose: 'cancelacion', raw: body.authorization, branchId: sale.branchId });
    const r = await applyAdjustment(req, adj, authorization);
    res.status(r.status === 'duplicate' ? 200 : 201).json({ ok: true, duplicate: r.status === 'duplicate', adjustment: adj });
  }),
);

salesRouter.post(
  '/:id/return',
  ah(async (req, res) => {
    const user = sessionUser(req);
    await preflight(req, res, 'ventas.devolver');
    const body = parse(
      z.object({
        id: uuid.optional(),
        authorization: actionAuthorizationSchema.optional(),
        reason: z.string().trim().min(3).max(200),
        terminalId: z.string().optional(),
        items: z.array(z.object({ saleItemId: z.string().min(1).max(100), qty: z.number().int().positive(), restock: z.boolean() })).min(1).max(100),
        payments: z.array(z.object({ method: paymentMethodSchema, amountCents: z.number().int().positive() })).min(1).max(5),
      }),
      req.body,
    );
    const sale = await repo.getSale(req.params.id!);
    if (!sale) throw new HttpError(404, 'Venta no encontrada');
    assertBranch(user, sale.branchId);
    const priors = await repo.listAdjustmentsForSale(sale.id);
    // Un reintento con el mismo id de ajuste no debe validarse contra sí mismo.
    const existing = body.id ? priors.find((a) => a.id === body.id) : undefined;
    if (existing) return void res.json({ ok: true, duplicate: true, adjustment: existing });
    const cash = await pickCashSession(sale.branchId, body.terminalId);
    let adj: SaleAdjustment;
    try {
      adj = buildReturn(sale, priors, {
        id: body.id ?? newId(), userId: user.id, terminalId: cash.terminalId, reason: body.reason, now: new Date().toISOString(),
        cashSessionId: cash.sessionId, lines: body.items, payments: body.payments,
      });
    } catch (e) {
      throw asHttp(e);
    }
    const authorization = await authorizeOnline(req, { perm: 'ventas.devolver', purpose: 'devolucion', raw: body.authorization, branchId: sale.branchId });
    await applyAdjustment(req, adj, authorization);
    res.status(201).json({ ok: true, adjustment: adj });
  }),
);
