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
  /** v2: si se omite, el servidor genera el siguiente código libre (P1, P2… / M1, M2…). */
  code: z.string().trim().min(1).max(3).regex(/^[A-Z0-9]+$/).optional(),
  /** v2: si se omite, el servidor arma un nombre con el tipo y la persona. */
  name: z.string().trim().min(2).max(60).optional(),
  branchId: uuid,
  kind: z.enum(['escritorio', 'movil']),
  /** v2: para quién es la terminal (nombre de la persona). */
  assignedTo: z.string().trim().min(1).max(80).optional(),
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

/** v2. Quién autorizó una acción sensible. Nunca lleva contraseña ni código. */
export const actionAuthorizationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('admin_password'), adminUserId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('token'), tokenId: z.string().min(1).max(100) }),
]);

export const tokenPurposeSchema = z.enum(['cierre_caja', 'devolucion', 'cancelacion', 'limpias']);

/** v2. POST /security/tokens */
export const securityTokenCreateSchema = z.object({
  label: z.string().trim().min(2).max(80),
  purposes: z.array(tokenPurposeSchema).min(1).max(4),
  /** 1 minuto a 7 días. El administrador la elige en minutos u horas (la interfaz convierte a minutos). */
  durationMinutes: z.number().int().min(1).max(7 * 24 * 60),
  branchId: uuid.nullish(),
  forUserId: uuid.nullish(),
  maxUses: z.number().int().min(1).max(10_000).nullish(),
  /** Longitud del código: 6 a 10 caracteres (por omisión 8). */
  length: z.number().int().min(6).max(10).optional(),
});

/**
 * v2. POST /security/verify. Con `code` se valida un token; con `adminPassword` (+ `adminUserId` o
 * `adminUsername`) se valida la contraseña de un gerente activo. La contraseña/código solo viajan aquí.
 */
export const securityVerifySchema = z
  .object({
    code: z.string().trim().min(1).max(40).optional(),
    adminUserId: z.string().min(1).max(100).optional(),
    adminUsername: z.string().trim().min(1).max(60).optional(),
    adminPassword: z.string().min(1).max(200).optional(),
    purpose: tokenPurposeSchema,
    branchId: z.string().min(1).max(100),
  })
  .refine((v) => (v.code ? !v.adminPassword : !!v.adminPassword), { message: 'Envía el código del token o la contraseña de un gerente (solo uno)' });

/** v2. PUT /settings/extra-categories */
export const extraCategoriesSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(60)).max(60),
});

export const cashCloseSchema = z.object({
  countedCents: cents,
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
  notes: z.string().max(300).optional(),
  /** v2. Obligatoria para el vendedor; el gerente que inicia sesión no la necesita. */
  authorization: actionAuthorizationSchema.optional(),
});
