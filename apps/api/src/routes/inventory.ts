/** /inventory: tabla de existencias, movimientos, transferencias y conciliación. */
import { Router } from 'express';
import { z } from 'zod';
import { can, newId } from '@amara/shared';
import type { SyncOp } from '@amara/shared';
import { stockMovementSchema, transferSchema } from '@amara/shared/schemas';
import { audit } from '../audit.ts';
import { assertBranch, branchScope, requirePerm } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import { applySyncOp, replayStuck } from '../sync-apply.ts';
import { createMongoSyncRepo } from '../sync-repo.ts';
import { movementDelta, reconcileStock, recordMovement, StockInputError, getStockQty } from '../stock.ts';
import { stockState } from '../stats.ts';
import { canSeeCosts, dayStr, escapeRegex, isoRangeFilter, dayRangeIso, pageQuery, rejectionToHttp, sessionUser } from '../util.ts';

export const inventoryRouter = Router();
const repo = createMongoSyncRepo();

const bool = z.union([z.boolean(), z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true')]);

/** Tabla principal: una fila por variante y sucursal. */
inventoryRouter.get(
  '/',
  requirePerm('inventario.ver'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(
      z.object({ branchId: z.string().optional(), q: z.string().trim().max(100).optional(), low: bool.optional(), out: bool.optional() }).merge(pageQuery(50, 200)),
      req.query,
    );
    const scope = branchScope(user, q.branchId);
    if (scope.length === 0) return void res.json({ total: 0, items: [] });

    const vFilter: Record<string, unknown> = { status: 'activo' };
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      const prods = await col('products').find({ $or: [{ name: rx }, { sku: rx }, { brand: rx }, { category: rx }] }).project({ _id: 1 }).toArray();
      vFilter.$or = [{ productId: { $in: prods.map((p) => p._id) } }, { barcode: rx }, { internalCode: rx }, { label: rx }];
    }
    const variants = await col('variants').find(vFilter).limit(5000).toArray();
    const products = await col('products')
      .find({ _id: { $in: [...new Set(variants.map((v) => v.productId))] }, status: 'activo' })
      .project({ photo: 0 })
      .toArray();
    const pMap = new Map(products.map((p) => [p._id as string, p]));
    const stockRows = await col('stock').find({ branchId: { $in: scope }, variantId: { $in: variants.map((v) => v._id) } }).toArray();
    const sMap = new Map(stockRows.map((s) => [`${s.variantId}|${s.branchId}`, s]));
    const branches = await col('branches').find({ _id: { $in: scope } }).toArray();
    const withCost = canSeeCosts(user.role);

    const rows: Record<string, any>[] = [];
    for (const v of variants) {
      const p = pMap.get(v.productId);
      if (!p) continue;
      for (const b of branches) {
        const s = sMap.get(`${v._id}|${b._id}`);
        const qty = Number(s?.qty ?? 0);
        const state = stockState(qty, v.minStock ?? 0);
        if (q.out && state !== 'agotado') continue;
        if (q.low && state !== 'bajo') continue;
        rows.push({
          productId: p._id, variantId: v._id, productName: p.name, category: p.category, type: p.type, label: v.label, sku: p.sku,
          code: v.barcode ?? v.internalCode, barcode: v.barcode ?? null, internalCode: v.internalCode, branchId: b._id, branchName: b.name,
          location: s?.location ?? v.location ?? null, qty, ...(withCost ? { costCents: v.costCents } : {}), priceCents: v.priceCents,
          minStock: v.minStock ?? 0, state, status: v.status,
        });
      }
    }
    rows.sort((a, b) => a.productName.localeCompare(b.productName, 'es') || a.label.localeCompare(b.label, 'es') || a.branchName.localeCompare(b.branchName, 'es'));
    const page = rows.slice(q.offset, q.offset + q.limit);
    // Las fotos pesan: solo se leen para los productos de la página.
    const photos = await col('products').find({ _id: { $in: [...new Set(page.map((r) => r.productId))] } }).project({ photo: 1 }).toArray();
    const photoMap = new Map(photos.map((p) => [p._id as string, p.photo ?? null]));
    res.json({ total: rows.length, items: page.map((r) => ({ ...r, photo: photoMap.get(r.productId) ?? null })) });
  }),
);

/**
 * Entrada/salida/ajuste/conteo en línea. Pasa por la MISMA lógica que la sincronización (applySyncOp):
 * rol y permiso temporal se leen del servidor y el movimiento queda registrado con grantId/authorizedBy.
 */
inventoryRouter.post(
  '/movements',
  ah(async (req, res) => {
    const user = sessionUser(req);
    const body = parse(stockMovementSchema, req.body);
    assertBranch(user, body.branchId);
    // Gerente: cualquier movimiento. Vendedor: SOLO entradas y únicamente con permiso temporal vigente (se valida abajo).
    const mayTry = can(user.role, 'inventario.mover') || (user.role === 'vendedor' && body.type === 'entrada');
    if (!mayTry) throw new HttpError(403, 'No tienes permiso para esta acción');

    const current = await getStockQty(body.variantId, body.branchId);
    // Reintento del mismo movimiento (misma id): ya se aplicó, no se vuelve a validar contra la existencia actual.
    const dupe = await col('inventory_movements').findOne({ _id: body.id }, { projection: { delta: 1 } });
    if (dupe) return void res.json({ ok: true, duplicate: true, delta: dupe.delta, qty: current });
    let delta: number;
    try {
      delta = movementDelta(body.type, body.qty, current);
    } catch (e) {
      if (e instanceof StockInputError) throw new HttpError(400, e.message);
      throw e;
    }
    // Un movimiento manual NO es una venta ya ocurrida: no puede dejar existencia negativa.
    if (current + delta < 0) throw new HttpError(409, `Existencia insuficiente (hay ${current})`);

    const now = new Date();
    const op: SyncOp = {
      opId: newId(), type: 'stock.movement', branchId: body.branchId, terminalId: 'servidor', userId: user.id, localTs: now.toISOString(),
      payload: { movement: { id: body.id, variantId: body.variantId, branchId: body.branchId, type: body.type, delta, reason: body.reason, location: body.location ?? null, countedQty: body.type === 'conteo' ? body.qty : null, expectedQty: body.type === 'conteo' ? current : null } },
    };
    const r = await applySyncOp(repo, op, { now: () => new Date(), source: 'servidor' });
    if (r.status === 'rejected') throw rejectionToHttp(r.conflictKind, r.detail);
    res.status(201).json({ ok: true, delta, qty: await getStockQty(body.variantId, body.branchId), ...(r.status === 'conflict' ? { warning: r.detail } : {}) });
  }),
);

/** Transferencia entre sucursales: salida + entrada, NO es venta ni afecta reportes de ventas. */
inventoryRouter.post(
  '/transfers',
  requirePerm('transferencias.crear'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const body = parse(transferSchema, req.body);
    if (body.fromBranchId === body.toBranchId) throw new HttpError(400, 'La sucursal de origen y destino deben ser distintas');
    assertBranch(user, body.fromBranchId);
    assertBranch(user, body.toBranchId);
    const existing = await col('transfers').findOne({ _id: body.id });
    if (existing) return void res.json({ ok: true, duplicate: true, id: body.id });

    const branches = await col('branches').find({ _id: { $in: [body.fromBranchId, body.toBranchId] } }).project({ _id: 1 }).toArray();
    if (branches.length !== 2) throw new HttpError(400, 'Sucursal inexistente');
    const wanted = new Map<string, number>();
    for (const it of body.items) wanted.set(it.variantId, (wanted.get(it.variantId) ?? 0) + it.qty);
    for (const [variantId, qty] of wanted) {
      if (!(await col('variants').findOne({ _id: variantId, status: 'activo' }, { projection: { _id: 1 } }))) throw new HttpError(404, 'Producto no encontrado o archivado');
      const have = await getStockQty(variantId, body.fromBranchId);
      if (have < qty) throw new HttpError(409, `Existencia insuficiente en el origen (hay ${have}, se piden ${qty})`);
    }
    const now = new Date().toISOString();
    // Primero el documento (único por id): un reintento concurrente no duplica movimientos.
    try {
      await col('transfers').insertOne({ _id: body.id, id: body.id, fromBranchId: body.fromBranchId, toBranchId: body.toBranchId, items: body.items, note: body.note ?? null, userId: user.id, createdAt: now });
    } catch (e) {
      if ((e as { code?: number })?.code === 11000) return void res.json({ ok: true, duplicate: true, id: body.id });
      throw e;
    }
    for (const [i, it] of body.items.entries()) {
      const base = { variantId: it.variantId, refType: 'transfer', refId: body.id, userId: user.id, authorizedBy: null, grantId: null, location: null, createdAt: now, opId: null };
      await recordMovement({ ...base, id: `${body.id}:out${i}`, branchId: body.fromBranchId, delta: -it.qty, type: 'transferencia_salida', reason: `Transferencia a ${body.toBranchId}` });
      await recordMovement({ ...base, id: `${body.id}:in${i}`, branchId: body.toBranchId, delta: it.qty, type: 'transferencia_entrada', reason: `Transferencia desde ${body.fromBranchId}` });
    }
    await audit({ userId: user.id, action: 'inventario.transferencia', entity: 'transfer', entityId: body.id, at: now, detail: { from: body.fromBranchId, to: body.toBranchId, items: body.items, note: body.note ?? null } });
    res.status(201).json({ ok: true, id: body.id });
  }),
);

inventoryRouter.get(
  '/movements',
  requirePerm('inventario.ver'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(
      z.object({ variantId: z.string().optional(), branchId: z.string().optional(), from: dayStr.optional(), to: dayStr.optional() }).merge(pageQuery(100, 500)),
      req.query,
    );
    const scope = branchScope(user, q.branchId);
    const range = dayRangeIso(q.from, q.to);
    const filter: Record<string, unknown> = { branchId: { $in: scope }, ...isoRangeFilter('createdAt', range.from, range.to) };
    if (q.variantId) filter.variantId = q.variantId;
    const [total, items] = await Promise.all([
      col('inventory_movements').countDocuments(filter),
      col('inventory_movements').find(filter).sort({ createdAt: -1 }).skip(q.offset).limit(q.limit).toArray(),
    ]);
    res.json({ total, items: items.map(({ _id, opId, ...m }) => ({ ...m, id: _id })) });
  }),
);

/** Recalcula existencias desde movimientos y reprocesa eventos de sincronización que quedaron a medias. */
inventoryRouter.post(
  '/reconcile',
  requirePerm('sync.conflictos'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional(), dryRun: bool.optional() }), { ...req.query, ...(typeof req.body === 'object' && req.body ? req.body : {}) });
    const scope = branchScope(user, q.branchId);
    // Primero se terminan las operaciones abandonadas (sus movimientos faltantes), luego se concilia.
    const replay = q.dryRun ? { replayed: 0, failed: 0 } : await replayStuck(repo, { now: () => new Date(), source: 'servidor' });
    const result = await reconcileStock({ branchIds: scope, dryRun: !!q.dryRun });
    if (!q.dryRun) {
      await audit({
        userId: user.id, action: 'inventario.reconciliar', entity: 'stock', detail: { branches: scope, drifts: result.drifts.slice(0, 200), fixed: result.fixed, skipped: result.skipped, replay },
      });
    }
    res.json({ ...result, replay, dryRun: !!q.dryRun });
  }),
);
