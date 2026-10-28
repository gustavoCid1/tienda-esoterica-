/**
 * Esquema SQLite local (escritorio y móvil) y migraciones.
 * Reglas:
 *  - Las migraciones SOLO se agregan al final; nunca se edita una ya publicada.
 *  - El historial financiero (ventas, partidas, pagos, movimientos, auditoría)
 *    está protegido con TRIGGERS: no se puede borrar ni reescribir; las
 *    correcciones se registran como nuevos registros (ajustes).
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE branches (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'activa', locations_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE users_local (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('gerente','vendedor','desarrollador')),
  branch_ids_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  verifier TEXT,            -- hash derivado tras un inicio de sesión en línea; NUNCA la contraseña
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL,
  description TEXT, brand TEXT, sku TEXT NOT NULL, photo TEXT,
  specs_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','archivado')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_sku ON products(sku);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  label TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pieza',
  barcode TEXT, internal_code TEXT NOT NULL, qr_value TEXT NOT NULL,
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','archivado')),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_variants_internal ON variants(internal_code);
CREATE INDEX idx_variants_barcode ON variants(barcode);
CREATE INDEX idx_variants_product ON variants(product_id);

-- Existencia conocida del servidor (base). La cantidad visible = base + movimientos locales pendientes.
CREATE TABLE stock (
  variant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  base_qty INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (variant_id, branch_id)
);

CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
  opened_by TEXT NOT NULL, opened_at TEXT NOT NULL, opening_cents INTEGER NOT NULL CHECK (opening_cents >= 0),
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','cerrada')),
  closed_by TEXT, closed_at TEXT, counted_cents INTEGER, expected_cents INTEGER, difference_cents INTEGER,
  provisional INTEGER NOT NULL DEFAULT 0,
  reconciliation TEXT NOT NULL DEFAULT 'n/a' CHECK (reconciliation IN ('n/a','pendiente','conciliado','con_diferencias')),
  closure_json TEXT, notes TEXT
);
CREATE UNIQUE INDEX idx_one_open_session ON cash_sessions(terminal_id) WHERE status = 'abierta';

CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('entrada','retiro','gasto')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  concept TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE sales (
  id TEXT PRIMARY KEY, folio TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
  cash_session_id TEXT, created_at TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  tendered_cents INTEGER NOT NULL DEFAULT 0, change_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completada' CHECK (status IN ('completada','cancelada')),
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local','lan')),
  sync_state TEXT NOT NULL DEFAULT 'pendiente' CHECK (sync_state IN ('pendiente','sincronizada','conflicto'))
);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sales_branch_created ON sales(branch_id, created_at);
CREATE INDEX idx_sales_session ON sales(cash_session_id);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  variant_id TEXT NOT NULL, product_name TEXT NOT NULL, variant_label TEXT NOT NULL,
  sku TEXT NOT NULL, code TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL, unit_cost_cents INTEGER NOT NULL,
  line_discount_cents INTEGER NOT NULL DEFAULT 0, net_cents INTEGER NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE sale_payments (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('efectivo','tarjeta','transferencia','otro')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  tendered_cents INTEGER, change_cents INTEGER
);
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

-- Copia del ticket tal como se emitió (para reimprimir idéntico aunque cambie el catálogo).
CREATE TABLE tickets (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id), folio TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  printed_customer_at TEXT, printed_store_at TEXT,
  print_count INTEGER NOT NULL DEFAULT 0, last_print_error TEXT
);

CREATE TABLE sale_adjustments (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL, user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cancelacion','devolucion')),
  created_at TEXT NOT NULL, reason TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  payments_json TEXT NOT NULL, items_json TEXT NOT NULL,
  cash_session_id TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pendiente' CHECK (sync_state IN ('pendiente','sincronizada','conflicto'))
);
CREATE INDEX idx_adj_sale ON sale_adjustments(sale_id);
CREATE INDEX idx_adj_created ON sale_adjustments(created_at);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  delta INTEGER NOT NULL, type TEXT NOT NULL, reason TEXT NOT NULL,
  ref_type TEXT, ref_id TEXT, user_id TEXT NOT NULL, authorized_by TEXT, grant_id TEXT, location TEXT,
  created_at TEXT NOT NULL,
  op_id TEXT,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_mov_variant ON inventory_movements(variant_id, branch_id, synced);
CREATE INDEX idx_mov_op ON inventory_movements(op_id);

CREATE TABLE sync_queue (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL, user_id TEXT NOT NULL,
  local_ts TEXT NOT NULL, payload_json TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local','lan')),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviada','conflicto','rechazada')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, received_at TEXT, ack_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_queue_status ON sync_queue(status, seq);

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY, op_id TEXT, kind TEXT NOT NULL, detail_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','resuelto')),
  created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, resolution TEXT
);

CREATE TABLE counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE printers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, paper_mm INTEGER NOT NULL DEFAULT 80,
  kind TEXT NOT NULL DEFAULT 'tickets', is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE grants_local (
  id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  functions_json TEXT NOT NULL, starts_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  revoked_at TEXT, granted_by TEXT NOT NULL, fetched_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, branch_id TEXT, terminal_id TEXT, detail_json TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE backups_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, path TEXT,
  ok INTEGER NOT NULL, size_bytes INTEGER, verified INTEGER NOT NULL DEFAULT 0, error TEXT
);

-- ===== Protección del historial: no borrar ni reescribir =====
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'Las ventas no se pueden borrar'); END;
CREATE TRIGGER sales_immutable BEFORE UPDATE OF id, folio, branch_id, terminal_id, user_id, user_name, cash_session_id, created_at,
  subtotal_cents, discount_cents, total_cents, tendered_cents, change_cents ON sales
  BEGIN SELECT RAISE(ABORT, 'Los datos de una venta no se pueden modificar'); END;
CREATE TRIGGER sale_items_no_delete BEFORE DELETE ON sale_items BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER sale_items_no_update BEFORE UPDATE ON sale_items BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER sale_payments_no_delete BEFORE DELETE ON sale_payments BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER sale_payments_no_update BEFORE UPDATE ON sale_payments BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER tickets_no_delete BEFORE DELETE ON tickets BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER tickets_payload_immutable BEFORE UPDATE OF payload_json, folio, sale_id ON tickets BEGIN SELECT RAISE(ABORT, 'El ticket emitido no se modifica'); END;
CREATE TRIGGER adj_no_delete BEFORE DELETE ON sale_adjustments BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER adj_immutable BEFORE UPDATE OF id, sale_id, type, created_at, amount_cents, payments_json, items_json, user_id ON sale_adjustments
  BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER mov_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER mov_immutable BEFORE UPDATE OF id, variant_id, branch_id, delta, type, reason, user_id, created_at ON inventory_movements
  BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER cash_mov_no_delete BEFORE DELETE ON cash_movements BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER cash_mov_no_update BEFORE UPDATE ON cash_movements BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER cash_sessions_no_delete BEFORE DELETE ON cash_sessions BEGIN SELECT RAISE(ABORT, 'Historial protegido'); END;
CREATE TRIGGER cash_closed_immutable BEFORE UPDATE ON cash_sessions
  WHEN OLD.status = 'cerrada' AND (NEW.counted_cents IS NOT OLD.counted_cents OR NEW.expected_cents IS NOT OLD.expected_cents
    OR NEW.difference_cents IS NOT OLD.difference_cents OR NEW.status IS NOT OLD.status OR NEW.closure_json IS NOT OLD.closure_json
    OR NEW.opening_cents IS NOT OLD.opening_cents)
  BEGIN SELECT RAISE(ABORT, 'Un corte cerrado no se modifica'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'La auditoría no se borra'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'La auditoría no se modifica'); END;
`;

export const MIGRATIONS: Migration[] = [{ version: 1, name: 'esquema_inicial', sql: V1 }];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
