/**
 * Validaciones Zod compartidas (API y formularios). No se ejecutan en las pruebas
 * del entorno de generación porque requieren instalar zod.
 */
import { z } from 'zod';

export const cents = z.number().int().min(0).max(100_000_000_00);
export const isoDate = z.string().datetime({ offset: false });
export const uuid = z.string().uuid();

export const roleSchema = z.enum(['gerente', 'vendedor', 'desarrollador']);
export const paymentMethodSchema = z.enum(['efectivo', 'tarjeta', 'transferencia', 'otro']);

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(1).max(200),
  terminalId: z.string().optional(),
});

export const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/i, 'Solo letras, números, punto, guion'),
  name: z.string().trim().min(2).max(80),
  role: roleSchema,
  password: z.string().min(8).max(200),
  branchIds: z.array(uuid).min(1),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: roleSchema.optional(),
  password: z.string().min(8).max(200).optional(),
  branchIds: z.array(uuid).min(1).optional(),
  active: z.boolean().optional(),
});

export const branchSchema = z.object({
  code: z.string().trim().min(1).max(4).regex(/^[A-Z0-9]+$/, 'Mayúsculas y números'),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).optional(),
  locations: z.array(z.string().trim().min(1).max(60)).default([]),
});

export const terminalSchema = z.object({
  code: z.string().trim().min(1).max(3).regex(/^[A-Z0-9]+$/),
  name: z.string().trim().min(2).max(60),
  branchId: uuid,
  kind: z.enum(['escritorio', 'movil']),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).optional(),
  brand: z.string().trim().max(80).optional(),
  sku: z.string().trim().min(1).max(40),
  photo: z.string().max(2_000_000).optional(), // data URL ya reducida por el cliente
  specs: z.record(z.string().max(60), z.string().max(300)).default({}),
  notes: z.string().trim().max(500).optional(),
});

export const variantSchema = z.object({
  label: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(20).default('pieza'),
  barcode: z.string().trim().max(40).optional(),
  costCents: cents,
  priceCents: cents,
  minStock: z.number().int().min(0).default(0),
  location: z.string().trim().max(60).optional(),
});

export const productCreateSchema = z.object({
  product: productSchema,
  variants: z.array(variantSchema).min(1),
  /** Existencia inicial por variante (índice) y sucursal. */
  initialStock: z
    .array(z.object({ variantIndex: z.number().int().min(0), branchId: uuid, qty: z.number().int().min(0), location: z.string().max(60).optional() }))
    .default([]),
});

export const stockMovementSchema = z.object({
  id: uuid,
  variantId: uuid,
  branchId: uuid,
  type: z.enum(['entrada', 'salida', 'ajuste', 'conteo']),
  /** entrada/salida: cantidad positiva. ajuste: con signo. conteo: cantidad contada. */
  qty: z.number().int(),
  reason: z.string().trim().min(3).max(200),
  location: z.string().max(60).optional(),
});

export const transferSchema = z.object({
  id: uuid,
  fromBranchId: uuid,
  toBranchId: uuid,
  items: z.array(z.object({ variantId: uuid, qty: z.number().int().positive() })).min(1),
  note: z.string().max(200).optional(),
});

export const grantCreateSchema = z.object({
  sellerId: uuid,
  branchId: uuid,
  functions: z.array(z.enum(['inventario.entrada'])).min(1),
  startsAt: isoDate,
  durationMinutes: z.number().int().min(5).max(24 * 60),
});

export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().optional(),
});

export const syncOpSchema = z.object({
  opId: uuid,
  type: z.enum(['sale.create', 'sale.adjust', 'stock.movement', 'cash.open', 'cash.movement', 'cash.close']),
  branchId: uuid,
  terminalId: z.string().min(1),
  userId: uuid,
  localTs: isoDate,
  payload: z.unknown(),
});

export const syncPushSchema = z.object({
  terminalId: z.string().min(1),
  ops: z.array(syncOpSchema).max(100),
});

export const cashCloseSchema = z.object({
  countedCents: cents,
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
  notes: z.string().max(300).optional(),
});
