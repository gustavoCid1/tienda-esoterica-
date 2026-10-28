/** Conversión de documentos de MongoDB a las formas públicas del contrato (sin hashes ni campos internos). */
import type { Sale, SaleAdjustment, TodaySaleSummary } from '@amara/shared';

type Doc = Record<string, any>;

/** Usuario público: NUNCA incluye el hash ni contadores de bloqueo. */
export function publicUser(u: Doc) {
  return {
    id: u._id as string,
    username: u.username as string,
    name: u.name as string,
    role: u.role,
    branchIds: (u.branchIds ?? []) as string[],
    active: !!u.active,
    createdAt: u.createdAt ?? null,
    updatedAt: u.updatedAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

export function toProduct(p: Doc, opts: { photo?: boolean } = { photo: true }) {
  return {
    id: p._id as string,
    name: p.name,
    type: p.type,
    category: p.category,
    description: p.description ?? null,
    brand: p.brand ?? null,
    sku: p.sku,
    photo: opts.photo === false ? undefined : (p.photo ?? null),
    specs: p.specs ?? {},
    notes: p.notes ?? null,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toVariant(v: Doc, withCost: boolean) {
  return {
    id: v._id as string,
    productId: v.productId,
    label: v.label,
    unit: v.unit,
    barcode: v.barcode ?? null,
    internalCode: v.internalCode,
    qrValue: v.qrValue,
    ...(withCost ? { costCents: v.costCents } : {}),
    priceCents: v.priceCents,
    minStock: v.minStock ?? 0,
    location: v.location ?? null,
    status: v.status,
    updatedAt: v.updatedAt,
  };
}

/** Venta sin costos (para vendedores): la utilidad no debe poder deducirse de lo que ven. */
export function saleView(s: Doc, withCost: boolean): Doc {
  const { _id, receivedAt, syncOpId, source, ...rest } = s;
  const sale = { id: _id, ...rest } as Sale & Doc;
  if (withCost) return sale;
  return { ...sale, items: sale.items.map(({ unitCostCents: _c, ...it }) => it) };
}

export function adjustmentView(a: Doc, withCost: boolean): Doc {
  const { _id, receivedAt, syncOpId, source, ...rest } = a;
  const adj = { id: _id, ...rest } as SaleAdjustment & Doc;
  if (withCost) return adj;
  return { ...adj, items: adj.items.map(({ unitCostCents: _c, ...it }) => it) };
}

/** v2. Ticket de hoy para el resumen del gerente: SOLO lo vendido, cantidades y precios (sin costos, pagos ni ticket impreso). */
export function toTodaySaleSummary(s: Doc): TodaySaleSummary {
  return {
    saleId: s._id ?? s.id,
    folio: s.folio,
    createdAt: s.createdAt,
    status: s.status,
    type: s.type === 'limpia' ? 'limpia' : 'venta',
    sellerId: s.sellerId ?? s.userId ?? null,
    sellerName: s.sellerName ?? s.userName ?? null,
    totalCents: s.totalCents,
    items: (s.items ?? []).map((i: Doc) => ({
      name: i.productName, label: i.variantLabel, qty: i.qty, unitPriceCents: i.unitPriceCents, netCents: i.netCents,
      kind: i.kind === 'extra' ? 'extra' : 'producto', extraNote: i.extraNote ?? null,
    })),
  };
}
