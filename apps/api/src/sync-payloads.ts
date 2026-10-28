/**
 * Forma esperada del `payload` de cada tipo de operación sincronizada.
 * El servidor valida TODO lo que llega de un dispositivo: un payload mal formado se rechaza.
 */
import { z } from 'zod';
import { isoDate, paymentMethodSchema } from '@amara/shared/schemas';

const id = z.string().min(1).max(100);
const cents = z.number().int().min(0).max(100_000_000_00);

const saleItem = z.object({
  id,
  variantId: id,
  productName: z.string().max(200),
  variantLabel: z.string().max(100),
  sku: z.string().max(60),
  code: z.string().max(60),
  qty: z.number().int().positive().max(100_000),
  unitPriceCents: cents,
  unitCostCents: cents,
  lineDiscountCents: cents,
  netCents: cents,
  // v2: por omisión 'producto'. Un 'extra' no mueve inventario ni cuenta como unidad vendida.
  kind: z.enum(['producto', 'extra']).optional(),
  extraNote: z.string().max(200).nullish(),
});

const paymentLine = z.object({
  method: paymentMethodSchema,
  amountCents: z.number().int().positive().max(100_000_000_00),
  tenderedCents: cents.optional(),
  changeCents: cents.optional(),
});

export const saleSchema = z.object({
  id,
  folio: z.string().min(1).max(60),
  branchId: id,
  terminalId: id,
  userId: id,
  userName: z.string().max(100),
  cashSessionId: id.nullable(),
  createdAt: isoDate,
  subtotalCents: cents,
  discountCents: cents,
  totalCents: cents,
  tenderedCents: cents,
  changeCents: cents,
  status: z.enum(['completada', 'cancelada']),
  items: z.array(saleItem).min(1).max(300),
  payments: z.array(paymentLine).min(1).max(10),
  // v2: quién vendió (solo en sistema) y tipo de venta ('limpia' = Limpias).
  sellerId: id.nullish(),
  sellerName: z.string().max(100).nullish(),
  type: z.enum(['venta', 'limpia']).optional(),
});
/**
 * `authorization` se deja como `unknown` a propósito: su validez se juzga en `checkAuthorization`
 * (una autorización mal formada de una operación ya ocurrida es un CONFLICTO, no un rechazo del payload).
 */
export const saleCreatePayload = z.object({ sale: saleSchema, authorization: z.unknown().optional() });

export const adjustmentSchema = z.object({
  id,
  saleId: id,
  branchId: id,
  terminalId: id,
  userId: id,
  type: z.enum(['cancelacion', 'devolucion']),
  createdAt: isoDate,
  reason: z.string().min(1).max(300),
  amountCents: cents,
  payments: z.array(z.object({ method: paymentMethodSchema, amountCents: cents })).min(1).max(10),
  items: z
    .array(
      z.object({
        saleItemId: id,
        variantId: id,
        productName: z.string().max(200),
        variantLabel: z.string().max(100),
        qty: z.number().int().positive().max(100_000),
        unitCostCents: cents,
        netCents: cents,
        restock: z.boolean(),
        kind: z.enum(['producto', 'extra']).optional(),
      }),
    )
    .min(1)
    .max(300),
  cashSessionId: id.nullable(),
});
export const saleAdjustPayload = z.object({ adjustment: adjustmentSchema, authorization: z.unknown().optional() });

export const stockMovementPayload = z.object({
  movement: z.object({
    id,
    variantId: id,
    branchId: id,
    type: z.enum(['entrada', 'salida', 'ajuste', 'conteo']),
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    reason: z.string().trim().min(3).max(200),
    location: z.string().max(60).nullable().optional(),
    // grantId/authorizedBy que mande el dispositivo se IGNORAN: el servidor los determina.
    grantId: z.string().nullable().optional(),
    authorizedBy: z.string().nullable().optional(),
    countedQty: z.number().int().nullable().optional(),
    expectedQty: z.number().int().nullable().optional(),
  }),
});

export const cashOpenPayload = z.object({
  session: z.object({ id, branchId: id, terminalId: id, openedBy: id, openedAt: isoDate, openingCents: cents }),
});

export const cashMovementPayload = z.object({
  movement: z.object({
    id,
    sessionId: id,
    type: z.enum(['entrada', 'retiro', 'gasto']),
    amountCents: z.number().int().positive().max(100_000_000_00),
    concept: z.string().trim().min(3).max(200),
    userId: id,
    createdAt: isoDate,
  }),
});

export const cashClosePayload = z.object({
  sessionId: id,
  closedBy: id,
  closedAt: isoDate,
  countedCents: cents,
  expectedCents: z.number().int().optional(),
  provisional: z.boolean().optional(),
  denominations: z.record(z.string(), z.number().int().min(0)).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  // v2: quién autorizó el cierre (vendedor: obligatoria). Se valida aparte; ver `checkAuthorization`.
  authorization: z.unknown().optional(),
  // `breakdown` y `differenceCents` del dispositivo se ignoran: el servidor recalcula.
});

export type SalePayload = z.infer<typeof saleSchema>;
export type AdjustmentPayload = z.infer<typeof adjustmentSchema>;
