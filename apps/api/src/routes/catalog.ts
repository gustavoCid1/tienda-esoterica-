/** /catalog: productos, variantes, códigos y paquete de catálogo. */
import { Router } from 'express';
import { z } from 'zod';
import { buildInternalCode, buildQrValue, can, newId, parseQrValue } from '@amara/shared';
import { productCreateSchema, productSchema, variantSchema } from '@amara/shared/schemas';
import { audit } from '../audit.ts';
import { assertBranch, branchScope, requirePerm, requireReauth } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import { buildPullPayload } from '../pull.ts';
import { toProduct, toVariant } from '../serialize.ts';
import { recordMovement } from '../stock.ts';
import { canSeeCosts, compact, escapeRegex, pageQuery, runMw, sessionUser } from '../util.ts';

export const catalogRouter = Router();

const sinceSchema = z.string().datetime().optional();

/** Catálogo incremental + existencias: el mismo paquete que /sync/pull, para clientes con sesión de usuario. */
catalogRouter.get(
  '/pull',
  requirePerm('productos.ver'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional(), since: sinceSchema }), req.query);
    res.json(await buildPullPayload(branchScope(user, q.branchId), q.since));
  }),
);

/** Productos que coinciden con el texto en producto o en alguna variante (código, etiqueta). */
async function productIdsMatching(q: string): Promise<string[]> {
  const rx = new RegExp(escapeRegex(q), 'i');
  const [byProduct, byVariant] = await Promise.all([
    col('products').find({ $or: [{ name: rx }, { sku: rx }, { brand: rx }, { category: rx }, { type: rx }] }).project({ _id: 1 }).toArray(),
    col('variants').find({ $or: [{ barcode: rx }, { internalCode: rx }, { label: rx }] }).project({ productId: 1 }).toArray(),
  ]);
  return [...new Set([...byProduct.map((p) => p._id as string), ...byVariant.map((v) => v.productId as string)])];
}

catalogRouter.get(
  '/products',
  requirePerm('productos.ver'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(
      z.object({ q: z.string().trim().max(100).optional(), category: z.string().max(60).optional(), status: z.enum(['activo', 'archivado', 'todos']).default('activo') }).merge(pageQuery(50, 200)),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.status !== 'todos') filter.status = q.status;
    if (q.category) filter.category = q.category;
    if (q.q) filter._id = { $in: await productIdsMatching(q.q) };
    const [total, products] = await Promise.all([
      col('products').countDocuments(filter),
      col('products').find(filter).sort({ name: 1 }).skip(q.offset).limit(q.limit).toArray(),
    ]);
    const variants = await col('variants').find({ productId: { $in: products.map((p) => p._id) } }).sort({ label: 1 }).toArray();
    const withCost = canSeeCosts(user.role);
    res.json({
      total,
      items: products.map((p) => ({ ...toProduct(p), variants: variants.filter((v) => v.productId === p._id).map((v) => toVariant(v, withCost)) })),
    });
  }),
);

/** Reserva `n` códigos internos consecutivos con un contador atómico. Devuelve el primero. */
async function reserveInternalCodes(n: number): Promise<number> {
  const doc = await col('counters').findOneAndUpdate({ _id: 'internal_code' }, { $inc: { value: n } }, { upsert: true, returnDocument: 'after' });
  return Number(doc?.value ?? n) - n + 1;
}

async function assertBarcodesFree(barcodes: string[], exceptProductId?: string, exceptVariantId?: string) {
  if (barcodes.length === 0) return;
  if (new Set(barcodes).size !== barcodes.length) throw new HttpError(409, 'Hay códigos de barras repetidos en la misma captura');
  const filter: Record<string, unknown> = { barcode: { $in: barcodes } };
  if (exceptVariantId) filter._id = { $ne: exceptVariantId };
  if (exceptProductId) filter.productId = { $ne: exceptProductId };
  const dup = await col('variants').findOne(filter, { projection: { barcode: 1 } });
  if (dup) throw new HttpError(409, `El código de barras ${dup.barcode} ya existe en otro producto`);
}

catalogRouter.post(
  '/products',
  requirePerm('productos.editar'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const body = parse(productCreateSchema, req.body);
    // Validaciones previas (también las respalda el índice único).
    if (await col('products').findOne({ sku: body.product.sku }, { projection: { _id: 1 } })) throw new HttpError(409, `El SKU ${body.product.sku} ya existe`);
    await assertBarcodesFree(body.variants.map((v) => v.barcode).filter((b): b is string => !!b));
    for (const s of body.initialStock) {
      if (s.variantIndex >= body.variants.length) throw new HttpError(400, 'initialStock: variante inexistente');
      assertBranch(user, s.branchId);
      if (!(await col('branches').findOne({ _id: s.branchId }, { projection: { _id: 1 } }))) throw new HttpError(400, 'initialStock: sucursal inexistente');
    }

    const now = new Date().toISOString();
    const productId = newId();
    const firstSeq = await reserveInternalCodes(body.variants.length);
    const variantDocs = body.variants.map((v, i) => {
      const id = newId();
      return compact({
        _id: id, id, productId, label: v.label, unit: v.unit, barcode: v.barcode || undefined, internalCode: buildInternalCode(firstSeq + i),
        qrValue: buildQrValue(id), costCents: v.costCents, priceCents: v.priceCents, minStock: v.minStock, location: v.location || undefined,
        status: 'activo', createdAt: now, updatedAt: now,
      });
    });
    const productDoc = compact({ _id: productId, id: productId, ...body.product, status: 'activo', createdAt: now, updatedAt: now, createdBy: user.id });
    try {
      await col('products').insertOne(productDoc);
      await col('variants').insertMany(variantDocs);
    } catch (e) {
      // Recién creados y sin historial: se retiran para no dejar un producto a medias.
      await col('variants').deleteMany({ productId }).catch(() => undefined);
      await col('products').deleteOne({ _id: productId }).catch(() => undefined);
      if ((e as { code?: number })?.code === 11000) throw new HttpError(409, 'SKU o código de barras duplicado');
      throw e;
    }
    // La existencia inicial SIEMPRE entra como movimiento (así reconcile y el historial cuadran).
    for (const [i, s] of body.initialStock.entries()) {
      if (s.qty === 0) continue;
      const v = variantDocs[s.variantIndex]!;
      await recordMovement({
        id: `${productId}:init${i}`, variantId: v._id as string, branchId: s.branchId, delta: s.qty, type: 'entrada', reason: 'Existencia inicial',
        refType: 'product', refId: productId, userId: user.id, authorizedBy: null, grantId: null, location: s.location ?? null, createdAt: now, opId: null,
      });
    }
    await audit({ userId: user.id, action: 'producto.crear', entity: 'product', entityId: productId, detail: { name: body.product.name, sku: body.product.sku, variants: variantDocs.map((v) => ({ id: v._id, label: v.label, priceCents: v.priceCents, costCents: v.costCents })) } });
    res.status(201).json({ product: toProduct(productDoc), variants: variantDocs.map((v) => toVariant(v, canSeeCosts(user.role))) });
  }),
);

const productPatchSchema = productSchema.partial();

catalogRouter.patch(
  '/products/:id',
  requirePerm('productos.editar'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const id = req.params.id!;
    const patch = parse(productPatchSchema, req.body);
    const cur = await col('products').findOne({ _id: id });
    if (!cur) throw new HttpError(404, 'Producto no encontrado');
    if (patch.sku && patch.sku !== cur.sku && (await col('products').findOne({ sku: patch.sku }, { projection: { _id: 1 } }))) {
      throw new HttpError(409, `El SKU ${patch.sku} ya existe`);
    }
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || JSON.stringify(v) === JSON.stringify(cur[k])) continue;
      set[k] = v;
      // La foto es muy grande para la auditoría: solo se anota que cambió.
      changes[k] = k === 'photo' ? { old: !!cur.photo, new: true } : { old: cur[k] ?? null, new: v };
    }
    if (Object.keys(set).length === 0) return void res.json({ product: toProduct(cur), unchanged: true });
    set.updatedAt = new Date().toISOString();
    await col('products').updateOne({ _id: id }, { $set: set });
    await audit({ userId: user.id, action: 'producto.editar', entity: 'product', entityId: id, detail: { changes } });
    res.json({ product: toProduct({ ...cur, ...set }) });
  }),
);

const variantPatchSchema = variantSchema.partial();

catalogRouter.patch(
  '/variants/:id',
  requirePerm('productos.editar'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const id = req.params.id!;
    const patch = parse(variantPatchSchema, req.body);
    const cur = await col('variants').findOne({ _id: id });
    if (!cur) throw new HttpError(404, 'Variante no encontrada');

    const priceChanged = patch.priceCents !== undefined && patch.priceCents !== cur.priceCents;
    const costChanged = patch.costCents !== undefined && patch.costCents !== cur.costCents;
    if (priceChanged || costChanged) {
      // Precios y costos: permiso propio + contraseña reciente (x-reauth).
      if (!can(user.role, 'precios.editar')) throw new HttpError(403, 'No tienes permiso para cambiar precios');
      await runMw(requireReauth, req, res);
    }
    if (patch.barcode) await assertBarcodesFree([patch.barcode], undefined, id);

    const set: Record<string, unknown> = {};
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const value = (k === 'barcode' || k === 'location') && v === '' ? null : v;
      if (value === (cur[k] ?? null)) continue;
      set[k] = value;
      changes[k] = { old: cur[k] ?? null, new: value };
    }
    if (Object.keys(set).length === 0) return void res.json({ variant: toVariant(cur, canSeeCosts(user.role)), unchanged: true });
    const now = new Date().toISOString();
    set.updatedAt = now;
    await col('variants').updateOne({ _id: id }, { $set: set });

    // TODA modificación de precio o costo se audita con valor anterior y nuevo, campo por campo.
    for (const field of ['priceCents', 'costCents'] as const) {
      const c = changes[field];
      if (c) {
        await audit({
          userId: user.id, action: field === 'priceCents' ? 'precio.cambio' : 'costo.cambio', entity: 'variant', entityId: id, at: now,
          detail: { field, old: c.old, new: c.new, productId: cur.productId, label: cur.label },
        });
      }
    }
    const other = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'priceCents' && k !== 'costCents'));
    if (Object.keys(other).length) await audit({ userId: user.id, action: 'variante.editar', entity: 'variant', entityId: id, at: now, detail: { changes: other } });
    res.json({ variant: toVariant({ ...cur, ...set }, canSeeCosts(user.role)) });
  }),
);

/** Archivar/restaurar: nunca se borra un producto con historial. Las variantes siguen el estado del producto. */
async function setProductStatus(id: string, status: 'activo' | 'archivado', userId: string) {
  const cur = await col('products').findOne({ _id: id }, { projection: { status: 1, name: 1 } });
  if (!cur) throw new HttpError(404, 'Producto no encontrado');
  if (cur.status === status) return { unchanged: true };
  const now = new Date().toISOString();
  await col('products').updateOne({ _id: id }, { $set: { status, updatedAt: now } });
  await col('variants').updateMany({ productId: id }, { $set: { status, updatedAt: now } });
  await audit({ userId, action: status === 'archivado' ? 'producto.archivar' : 'producto.restaurar', entity: 'product', entityId: id, at: now, detail: { name: cur.name } });
  return { unchanged: false };
}

catalogRouter.post('/products/:id/archive', requirePerm('productos.editar'), ah(async (req, res) => {
  res.json({ ok: true, ...(await setProductStatus(req.params.id!, 'archivado', sessionUser(req).id)) });
}));
catalogRouter.post('/products/:id/restore', requirePerm('productos.editar'), ah(async (req, res) => {
  res.json({ ok: true, ...(await setProductStatus(req.params.id!, 'activo', sessionUser(req).id)) });
}));

/** Busca por código de barras, código interno o QR (amara:v1:<uuid>). Incluye existencia en las sucursales visibles. */
catalogRouter.get(
  '/lookup',
  requirePerm('productos.ver'),
  ah(async (req, res) => {
    const user = sessionUser(req);
    const q = parse(z.object({ code: z.string().trim().min(1).max(200), branchId: z.string().optional() }), req.query);
    const qrId = parseQrValue(q.code);
    const variant = await col('variants').findOne(
      qrId ? { _id: qrId } : { $or: [{ barcode: q.code }, { internalCode: q.code.toUpperCase() }] },
    );
    if (!variant) throw new HttpError(404, 'Producto no encontrado');
    const product = await col('products').findOne({ _id: variant.productId });
    if (!product) throw new HttpError(404, 'Producto no encontrado');
    const scope = branchScope(user, q.branchId);
    const stock = await col('stock').find({ variantId: variant._id, branchId: { $in: scope } }).toArray();
    res.json({
      hit: {
        variantId: variant._id, productId: product._id, productName: product.name, category: product.category, type: product.type,
        label: variant.label, unit: variant.unit, sku: product.sku, barcode: variant.barcode ?? null, internalCode: variant.internalCode,
        qrValue: variant.qrValue, ...(canSeeCosts(user.role) ? { costCents: variant.costCents } : {}), priceCents: variant.priceCents,
        minStock: variant.minStock ?? 0, location: variant.location ?? null, photo: product.photo ?? null,
        status: product.status === 'activo' ? variant.status : 'archivado',
        qty: stock.reduce((a, s) => a + Number(s.qty ?? 0), 0),
        stockByBranch: stock.map((s) => ({ branchId: s.branchId, qty: Number(s.qty ?? 0) })),
      },
    });
  }),
);

catalogRouter.get(
  '/codes/check',
  requirePerm('productos.editar'),
  ah(async (req, res) => {
    const q = parse(z.object({ code: z.string().trim().min(1).max(100) }), req.query);
    const dup = await col('variants').findOne({ $or: [{ barcode: q.code }, { internalCode: q.code.toUpperCase() }] }, { projection: { _id: 1 } });
    res.json({ duplicate: !!dup });
  }),
);

catalogRouter.post(
  '/codes/next',
  requirePerm('productos.editar'),
  ah(async (_req, res) => {
    const seq = await reserveInternalCodes(1);
    res.json({ code: buildInternalCode(seq) });
  }),
);
