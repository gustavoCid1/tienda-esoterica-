/**
 * Formas de respuesta de la API que consume el panel.
 *
 * docs/API.md fija rutas y permisos, pero casi nunca la forma exacta de cada respuesta.
 * Estos tipos son SUPUESTOS razonables (ver docs/PENDIENTES-web.md); las pantallas leen
 * los campos de forma tolerante (valores por defecto, listas vacías) para no romperse
 * si el servidor omite alguno.
 */
import type { CashBreakdown, MonthTotal, Role, Sale, SalesSummary } from '@amara/shared';

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  branchIds: string[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  locations: string[];
  active?: boolean;
}

export interface Terminal {
  id: string;
  code: string;
  name: string;
  branchId: string;
  kind: 'escritorio' | 'movil';
  active?: boolean;
  /** La API v1 manda `revoked` (booleano); otras versiones `revokedAt`. Ver isTerminalRevoked. */
  revoked?: boolean;
  revokedAt?: string | null;
  lastSyncAt?: string | null;
  /** v2: persona a quien se asignó la terminal. */
  assignedTo?: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  branchIds: string[];
  active: boolean;
  createdAt?: string;
}

/** Fila de GET /inventory: una variante en una sucursal. */
export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: string;
  category: string;
  type?: string | null;
  variantLabel: string;
  sku?: string | null;
  /** Código de barras impreso por el fabricante o interno asignado. */
  barcode?: string | null;
  /** Código interno AMA00000000. */
  code?: string | null;
  branchId: string;
  branchName?: string | null;
  location?: string | null;
  qty: number;
  minStock: number;
  costCents: number;
  priceCents: number;
  photo?: string | null;
  archived?: boolean;
}

export interface CatalogVariant {
  id: string;
  label: string;
  unit: string;
  barcode?: string | null;
  code?: string | null;
  costCents: number;
  priceCents: number;
  minStock: number;
  location?: string | null;
  archived?: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  type: string;
  category: string;
  description?: string | null;
  brand?: string | null;
  sku: string;
  photo?: string | null;
  specs: Record<string, string>;
  notes?: string | null;
  archived?: boolean;
  variants: CatalogVariant[];
}

export interface StockMovementRow {
  id: string;
  variantId: string;
  productName?: string;
  variantLabel?: string;
  branchId: string;
  delta: number;
  type: string;
  reason: string;
  userId: string;
  userName?: string;
  location?: string | null;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
}

export interface GrantRow {
  id: string;
  sellerId: string;
  sellerName?: string;
  branchId: string;
  functions: string[];
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  grantedBy: string;
  grantedByName?: string;
}

export interface CashSessionRow {
  id: string;
  branchId: string;
  terminalId: string;
  terminalName?: string;
  openedBy: string;
  openedByName?: string;
  openedAt: string;
  closedAt?: string | null;
  openingCents: number;
  status: 'abierta' | 'cerrada';
  expectedCents?: number | null;
  countedCents?: number | null;
  differenceCents?: number | null;
  /** Corte con operaciones pendientes de conciliar: cifras sujetas a cambio. */
  provisional?: boolean;
  pendingReconcile?: number;
  notes?: string | null;
  denominations?: Record<string, number>;
  breakdown?: CashBreakdown;
}

export interface ConflictRow {
  id: string;
  kind: string;
  status: 'abierto' | 'resuelto' | string;
  detail?: string;
  branchId?: string;
  terminalId?: string;
  opId?: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  payload?: unknown;
}

export interface AuditRow {
  id: string;
  entity: string;
  entityId?: string;
  action: string;
  userId?: string;
  userName?: string;
  before?: unknown;
  after?: unknown;
  detail?: string;
  createdAt: string;
}

export interface BackupRow {
  id: string;
  createdAt: string;
  kind?: string;
  status: string;
  sizeBytes?: number;
  location?: string;
  detail?: string;
  /** Forma real de la API v1: `at` en lugar de `createdAt`, `ok` en lugar de `status`, `dir` como ubicación. */
  at?: string;
  ok?: boolean;
  dir?: string;
  files?: { bytes?: number }[];
}

export interface SyncTerminalStatus {
  id?: string;
  terminalId?: string;
  code?: string;
  name?: string;
  branchId?: string;
  lastSyncAt?: string | null;
  pendingOps?: number;
  /** Nombre real que envía la API v1. */
  pendingEvents?: number;
  openConflicts?: number;
}

export interface SyncStatus {
  terminals?: SyncTerminalStatus[];
  serverTime?: string;
  pendingOps?: number;
  openConflicts?: number;
}

export interface DashboardExtra {
  outOfStock: InventoryRow[];
  lowStock: InventoryRow[];
}

export interface MonthsResponse {
  months: MonthTotal[];
  best: MonthTotal | null;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface DashboardPrefs {
  order: string[];
  hidden: string[];
  /** v2: tipo de gráfica de productos más vendidos (line | bar | pie), guardado por usuario. */
  chartKind?: 'line' | 'bar' | 'pie';
}

export type { Sale, SalesSummary };
