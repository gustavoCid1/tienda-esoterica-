import type { CachedSecurityToken, Grant, Role, SaleItemKind, SyncResult } from '@amara/shared';

export class StoreError extends Error {
  code: string;
  /** v2. Datos opcionales para la interfaz (p. ej. variantId y disponible en 'sin_existencia'). */
  data?: Record<string, unknown>;
  constructor(code: string, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (data) this.data = data;
  }
}

/** Quién ejecuta la acción. El rol local se REVALIDA en el servidor al sincronizar. */
export interface Actor {
  userId: string;
  userName: string;
  role: Role;
}

export interface DeviceInfo {
  branchId: string;
  branchCode: string;
  terminalId: string;
  terminalCode: string;
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
  status: 'activo' | 'archivado';
  createdAt: string;
  updatedAt: string;
}

export interface CatalogVariant {
  id: string;
  productId: string;
  label: string;
  unit: string;
  barcode?: string | null;
  internalCode: string;
  qrValue: string;
  costCents: number;
  priceCents: number;
  minStock: number;
  location?: string | null;
  status: 'activo' | 'archivado';
  updatedAt: string;
}

export interface PullPayload {
  serverTime: string;
  branches: { id: string; code: string; name: string; status: string; locations: string[] }[];
  products: CatalogProduct[];
  variants: CatalogVariant[];
  /** Existencia del servidor por variante y sucursal (lista completa de las sucursales autorizadas). */
  stock: { variantId: string; branchId: string; qty: number; location?: string | null }[];
  users: {
    id: string; username: string; name: string; role: Role; branchIds: string[]; active: boolean;
    /**
     * v2. Solo para gerentes activos de la sucursal: verificador de contraseña (hash scrypt, nunca la contraseña)
     * para poder pedir "contraseña de administrador" SIN internet. Si no viene, se conserva el que ya había.
     */
    verifier?: string | null;
  }[];
  grants: Grant[];
  /** v2. Tokens de seguridad vigentes o recientes (solo hashes). Si viene, REEMPLAZA la caché local. */
  securityTokens?: CachedSecurityToken[];
  /** v2. Configuración del servidor. */
  settings?: { extraCategories?: string[] };
}

/** Resultado de buscar un código/producto con su existencia local en la sucursal. */
export interface CatalogHit {
  variantId: string;
  productId: string;
  productName: string;
  category: string;
  type: string;
  label: string;
  unit: string;
  sku: string;
  barcode: string | null;
  internalCode: string;
  qrValue: string;
  costCents: number;
  priceCents: number;
  minStock: number;
  location: string | null;
  photo: string | null;
  status: string;
  qty: number;
}

export interface TicketPayload {
  business: string;
  branchName: string;
  folio: string;
  createdAt: string;
  userName: string;
  items: { name: string; label: string; qty: number; unitPriceCents: number; netCents: number; kind?: SaleItemKind; extraNote?: string | null }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: { method: string; amountCents: number; tenderedCents?: number; changeCents?: number }[];
  status: string;
  /** v2. Ticket de una venta 'limpia' (para titularlo distinto). El vendedor (sellerName) NO se imprime. */
  saleType?: 'venta' | 'limpia';
}

export type { SyncResult };
