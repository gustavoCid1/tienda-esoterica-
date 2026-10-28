import type { Grant, Role, SyncResult } from '@amara/shared';

export class StoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
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
  users: { id: string; username: string; name: string; role: Role; branchIds: string[]; active: boolean }[];
  grants: Grant[];
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
  items: { name: string; label: string; qty: number; unitPriceCents: number; netCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: { method: string; amountCents: number; tenderedCents?: number; changeCents?: number }[];
  status: string;
}

export type { SyncResult };
