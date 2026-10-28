/**
 * Tipos de la versión 2 (docs/CAMBIOS-v2.md, secciones 1 y 3).
 *
 * Los tipos compartidos nuevos del contrato todavía no existen en `packages/shared`, así que se
 * declaran aquí con los NOMBRES DEL CONTRATO. Cuando el paquete compartido los exporte, esta
 * archivo debería reemplazarse por reexportaciones. Todos los campos nuevos son opcionales: la
 * API actual puede no enviarlos y la web se comporta igual que en la versión 1.
 */
import type { Sale, SaleItem } from '@amara/shared';

/* ------------------------------------------------------------------ Ventas */

export type SaleType = 'venta' | 'limpia';

export type SaleItemKind = 'producto' | 'extra';

/** Línea de venta con los campos v2 (`kind` por omisión 'producto'). */
export type SaleItemV2 = SaleItem & {
  kind?: SaleItemKind;
  extraNote?: string | null;
};

/** Venta con los campos v2. Asignable a `Sale`, así que las pantallas viejas siguen sirviendo. */
export type SaleV2 = Omit<Sale, 'items'> & {
  items: SaleItemV2[];
  sellerId?: string | null;
  /** Empleado que vendió. SOLO en sistema: nunca se imprime en el ticket. */
  sellerName?: string | null;
  type?: SaleType;
};

/* ----------------------------------------------------------- Tokens de seguridad */

export type TokenPurpose = 'cierre_caja' | 'devolucion' | 'cancelacion' | 'limpias';

export interface SecurityToken {
  id: string;
  label: string;
  purposes: TokenPurpose[];
  /** null = cualquier sucursal del administrador. */
  branchId: string | null;
  /** Opcional: solo para ese usuario. */
  forUserId: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** null = ilimitado dentro de su vigencia. */
  maxUses: number | null;
  usedCount: number;
}

/** Fila de GET /security/tokens: el token con campos de ayuda opcionales que el servidor puede añadir. */
export type SecurityTokenRow = SecurityToken & {
  /** Estado calculado por el servidor, si lo envía. */
  status?: string;
  createdByName?: string | null;
  forUserName?: string | null;
};

/** Cuerpo de POST /security/tokens. */
export interface TokenCreateBody {
  label: string;
  purposes: TokenPurpose[];
  durationMinutes: number;
  branchId?: string;
  forUserId?: string;
  maxUses?: number;
  length?: number;
}

/** Respuesta de POST /security/tokens: el código viaja SOLO aquí. */
export interface TokenCreateResponse {
  id: string;
  code: string;
  expiresAt: string;
}

export type TokenStatus = 'vigente' | 'vencido' | 'revocado' | 'agotado';

/* ------------------------------------------------------------- Estadísticas v2 */

/** Fila de GET /stats/low-stock. */
export interface LowStockItem {
  variantId: string;
  productId: string;
  productName: string;
  label: string;
  category: string;
  branchId: string;
  qty: number;
  minStock: number;
}

export type SeriesGranularity = 'day' | 'month';

export interface BucketProduct {
  productId: string;
  name: string;
  qty: number;
  netCents: number;
}

export interface TopBucket {
  /** 'AAAA-MM-DD' (día) o 'AAAA-MM' (mes). */
  bucket: string;
  topProduct: { name: string; qty: number } | null;
  products: BucketProduct[];
}

export interface SeriesPoint {
  bucket: string;
  qty: number;
  netCents: number;
}

export interface ProductSeriesLine {
  productId: string;
  name: string;
  points: SeriesPoint[];
}

/** Respuesta de GET /stats/top-products-series. */
export interface TopProductsSeries {
  buckets: TopBucket[];
  series: ProductSeriesLine[];
}

export type ChartKind = 'line' | 'bar' | 'pie';

/* ---------------------------------------------------------------- Terminales v2 */

export interface TerminalRecord {
  id: string;
  code: string;
  name: string;
  kind: 'escritorio' | 'movil';
  branchId: string;
  assignedTo?: string | null;
}

/** Respuesta de POST /admin/terminals/:id/token (v2). */
export interface TerminalTokenResponse {
  terminalId?: string;
  code?: string;
  name?: string;
  kind?: 'escritorio' | 'movil';
  branchId?: string;
  assignedTo?: string | null;
  token: string;
}

/** Datos listos para mostrar en el modal "datos de la terminal". */
export interface TerminalCredentials {
  id: string;
  code: string;
  name: string;
  kind: 'escritorio' | 'movil';
  branchId: string;
  assignedTo: string;
  /** null si no se pudo emitir (p. ej. se canceló la confirmación de contraseña). */
  token: string | null;
}

/* ------------------------------------------------------------------ Auditoría */

/** Fila de auditoría ya normalizada para mostrarse (ver lib/audit.ts). */
export interface AuditView {
  id: string;
  /** ISO UTC o '' si el servidor no envió fecha. */
  at: string;
  userLabel: string;
  entity: string;
  action: string;
  /** Resumen de una línea, siempre texto. */
  summary: string;
  before: unknown;
  after: unknown;
  /** Detalle completo tal como lo envió el servidor. */
  raw: unknown;
  hasDiff: boolean;
}

/* ---------------------------------------------------------------------- Extras */

export interface ExtraCategoriesResponse {
  categories: string[];
}
