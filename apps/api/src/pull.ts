/** Construcción del PullPayload (catálogo incremental + existencias completas de las sucursales autorizadas). */
import type { PullPayload } from '@amara/database';
import { col } from './db.ts';

export async function buildPullPayload(branchIds: string[], since?: string): Promise<PullPayload> {
  // La hora se toma ANTES de leer: lo que cambie durante la lectura se vuelve a traer en el siguiente pull.
  const serverTime = new Date().toISOString();
  const incremental = since ? { updatedAt: { $gte: since } } : {};
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [branches, products, variants, stock, users, grants] = await Promise.all([
    col('branches').find({ _id: { $in: branchIds } }).toArray(),
    col('products').find(incremental).toArray(),
    col('variants').find(incremental).toArray(),
    col('stock').find({ branchId: { $in: branchIds } }).toArray(),
    // Solo roles del punto de venta; sin hashes (se piden campos explícitos).
    col('users')
      .find({ branchIds: { $in: branchIds }, role: { $in: ['gerente', 'vendedor'] } })
      .project({ username: 1, name: 1, role: 1, branchIds: 1, active: 1 })
      .toArray(),
    col('grants').find({ branchId: { $in: branchIds }, expiresAt: { $gt: dayAgo } }).toArray(),
  ]);

  return {
    serverTime,
    branches: branches.map((b) => ({ id: b._id, code: b.code, name: b.name, status: b.status ?? 'activa', locations: b.locations ?? [] })),
    products: products.map((p) => ({
      id: p._id, name: p.name, type: p.type, category: p.category, description: p.description ?? null, brand: p.brand ?? null,
      sku: p.sku, photo: p.photo ?? null, specs: p.specs ?? {}, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt,
    })),
    variants: variants.map((v) => ({
      id: v._id, productId: v.productId, label: v.label, unit: v.unit, barcode: v.barcode ?? null, internalCode: v.internalCode,
      qrValue: v.qrValue, costCents: v.costCents, priceCents: v.priceCents, minStock: v.minStock ?? 0, location: v.location ?? null,
      status: v.status, updatedAt: v.updatedAt,
    })),
    stock: stock.map((s) => ({ variantId: s.variantId, branchId: s.branchId, qty: Number(s.qty ?? 0), location: s.location ?? null })),
    users: users.map((u) => ({ id: u._id, username: u.username, name: u.name, role: u.role, branchIds: u.branchIds ?? [], active: !!u.active })),
    grants: grants.map((g) => ({
      id: g._id, sellerId: g.sellerId, branchId: g.branchId, functions: g.functions ?? [], startsAt: g.startsAt, expiresAt: g.expiresAt,
      revokedAt: g.revokedAt ?? null, grantedBy: g.grantedBy,
    })),
  };
}
