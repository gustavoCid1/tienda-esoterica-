/**
 * Tipos compartidos por API, web, escritorio y móvil.
 * Convenciones del sistema (no cambiar sin migrar datos):
 *  - Dinero: SIEMPRE enteros en centavos de MXN (nunca decimales flotantes).
 *  - Fechas: SIEMPRE ISO-8601 en UTC con milisegundos y "Z" (toISOString()).
 *  - Cantidades de producto: enteros (unidades).
 *  - Identificadores: UUID v4 generados en el dispositivo que crea el registro,
 *    lo que permite trabajar sin conexión y reenviar sin duplicar.
 */

export type Role = 'gerente' | 'vendedor' | 'desarrollador';

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['efectivo', 'tarjeta', 'transferencia', 'otro'];

export type SaleStatus = 'completada' | 'cancelada';

export type MovementType =
  | 'entrada'
  | 'salida'
  | 'ajuste'
  | 'venta'
  | 'devolucion'
  | 'transferencia_salida'
  | 'transferencia_entrada'
  | 'conteo';

export type CashMovementType = 'entrada' | 'retiro' | 'gasto';

export type OpType =
  | 'sale.create'
  | 'sale.adjust'
  | 'stock.movement'
  | 'cash.open'
  | 'cash.movement'
  | 'cash.close';

export interface Money {
  cents: number;
}

export interface PaymentLine {
  method: PaymentMethod;
  /** Importe aplicado a la venta (ya sin el cambio). */
  amountCents: number;
  /** Solo efectivo: lo que entregó el cliente. */
  tenderedCents?: number;
  /** Solo efectivo: cambio devuelto. */
  changeCents?: number;
}

/** Copia histórica de la línea vendida: no cambia si el catálogo cambia. */
export interface SaleItem {
  id: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  code: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
  lineDiscountCents: number;
  /** Importe final de la línea tras descuentos (incluye parte del descuento general). */
  netCents: number;
  /**
   * v2. Por omisión 'producto'. Línea 'extra': variantId = variante del producto padre; qty = 1;
   * unitPriceCents = cargo extra; unitCostCents = 0; NO genera movimiento de inventario.
   * Cuenta como ingreso, no como unidad vendida.
   */
  kind?: SaleItemKind;
  /** v2. Nota libre de la línea extra (qué se cobró). */
  extraNote?: string | null;
}

/** v2. Tipo de línea de venta. */
export type SaleItemKind = 'producto' | 'extra';

/** v2. Tipo de venta: 'limpia' = servicio de Limpias (por omisión las ventas son 'venta'). */
export type SaleType = 'venta' | 'limpia';

export interface Sale {
  id: string;
  folio: string;
  branchId: string;
  terminalId: string;
  userId: string;
  userName: string;
  cashSessionId: string | null;
  createdAt: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  tenderedCents: number;
  changeCents: number;
  status: SaleStatus;
  items: SaleItem[];
  payments: PaymentLine[];
  /** v2. Empleado que vendió (elegido en la ventana de cobro). */
  sellerId?: string | null;
  /** v2. SOLO en sistema: NO se imprime en el ticket. */
  sellerName?: string | null;
  /** v2. Por omisión 'venta'. */
  type?: SaleType;
}

export type AdjustmentType = 'cancelacion' | 'devolucion';

export interface AdjustmentItem {
  saleItemId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  qty: number;
  unitCostCents: number;
  netCents: number;
  /** ¿Regresa a existencias? (false = producto dañado / merma). Las líneas 'extra' siempre false. */
  restock: boolean;
  /** v2. Espejo de SaleItem.kind: una línea 'extra' devuelve dinero pero no unidades ni existencias. */
  kind?: SaleItemKind;
}

export interface SaleAdjustment {
  id: string;
  saleId: string;
  branchId: string;
  terminalId: string;
  userId: string;
  type: AdjustmentType;
  createdAt: string;
  reason: string;
  amountCents: number;
  /** Cómo se devolvió el dinero (para caja y reportes por método). */
  payments: { method: PaymentMethod; amountCents: number }[];
  items: AdjustmentItem[];
  cashSessionId: string | null;
}

export interface InventoryMovement {
  id: string;
  variantId: string;
  branchId: string;
  /** Con signo: positivo suma, negativo resta. */
  delta: number;
  type: MovementType;
  reason: string;
  refType: string | null;
  refId: string | null;
  userId: string;
  authorizedBy: string | null;
  grantId: string | null;
  location: string | null;
  createdAt: string;
}

export interface CashSession {
  id: string;
  branchId: string;
  terminalId: string;
  openedBy: string;
  openedAt: string;
  openingCents: number;
  status: 'abierta' | 'cerrada';
  /** v2. Datos del cierre (todos opcionales: una sesión abierta no los tiene). */
  closedAt?: string | null;
  closedBy?: string | null;
  /** Quién autorizó el cierre: contraseña de un gerente o token. Obligatorio para cerrar. */
  closeAuthorization?: ActionAuthorization | null;
  countedCents?: number | null;
  expectedCents?: number | null;
  differenceCents?: number | null;
}

export interface CashMovement {
  id: string;
  sessionId: string;
  type: CashMovementType;
  amountCents: number;
  concept: string;
  userId: string;
  createdAt: string;
}

export interface Grant {
  id: string;
  sellerId: string;
  branchId: string;
  functions: string[];
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  grantedBy: string;
}

export interface SyncOp {
  opId: string;
  type: OpType;
  branchId: string;
  terminalId: string;
  userId: string;
  /** Hora del dispositivo cuando ocurrió la operación. */
  localTs: string;
  payload: unknown;
}

export type SyncResultStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface SyncResult {
  opId: string;
  status: SyncResultStatus;
  /** Para 'conflict': la operación SÍ se aplicó pero quedó una diferencia para el gerente. */
  conflictKind?: string;
  detail?: string;
  receivedAt: string;
}

// ───────────────────────────── v2: seguridad ─────────────────────────────

/** v2. Para qué sirve un token de seguridad. */
export type TokenPurpose = 'cierre_caja' | 'devolucion' | 'cancelacion' | 'limpias';
export const TOKEN_PURPOSES: readonly TokenPurpose[] = ['cierre_caja', 'devolucion', 'cancelacion', 'limpias'];

/** v2. Token de seguridad (sin el código: solo el servidor conoce `hash` y `salt`). */
export interface SecurityToken {
  id: string;
  label: string;
  purposes: TokenPurpose[];
  /** null = cualquier sucursal del administrador que lo creó. */
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

/** v2. Token tal como viaja en el `pull` y se guarda en la caché del dispositivo: solo hashes, nunca el código. */
export interface CachedSecurityToken extends SecurityToken {
  salt: string;
  /** sha256 hex de `salt:CODIGO` (ver hashTokenCode). */
  hash: string;
}

/**
 * v2. Quién autorizó una acción sensible (cerrar caja, cancelar, devolver, Limpias de un vendedor).
 * Nunca incluye la contraseña ni el código del token: solo quién autorizó.
 */
export type ActionAuthorization =
  | { kind: 'admin_password'; adminUserId: string }
  | { kind: 'token'; tokenId: string };

/** v2. Resumen de un ticket de hoy: solo lo vendido, cantidades y precios (no el ticket impreso). */
export interface TodaySaleSummary {
  saleId: string;
  folio: string;
  createdAt: string;
  status: SaleStatus;
  type: SaleType;
  sellerId: string | null;
  sellerName: string | null;
  totalCents: number;
  items: {
    name: string;
    label: string;
    qty: number;
    unitPriceCents: number;
    netCents: number;
    kind: SaleItemKind;
    extraNote: string | null;
  }[];
}
