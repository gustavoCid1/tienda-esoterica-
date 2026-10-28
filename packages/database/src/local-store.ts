/**
 * Almacén local (SQLite) de escritorio y móvil: ventas, caja, inventario local,
 * cola de sincronización y respaldos. TODA escritura importante ocurre dentro de
 * UNA transacción: o se guarda venta + partidas + pagos + ticket + movimientos
 * de inventario + operación de sincronización + auditoría, o no se guarda nada.
 * Solo después del COMMIT se le informa al operador que la venta quedó guardada.
 */
import {
  DEFAULT_EXTRA_CATEGORIES,
  buildFolio,
  can,
  cashDifference,
  computeCashBreakdown,
  computeSale,
  isGrantActive,
  isTokenActive,
  mxDayBounds,
  mxDayKey,
  newId,
  parseQrValue,
  refundAmountForLine,
  sanitizeExtraCategories,
  summarizeSales,
  tokenDenyMessage,
  verifyTokenCodeLocal,
} from '@amara/shared';
import type {
  ActionAuthorization,
  AdjustmentItem,
  CachedSecurityToken,
  CashMovementType,
  Grant,
  PaymentInput,
  PaymentMethod,
  ReportAdjustment,
  ReportSale,
  SalesSummary,
  Sale,
  SaleAdjustment,
  SaleItemKind,
  SaleLineInput,
  SaleType,
  SyncOp,
  SyncResult,
  TodaySaleSummary,
  TokenPurpose,
} from '@amara/shared';
import type { Db, RawDb } from './db.ts';
import { MIGRATIONS } from './schema.ts';
import { StoreError } from './types.ts';
import type { Actor, CatalogHit, DeviceInfo, PullPayload, TicketPayload } from './types.ts';

const j = (v: unknown) => JSON.stringify(v);
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** Cantidad visible = existencia conocida del servidor + movimientos locales aún no confirmados. */
const QTY_SQL = (branchParam = '?') =>
  `(COALESCE(st.base_qty, 0) + COALESCE((SELECT SUM(m.delta) FROM inventory_movements m WHERE m.variant_id = v.id AND m.branch_id = ${branchParam} AND m.synced = 0), 0))`;

const HIT_SELECT = `
  SELECT v.id AS variantId, p.id AS productId, p.name AS productName, p.category AS category, p.type AS type,
         v.label AS label, v.unit AS unit, p.sku AS sku, v.barcode AS barcode, v.internal_code AS internalCode,
         v.qr_value AS qrValue, v.cost_cents AS costCents, v.price_cents AS priceCents, v.min_stock AS minStock,
         COALESCE(st.location, v.location) AS location, p.photo AS photo, v.status AS status,
         ${QTY_SQL()} AS qty
  FROM variants v
  JOIN products p ON p.id = v.product_id
  LEFT JOIN stock st ON st.variant_id = v.id AND st.branch_id = ?`;

/** Línea de venta de entrada. Un 'extra' lleva el cargo en `unitPriceCents`, qty = 1 y una nota. */
export interface RegisterSaleItem {
  variantId: string;
  qty: number;
  lineDiscountCents?: number;
  /** v2. Por omisión 'producto' (precio y costo salen del catálogo local). */
  kind?: SaleItemKind;
  /** v2. SOLO para 'extra': cargo adicional en centavos (≥ 0). En un producto se ignora. */
  unitPriceCents?: number;
  /** v2. SOLO para 'extra': qué se cobró. */
  extraNote?: string | null;
}

export interface RegisterSaleInput {
  /** Se genera en la pantalla ANTES de cobrar: reintentar con el mismo id nunca duplica. */
  saleId: string;
  actor: Actor;
  branchId: string;
  terminalId: string;
  items: RegisterSaleItem[];
  discountCents?: number;
  payments: PaymentInput[];
  /** v2. Empleado que vendió (elegido en la ventana de cobro). Si falta el nombre, se busca en los usuarios locales. */
  sellerId?: string | null;
  /** v2. SOLO en sistema: no se imprime en el ticket. */
  sellerName?: string | null;
  /** v2. 'venta' por omisión. Una 'limpia' hecha por un vendedor exige `authorization` con propósito 'limpias'. */
  type?: SaleType;
  /** v2. Autorización de la acción (Limpias de un vendedor). */
  authorization?: ActionAuthorization;
  /** v2. true si el servidor ya validó esta autorización en línea hace instantes (el token puede no estar en la caché). */
  authorizationTrusted?: boolean;
}

export interface RegisterSaleResult {
  sale: Sale;
  duplicate: boolean;
  /** Se conserva por compatibilidad. v2: las ventas nuevas ya no dejan existencias negativas, así que va vacío. */
  warnings: string[];
}

/** v2. Verificador de contraseña inyectable (por omisión, scrypt de @amara/shared/password). */
export type PasswordVerifier = (password: string, stored: string) => boolean | Promise<boolean>;

async function defaultVerifyPassword(password: string, stored: string): Promise<boolean> {
  // Carga perezosa: solo se necesita al validar contraseñas de administrador (y arrastra @noble/hashes).
  const m = await import('@amara/shared/password');
  return m.verifyPassword(password, stored);
}

export interface VerifyAuthorizationInput {
  /** Código del token (cualquier combinación de mayúsculas/minúsculas, con o sin guiones). */
  code?: string;
  /** Contraseña de un gerente activo de la sucursal. Se compara con el verificador local; no se guarda. */
  adminPassword?: string;
  /** Si se conoce quién es el gerente; si no, se prueba contra los gerentes de la sucursal. */
  adminUserId?: string;
  purpose: TokenPurpose;
  branchId: string;
  /** Usuario que realizará la acción (para tokens "solo para ese usuario"). */
  userId?: string;
}

export type VerifyAuthorizationResult =
  | {
      ok: true;
      authorization: ActionAuthorization;
      /** Gerente que autorizó (o quien creó el token). */
      authorizedBy: string | null;
      authorizedByName: string | null;
      expiresAt: string | null;
      tokenLabel: string | null;
    }
  | { ok: false; reason: string; message: string };

/** v2. Resultado de una verificación de autorización a nivel de operación. */
interface ResolvedAuthorization {
  authorization: ActionAuthorization;
  authorizedBy: string | null;
}

export class LocalStore {
  db: Db;
  private clock: () => Date;
  private verifyPw: PasswordVerifier;

  constructor(db: Db, opts: { now?: () => Date; verifyPassword?: PasswordVerifier } = {}) {
    this.db = db;
    this.clock = opts.now ?? (() => new Date());
    this.verifyPw = opts.verifyPassword ?? defaultVerifyPassword;
  }

  nowIso(): string {
    return this.clock().toISOString();
  }

  // ───────────────────────── Migraciones e integridad ─────────────────────────

  async migrate(): Promise<void> {
    await this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    const done = new Set((await this.db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await this.db.transaction(async (tx) => {
        await tx.exec(m.sql);
        await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)', [m.version, m.name, this.nowIso()]);
      });
    }
  }

  async integrityCheck(): Promise<{ ok: boolean; problems: string[] }> {
    const rows = await this.db.all<Record<string, string>>('PRAGMA integrity_check');
    const problems = rows.map((r) => Object.values(r)[0]!).filter((v) => v !== 'ok');
    const fk = await this.db.all<Record<string, unknown>>('PRAGMA foreign_key_check');
    for (const r of fk) problems.push(`Llave foránea inconsistente: ${j(r)}`);
    return { ok: problems.length === 0, problems };
  }

  // ───────────────────────── Meta / dispositivo ─────────────────────────

  async getMeta(key: string): Promise<string | undefined> {
    return (await this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  async setDeviceInfo(info: DeviceInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [k, v] of Object.entries({
        branch_id: info.branchId,
        branch_code: info.branchCode,
        terminal_id: info.terminalId,
        terminal_code: info.terminalCode,
      })) {
        await tx.run('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);
      }
    });
  }

  async getDeviceInfo(): Promise<DeviceInfo | undefined> {
    const rows = await this.db.all<{ key: string; value: string }>(
      "SELECT key, value FROM meta WHERE key IN ('branch_id','branch_code','terminal_id','terminal_code')",
    );
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!m.branch_id || !m.terminal_id || !m.branch_code || !m.terminal_code) return undefined;
    return { branchId: m.branch_id, branchCode: m.branch_code, terminalId: m.terminal_id, terminalCode: m.terminal_code };
  }

  // ───────────────────────── Catálogo y existencias ─────────────────────────

  /** Aplica datos del servidor. NUNCA toca ventas ni movimientos locales pendientes. */
  async applyPull(p: PullPayload): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const b of p.branches) {
        await tx.run(
          `INSERT INTO branches (id, code, name, status, locations_json) VALUES (?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, status = excluded.status, locations_json = excluded.locations_json`,
          [b.id, b.code, b.name, b.status, j(b.locations)],
        );
      }
      for (const pr of p.products) {
        await tx.run(
          `INSERT INTO products (id, name, type, category, description, brand, sku, photo, specs_json, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, category = excluded.category,
             description = excluded.description, brand = excluded.brand, sku = excluded.sku, photo = excluded.photo,
             specs_json = excluded.specs_json, status = excluded.status, updated_at = excluded.updated_at`,
          [pr.id, pr.name, pr.type, pr.category, pr.description ?? null, pr.brand ?? null, pr.sku, pr.photo ?? null, j(pr.specs ?? {}), pr.status, pr.createdAt, pr.updatedAt],
        );
      }
      for (const v of p.variants) {
        await tx.run(
          `INSERT INTO variants (id, product_id, label, unit, barcode, internal_code, qr_value, cost_cents, price_cents, min_stock, location, status, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET product_id = excluded.product_id, label = excluded.label, unit = excluded.unit,
             barcode = excluded.barcode, internal_code = excluded.internal_code, qr_value = excluded.qr_value,
             cost_cents = excluded.cost_cents, price_cents = excluded.price_cents, min_stock = excluded.min_stock,
             location = excluded.location, status = excluded.status, updated_at = excluded.updated_at`,
          [v.id, v.productId, v.label, v.unit, v.barcode ?? null, v.internalCode, v.qrValue, v.costCents, v.priceCents, v.minStock, v.location ?? null, v.status, v.updatedAt],
        );
      }
      for (const s of p.stock) {
        await tx.run(
          `INSERT INTO stock (variant_id, branch_id, base_qty, location, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(variant_id, branch_id) DO UPDATE SET base_qty = excluded.base_qty, location = COALESCE(excluded.location, stock.location), updated_at = excluded.updated_at`,
          [s.variantId, s.branchId, s.qty, s.location ?? null, p.serverTime],
        );
      }
      for (const u of p.users) {
        // v2: `verifier` (solo gerentes) permite validar su contraseña sin internet; si no viene, se conserva el anterior.
        await tx.run(
          `INSERT INTO users_local (id, username, name, role, branch_ids_json, active, verifier, updated_at) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, role = excluded.role,
             branch_ids_json = excluded.branch_ids_json, active = excluded.active,
             verifier = COALESCE(excluded.verifier, users_local.verifier), updated_at = excluded.updated_at`,
          [u.id, u.username, u.name, u.role, j(u.branchIds), u.active ? 1 : 0, u.verifier ?? null, p.serverTime],
        );
      }
      for (const g of p.grants) {
        await tx.run(
          `INSERT INTO grants_local (id, seller_id, branch_id, functions_json, starts_at, expires_at, revoked_at, granted_by, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET functions_json = excluded.functions_json, starts_at = excluded.starts_at,
             expires_at = excluded.expires_at, revoked_at = excluded.revoked_at, fetched_at = excluded.fetched_at`,
          [g.id, g.sellerId, g.branchId, j(g.functions), g.startsAt, g.expiresAt, g.revokedAt, g.grantedBy, p.serverTime],
        );
      }
      if (p.securityTokens) {
        // La caché de tokens es una copia del servidor: se reemplaza completa (así un token revocado o vencido desaparece/actualiza).
        await tx.run('DELETE FROM security_tokens_cache');
        for (const t of p.securityTokens) {
          await tx.run(
            `INSERT INTO security_tokens_cache (id, label, hash, salt, purposes, branch_id, for_user_id, created_by, created_at, expires_at, revoked_at, max_uses, used_count, fetched_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [t.id, t.label ?? '', t.hash, t.salt, j(t.purposes ?? []), t.branchId ?? null, t.forUserId ?? null, t.createdBy ?? null, t.createdAt ?? null,
              t.expiresAt, t.revokedAt ?? null, t.maxUses ?? null, t.usedCount ?? 0, p.serverTime],
          );
        }
      }
      if (p.settings?.extraCategories) {
        await tx.run(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          ['extraCategories', j(sanitizeExtraCategories(p.settings.extraCategories)), p.serverTime],
        );
      }
      await tx.run("INSERT INTO meta (key, value) VALUES ('last_pull_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [p.serverTime]);
      await tx.run("INSERT INTO meta (key, value) VALUES ('last_sync_ok_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [this.nowIso()]);
    });
  }

  /** Verificador local de contraseña (hash derivado tras login en línea). */
  async setUserVerifier(userId: string, verifier: string): Promise<void> {
    await this.db.run('UPDATE users_local SET verifier = ? WHERE id = ?', [verifier, userId]);
  }

  async getUserByUsername(username: string) {
    const r = await this.db.get<any>('SELECT * FROM users_local WHERE username = ? AND active = 1', [username]);
    if (!r) return undefined;
    return { id: r.id as string, username: r.username as string, name: r.name as string, role: r.role as Actor['role'], branchIds: parse<string[]>(r.branch_ids_json, []), verifier: r.verifier as string | null };
  }

  // ───────────────────────── v2: configuración y autorizaciones ─────────────────────────

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const r = await this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    return parse<T>(r?.value, fallback);
  }

  /** Categorías con botón Extra (las del servidor; por omisión Veladoras, Pulseras, Imágenes, Lociones). */
  async getExtraCategories(): Promise<string[]> {
    const list = await this.getSetting<unknown>('extraCategories', null);
    return Array.isArray(list) ? list.map(String) : [...DEFAULT_EXTRA_CATEGORIES];
  }

  async getSettings(): Promise<{ extraCategories: string[] }> {
    return { extraCategories: await this.getExtraCategories() };
  }

  private rowToToken(r: any): CachedSecurityToken {
    return {
      id: r.id, label: r.label ?? '', purposes: parse<TokenPurpose[]>(r.purposes, []), branchId: r.branch_id ?? null, forUserId: r.for_user_id ?? null,
      createdBy: r.created_by ?? '', createdAt: r.created_at ?? '', expiresAt: r.expires_at, revokedAt: r.revoked_at ?? null,
      maxUses: r.max_uses ?? null, usedCount: r.used_count ?? 0, salt: r.salt, hash: r.hash,
    };
  }

  /** Tokens descargados en el último pull (solo hashes; el código nunca llega al dispositivo). */
  async listCachedTokens(): Promise<CachedSecurityToken[]> {
    return (await this.db.all<any>('SELECT * FROM security_tokens_cache ORDER BY expires_at DESC')).map((r) => this.rowToToken(r));
  }

  /**
   * Usos de un token que este dispositivo ya hizo pero el servidor aún no refleja en `used_count`:
   * operaciones pendientes y las confirmadas después de bajar la caché.
   */
  private async pendingTokenUses(db: RawDb, tokenId: string): Promise<number> {
    const r = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_queue WHERE instr(payload_json, ?) > 0
         AND (status = 'pendiente' OR (status IN ('enviada','conflicto') AND received_at > COALESCE((SELECT MAX(fetched_at) FROM security_tokens_cache), '')))`,
      [`"tokenId":"${tokenId}"`],
    );
    return r?.n ?? 0;
  }

  private async userName(db: RawDb, id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    return (await db.get<{ name: string }>('SELECT name FROM users_local WHERE id = ?', [id]))?.name ?? null;
  }

  /**
   * Comprueba SIN conexión un código de token o la contraseña de un gerente.
   * - Token: contra los hashes descargados (vigencia, propósito, sucursal, usuario, revocación y máximo de usos,
   *   descontando los usos locales aún no confirmados).
   * - Contraseña: contra los verificadores de los gerentes de la sucursal bajados en el último pull.
   * Si no puede comprobarlo, DENIEGA. Nunca guarda la contraseña ni el código.
   * Devuelve la `authorization` que debe pasarse a closeCash / cancelSale / refundSale / registerSale.
   */
  async verifyActionAuthorization(input: VerifyAuthorizationInput): Promise<VerifyAuthorizationResult> {
    const at = this.nowIso();
    const hasCode = typeof input.code === 'string' && input.code.trim() !== '';
    const hasPassword = typeof input.adminPassword === 'string' && input.adminPassword !== '';
    if (!hasCode && !hasPassword) {
      return { ok: false, reason: 'datos_faltantes', message: 'Escribe el código del token o la contraseña de un administrador' };
    }

    if (hasCode) {
      const cached = await this.listCachedTokens();
      const withUses: CachedSecurityToken[] = [];
      for (const t of cached) withUses.push(t.maxUses === null ? t : { ...t, usedCount: t.usedCount + (await this.pendingTokenUses(this.db, t.id)) });
      const r = verifyTokenCodeLocal(input.code!, withUses, input.purpose, input.branchId, at, input.userId);
      if (r.ok) {
        return {
          ok: true, authorization: { kind: 'token', tokenId: r.token.id }, authorizedBy: r.token.createdBy || null,
          authorizedByName: await this.userName(this.db, r.token.createdBy), expiresAt: r.token.expiresAt, tokenLabel: r.token.label || null,
        };
      }
      if (!hasPassword) return { ok: false, reason: r.reason, message: tokenDenyMessage(r.reason) };
    }

    const rows = input.adminUserId
      ? await this.db.all<any>("SELECT * FROM users_local WHERE id = ? AND active = 1 AND role = 'gerente'", [input.adminUserId])
      : await this.db.all<any>("SELECT * FROM users_local WHERE active = 1 AND role = 'gerente'");
    const admins = rows.filter((u) => parse<string[]>(u.branch_ids_json, []).includes(input.branchId));
    if (admins.length === 0) return { ok: false, reason: 'sin_administrador', message: 'No hay un administrador activo de esta sucursal en este dispositivo' };
    const withVerifier = admins.filter((u) => !!u.verifier);
    if (withVerifier.length === 0) {
      return { ok: false, reason: 'sin_verificador', message: 'Este dispositivo aún no puede validar la contraseña sin internet. Conéctate una vez para descargarla.' };
    }
    for (const u of withVerifier) {
      let match = false;
      try {
        match = await this.verifyPw(input.adminPassword!, u.verifier);
      } catch {
        match = false; // verificador corrupto: no autoriza
      }
      if (match) {
        return { ok: true, authorization: { kind: 'admin_password', adminUserId: u.id }, authorizedBy: u.id, authorizedByName: u.name, expiresAt: null, tokenLabel: null };
      }
    }
    return { ok: false, reason: 'contrasena_incorrecta', message: 'Contraseña de administrador incorrecta' };
  }

  /**
   * Revalida una autorización ya obtenida (no puede volver a comprobar la contraseña: nunca se guarda).
   * `trusted` = el servidor la validó en línea hace instantes, aunque el token no esté en la caché local.
   */
  private async checkAuthorization(
    db: RawDb,
    auth: ActionAuthorization,
    purpose: TokenPurpose,
    branchId: string,
    userId: string,
    trusted: boolean,
  ): Promise<ResolvedAuthorization> {
    if (auth.kind === 'admin_password') {
      const u = await db.get<any>('SELECT * FROM users_local WHERE id = ?', [auth.adminUserId]);
      if (!u && trusted) return { authorization: { kind: 'admin_password', adminUserId: auth.adminUserId }, authorizedBy: auth.adminUserId };
      if (!u || !u.active || u.role !== 'gerente' || !parse<string[]>(u.branch_ids_json, []).includes(branchId)) {
        throw new StoreError('autorizacion_invalida', 'El administrador que autoriza no está activo en esta sucursal');
      }
      return { authorization: { kind: 'admin_password', adminUserId: u.id }, authorizedBy: u.id };
    }
    if (auth.kind === 'token') {
      const row = await db.get<any>('SELECT * FROM security_tokens_cache WHERE id = ?', [auth.tokenId]);
      if (!row) {
        if (trusted) return { authorization: { kind: 'token', tokenId: auth.tokenId }, authorizedBy: null };
        throw new StoreError('autorizacion_invalida', 'Este dispositivo no conoce ese token. Sincroniza o verifícalo en línea.');
      }
      const token = this.rowToToken(row);
      if (!trusted) {
        if (token.maxUses !== null) token.usedCount += await this.pendingTokenUses(db, token.id);
        if (!isTokenActive(token, purpose, branchId, this.nowIso(), userId)) {
          throw new StoreError('autorizacion_invalida', 'El token ya no es válido para esta acción (vencido, revocado, agotado o de otro propósito/sucursal)');
        }
      }
      return { authorization: { kind: 'token', tokenId: token.id }, authorizedBy: token.createdBy || null };
    }
    throw new StoreError('autorizacion_invalida', 'Autorización inválida');
  }

  /**
   * Autorización de una acción sensible:
   *  - El gerente (tiene el permiso) NO necesita autorización: su identidad queda como authorizedBy.
   *  - El vendedor SIEMPRE necesita contraseña de administrador o token con el propósito correcto.
   *  - Cualquier otro rol: sin permiso.
   */
  private async resolveSensitive(
    tx: RawDb,
    p: { actor: Actor; permission: Parameters<typeof can>[1]; purpose: TokenPurpose; branchId: string; authorization?: ActionAuthorization; trusted?: boolean; denied: string },
  ): Promise<ResolvedAuthorization> {
    if (can(p.actor.role, p.permission)) {
      if (p.authorization) return this.checkAuthorization(tx, p.authorization, p.purpose, p.branchId, p.actor.userId, !!p.trusted);
      return { authorization: { kind: 'admin_password', adminUserId: p.actor.userId }, authorizedBy: p.actor.userId };
    }
    if (p.actor.role !== 'vendedor') throw new StoreError('sin_permiso', p.denied);
    if (!p.authorization) {
      throw new StoreError('autorizacion_requerida', 'Se necesita la contraseña de un administrador o un token de seguridad para continuar', { purpose: p.purpose });
    }
    return this.checkAuthorization(tx, p.authorization, p.purpose, p.branchId, p.actor.userId, !!p.trusted);
  }

  /** Busca por código de barras, código interno o QR. Devuelve existencia local de la sucursal. */
  async findByCode(code: string, branchId: string): Promise<CatalogHit[]> {
    const clean = code.trim();
    if (!clean) return [];
    const qrId = parseQrValue(clean);
    return this.db.all<CatalogHit>(
      `${HIT_SELECT} WHERE v.status = 'activo' AND p.status = 'activo'
         AND (v.barcode = ? OR UPPER(v.internal_code) = UPPER(?) OR v.id = ?) ORDER BY p.name`,
      [branchId, branchId, clean, clean, qrId ?? '__none__'],
    );
  }

  /** Código existente aunque el producto esté archivado (para validar duplicados en altas). */
  async codeExists(code: string): Promise<boolean> {
    const r = await this.db.get('SELECT 1 AS x FROM variants WHERE barcode = ? OR UPPER(internal_code) = UPPER(?)', [code.trim(), code.trim()]);
    return !!r;
  }

  async search(text: string, branchId: string, limit = 50): Promise<CatalogHit[]> {
    const like = `%${text.trim().replace(/[%_]/g, '')}%`;
    return this.db.all<CatalogHit>(
      `${HIT_SELECT} WHERE v.status = 'activo' AND p.status = 'activo'
         AND (p.name LIKE ? OR p.category LIKE ? OR p.type LIKE ? OR p.sku LIKE ? OR v.label LIKE ? OR v.barcode LIKE ? OR v.internal_code LIKE ?)
       ORDER BY p.name, v.label LIMIT ?`,
      [branchId, branchId, like, like, like, like, like, like, like, limit],
    );
  }

  async inventoryList(opts: { branchId: string; text?: string; filter?: 'todos' | 'agotados' | 'bajos'; limit?: number; offset?: number }): Promise<CatalogHit[]> {
    const like = `%${(opts.text ?? '').trim().replace(/[%_]/g, '')}%`;
    const rows = await this.db.all<CatalogHit>(
      `SELECT * FROM (${HIT_SELECT} WHERE p.status = 'activo' AND v.status = 'activo'
         AND (p.name LIKE ? OR p.category LIKE ? OR p.sku LIKE ? OR v.label LIKE ? OR v.barcode LIKE ? OR v.internal_code LIKE ?))
       WHERE (? = 'todos') OR (? = 'agotados' AND qty <= 0) OR (? = 'bajos' AND qty > 0 AND qty <= minStock)
       ORDER BY productName, label LIMIT ? OFFSET ?`,
      [opts.branchId, opts.branchId, like, like, like, like, like, like, opts.filter ?? 'todos', opts.filter ?? 'todos', opts.filter ?? 'todos', opts.limit ?? 200, opts.offset ?? 0],
    );
    return rows;
  }

  async stockQty(variantId: string, branchId: string): Promise<number> {
    const r = await this.db.get<{ qty: number }>(
      `SELECT (COALESCE((SELECT base_qty FROM stock WHERE variant_id = ? AND branch_id = ?), 0)
        + COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE variant_id = ? AND branch_id = ? AND synced = 0), 0)) AS qty`,
      [variantId, branchId, variantId, branchId],
    );
    return r?.qty ?? 0;
  }

  // ───────────────────────── Cola de sincronización ─────────────────────────

  private async enqueue(
    tx: RawDb,
    op: { opId: string; type: SyncOp['type']; branchId: string; terminalId: string; userId: string; localTs: string; payload: unknown; origin?: 'local' | 'lan' },
  ): Promise<void> {
    await tx.run(
      `INSERT INTO sync_queue (op_id, type, branch_id, terminal_id, user_id, local_ts, payload_json, origin, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [op.opId, op.type, op.branchId, op.terminalId, op.userId, op.localTs, j(op.payload), op.origin ?? 'local', this.nowIso()],
    );
  }

  private async audit(
    tx: RawDb,
    a: { userId?: string | null; action: string; entity?: string; entityId?: string; branchId?: string; terminalId?: string; detail?: unknown },
  ): Promise<void> {
    await tx.run(
      'INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, branch_id, terminal_id, detail_json) VALUES (?,?,?,?,?,?,?,?,?)',
      [newId(), this.nowIso(), a.userId ?? null, a.action, a.entity ?? null, a.entityId ?? null, a.branchId ?? null, a.terminalId ?? null, a.detail ? j(a.detail) : null],
    );
  }

  async pendingCount(): Promise<number> {
    return (await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pendiente'"))?.n ?? 0;
  }

  async nextPending(limit = 25): Promise<SyncOp[]> {
    const rows = await this.db.all<any>("SELECT * FROM sync_queue WHERE status = 'pendiente' ORDER BY seq LIMIT ?", [limit]);
    return rows.map((r) => ({
      opId: r.op_id, type: r.type, branchId: r.branch_id, terminalId: r.terminal_id, userId: r.user_id,
      localTs: r.local_ts, payload: parse(r.payload_json, null),
    }));
  }

  async listQueue(status?: string, limit = 200) {
    return this.db.all<any>(
      `SELECT seq, op_id AS opId, type, status, attempts, last_error AS lastError, received_at AS receivedAt, local_ts AS localTs, origin
       FROM sync_queue WHERE (? IS NULL OR status = ?) ORDER BY seq DESC LIMIT ?`,
      [status ?? null, status ?? null, limit],
    );
  }

  async markFailure(opId: string, error: string): Promise<void> {
    await this.db.run("UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE op_id = ? AND status = 'pendiente'", [error.slice(0, 500), opId]);
  }

  /** Aplica la confirmación del servidor a una operación. Es idempotente. */
  async markAck(res: SyncResult): Promise<void> {
    await this.db.transaction(async (tx) => {
      const op = await tx.get<any>('SELECT * FROM sync_queue WHERE op_id = ?', [res.opId]);
      // Idempotente: un acuse repetido (reintento tras corte de red) no se vuelve a aplicar.
      if (!op || op.status !== 'pendiente') return;
      const applied = res.status === 'applied' || res.status === 'duplicate' || res.status === 'conflict';
      const newStatus = res.status === 'rejected' ? 'rechazada' : res.status === 'conflict' ? 'conflicto' : 'enviada';
      await tx.run('UPDATE sync_queue SET status = ?, received_at = ?, ack_json = ?, last_error = ? WHERE op_id = ?', [
        newStatus, res.receivedAt, j(res), res.status === 'rejected' ? (res.detail ?? 'rechazada') : null, res.opId,
      ]);
      // Aplicada o rechazada: los movimientos locales dejan de sumarse a la base del servidor.
      // (Si fue rechazada, la existencia local vuelve a la verdad del servidor y se avisa al gerente.)
      await tx.run('UPDATE inventory_movements SET synced = 1 WHERE op_id = ?', [res.opId]);

      const payload = parse<any>(op.payload_json, {});
      const state = res.status === 'conflict' || res.status === 'rejected' ? 'conflicto' : 'sincronizada';
      if (op.type === 'sale.create' && payload?.sale?.id) await tx.run('UPDATE sales SET sync_state = ? WHERE id = ?', [state, payload.sale.id]);
      if (op.type === 'sale.adjust' && payload?.adjustment?.id) await tx.run('UPDATE sale_adjustments SET sync_state = ? WHERE id = ?', [state, payload.adjustment.id]);
      if (op.type === 'cash.close' && payload?.sessionId) {
        const rec = res.status === 'applied' || res.status === 'duplicate' ? 'conciliado' : 'con_diferencias';
        await tx.run('UPDATE cash_sessions SET reconciliation = ? WHERE id = ?', [rec, payload.sessionId]);
      }
      if (res.status === 'conflict' || res.status === 'rejected') {
        await tx.run(
          'INSERT INTO sync_conflicts (id, op_id, kind, detail_json, created_at) VALUES (?,?,?,?,?)',
          [newId(), res.opId, res.conflictKind ?? (res.status === 'rejected' ? 'rechazada' : 'conflicto'), j({ status: res.status, detail: res.detail, type: op.type }), this.nowIso()],
        );
      }
      void applied;
    });
  }

  async openConflicts() {
    return this.db.all<any>("SELECT * FROM sync_conflicts WHERE status = 'abierto' ORDER BY created_at DESC");
  }

  async setSyncOk(): Promise<void> {
    await this.setMeta('last_sync_ok_at', this.nowIso());
  }

  async syncStatus() {
    const [pending, rejected, conflicts, lastOk, lastPull] = await Promise.all([
      this.pendingCount(),
      this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'rechazada'"),
      this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_conflicts WHERE status = 'abierto'"),
      this.getMeta('last_sync_ok_at'),
      this.getMeta('last_pull_at'),
    ]);
    return { pending, rejected: rejected?.n ?? 0, openConflicts: conflicts?.n ?? 0, lastSyncOkAt: lastOk ?? null, lastPullAt: lastPull ?? null };
  }

  // ───────────────────────── Ventas ─────────────────────────

  private async currentSessionId(tx: RawDb, terminalId: string): Promise<string | null> {
    const r = await tx.get<{ id: string }>("SELECT id FROM cash_sessions WHERE terminal_id = ? AND status = 'abierta'", [terminalId]);
    return r?.id ?? null;
  }

  async currentSession(terminalId: string) {
    return this.db.get<any>("SELECT * FROM cash_sessions WHERE terminal_id = ? AND status = 'abierta'", [terminalId]);
  }

  async registerSale(input: RegisterSaleInput): Promise<RegisterSaleResult> {
    if (!can(input.actor.role, 'ventas.crear')) throw new StoreError('sin_permiso', 'No tienes permiso para vender');
    if ((input.discountCents ?? 0) > 0 || input.items.some((i) => (i.lineDiscountCents ?? 0) > 0)) {
      if (!can(input.actor.role, 'ventas.descuento')) throw new StoreError('sin_permiso', 'Solo el gerente puede aplicar descuentos');
    }
    const type: SaleType = input.type ?? 'venta';
    if (type !== 'venta' && type !== 'limpia') throw new StoreError('tipo_invalido', 'Tipo de venta desconocido');
    const device = await this.getDeviceInfo();
    if (!device) throw new StoreError('sin_configurar', 'La terminal no está configurada (sucursal/terminal)');

    return this.db.transaction(async (tx) => {
      // Idempotencia: la misma venta nunca se registra dos veces.
      const existing = await this.loadSale(tx, input.saleId);
      if (existing) return { sale: existing, duplicate: true, warnings: [] };

      // Limpias: el gerente entra libremente; el vendedor solo con contraseña de admin o token 'limpias'.
      let authz: ResolvedAuthorization | null = null;
      if (type === 'limpia') {
        authz = await this.resolveSensitive(tx, {
          actor: input.actor, permission: 'caja.corte', purpose: 'limpias', branchId: input.branchId,
          authorization: input.authorization, trusted: input.authorizationTrusted, denied: 'No tienes permiso para registrar Limpias',
        });
      }

      const sessionId = await this.currentSessionId(tx, input.terminalId);
      const requireOpen = ((await tx.get<{ value: string }>("SELECT value FROM meta WHERE key = 'require_open_cash'"))?.value ?? '1') !== '0';
      if (!sessionId && requireOpen) throw new StoreError('caja_cerrada', 'La caja está cerrada. Pide al gerente que la abra para vender.');

      // Precios y costos se toman del catálogo LOCAL en este instante (copia histórica).
      const lines: SaleLineInput[] = [];
      const snaps: { productName: string; variantLabel: string; sku: string; code: string; kind: SaleItemKind; extraNote: string | null }[] = [];
      const needed = new Map<string, { qty: number; name: string }>();
      for (const it of input.items) {
        const kind: SaleItemKind = it.kind ?? 'producto';
        if (kind !== 'producto' && kind !== 'extra') throw new StoreError('linea_invalida', 'Tipo de línea desconocido');
        const v = await tx.get<any>(
          `SELECT v.id, v.label, v.price_cents, v.cost_cents, v.barcode, v.internal_code, v.status AS vstatus, p.name, p.sku, p.status AS pstatus
           FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
          [it.variantId],
        );
        if (!v) throw new StoreError('producto_no_encontrado', 'Producto no encontrado en el catálogo local');
        if (v.vstatus !== 'activo' || v.pstatus !== 'activo') throw new StoreError('producto_archivado', `"${v.name}" está archivado y no se puede vender`);
        if (kind === 'extra') {
          // Cargo adicional sobre el producto: 1 pieza, costo 0 y SIN movimiento de inventario.
          if (it.qty !== 1) throw new StoreError('cantidad_invalida', 'Un extra siempre es de 1 unidad');
          if (!Number.isInteger(it.unitPriceCents) || (it.unitPriceCents as number) < 0) throw new StoreError('precio_invalido', 'Escribe el monto del extra (en centavos enteros, sin negativos)');
          lines.push({ variantId: v.id, qty: 1, unitPriceCents: it.unitPriceCents as number, unitCostCents: 0, lineDiscountCents: it.lineDiscountCents, kind: 'extra' });
          snaps.push({ productName: v.name, variantLabel: v.label, sku: v.sku, code: v.barcode ?? v.internal_code, kind: 'extra', extraNote: it.extraNote?.trim() || null });
        } else {
          lines.push({ variantId: v.id, qty: it.qty, unitPriceCents: v.price_cents, unitCostCents: v.cost_cents, lineDiscountCents: it.lineDiscountCents, kind: 'producto' });
          snaps.push({ productName: v.name, variantLabel: v.label, sku: v.sku, code: v.barcode ?? v.internal_code, kind: 'producto', extraNote: null });
          if (Number.isInteger(it.qty) && it.qty > 0) {
            const cur = needed.get(v.id) ?? { qty: 0, name: `${v.name} ${v.label}`.trim() };
            cur.qty += it.qty;
            needed.set(v.id, cur);
          }
        }
      }

      // v2: NUNCA se vende más de lo disponible conocido (ni se generan existencias negativas).
      for (const [variantId, need] of needed) {
        const avail = await this.stockQtyIn(tx, variantId, input.branchId);
        if (need.qty > avail) {
          const shown = Math.max(0, avail);
          throw new StoreError(
            'sin_existencia',
            shown === 0 ? `"${need.name}" no tiene existencia disponible` : `"${need.name}": solo hay ${shown} en existencia y se piden ${need.qty}`,
            { variantId, requested: need.qty, available: shown, rawAvailable: avail },
          );
        }
      }

      const calc = computeSale(lines, input.discountCents ?? 0, input.payments);
      const createdAt = this.nowIso();
      const day = mxDayKey(createdAt);
      const counterKey = `folio:${device.terminalCode}:${day}`;
      await tx.run('INSERT INTO counters (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING', [counterKey]);
      await tx.run('UPDATE counters SET value = value + 1 WHERE key = ?', [counterKey]);
      const seq = (await tx.get<{ value: number }>('SELECT value FROM counters WHERE key = ?', [counterKey]))!.value;
      const folio = buildFolio(device.branchCode, device.terminalCode, day, seq);

      const sellerId = input.sellerId ?? null;
      const sellerName = input.sellerName ?? (sellerId ? await this.userName(tx, sellerId) : null);

      const sale: Sale = {
        id: input.saleId, folio, branchId: input.branchId, terminalId: input.terminalId,
        userId: input.actor.userId, userName: input.actor.userName, cashSessionId: sessionId, createdAt,
        subtotalCents: calc.subtotalCents, discountCents: calc.discountCents, totalCents: calc.totalCents,
        tenderedCents: calc.tenderedCents, changeCents: calc.changeCents, status: 'completada',
        sellerId, sellerName, type,
        items: calc.lines.map((l, i) => ({
          id: `${input.saleId}:${i}`, variantId: l.variantId, productName: snaps[i]!.productName, variantLabel: snaps[i]!.variantLabel,
          sku: snaps[i]!.sku, code: snaps[i]!.code, qty: l.qty, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents,
          lineDiscountCents: l.lineDiscountCents, netCents: l.netCents, kind: snaps[i]!.kind, extraNote: snaps[i]!.extraNote,
        })),
        payments: calc.payments,
      };

      const opId = newId();
      await this.insertSaleRows(tx, sale, 'local', opId, authz?.authorization ?? null);
      const branchRow = await tx.get<{ name: string }>('SELECT name FROM branches WHERE id = ?', [input.branchId]);
      const ticket = this.ticketFromSale(sale, branchRow?.name ?? device.branchCode);
      await tx.run('INSERT INTO tickets (id, sale_id, folio, payload_json) VALUES (?,?,?,?)', [newId(), sale.id, folio, j(ticket)]);
      await this.enqueue(tx, {
        opId, type: 'sale.create', branchId: sale.branchId, terminalId: sale.terminalId, userId: sale.userId, localTs: createdAt,
        payload: authz ? { sale, authorization: authz.authorization } : { sale },
      });
      await this.audit(tx, {
        userId: sale.userId, action: type === 'limpia' ? 'venta.limpia' : 'venta.crear', entity: 'sale', entityId: sale.id, branchId: sale.branchId, terminalId: sale.terminalId,
        detail: { folio, totalCents: sale.totalCents, sellerId, type, ...(authz ? { authorization: authz.authorization, authorizedBy: authz.authorizedBy } : {}) },
      });
      return { sale, duplicate: false, warnings: [] };
    });
  }

  /** Existencia visible (base del servidor + movimientos locales pendientes) dentro de una transacción. */
  private async stockQtyIn(db: RawDb, variantId: string, branchId: string): Promise<number> {
    const r = await db.get<{ qty: number }>(
      `SELECT (COALESCE((SELECT base_qty FROM stock WHERE variant_id = ? AND branch_id = ?), 0)
        + COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE variant_id = ? AND branch_id = ? AND synced = 0), 0)) AS qty`,
      [variantId, branchId, variantId, branchId],
    );
    return r?.qty ?? 0;
  }

  /** Inserta venta, partidas, pagos y movimientos de inventario (usado por venta local y por réplica LAN). */
  private async insertSaleRows(tx: RawDb, sale: Sale, origin: 'local' | 'lan', opId: string, authorization: ActionAuthorization | null = null): Promise<void> {
    await tx.run(
      `INSERT INTO sales (id, folio, branch_id, terminal_id, user_id, user_name, cash_session_id, created_at, subtotal_cents, discount_cents, total_cents, tendered_cents, change_cents, status, origin,
                          seller_id, seller_name, sale_type, authorization_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sale.id, sale.folio, sale.branchId, sale.terminalId, sale.userId, sale.userName, sale.cashSessionId, sale.createdAt, sale.subtotalCents, sale.discountCents, sale.totalCents, sale.tenderedCents, sale.changeCents, sale.status, origin,
        sale.sellerId ?? null, sale.sellerName ?? null, sale.type ?? 'venta', authorization ? j(authorization) : null],
    );
    for (const [i, it] of sale.items.entries()) {
      const kind: SaleItemKind = it.kind ?? 'producto';
      await tx.run(
        `INSERT INTO sale_items (id, sale_id, variant_id, product_name, variant_label, sku, code, qty, unit_price_cents, unit_cost_cents, line_discount_cents, net_cents, kind, extra_note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [it.id, sale.id, it.variantId, it.productName, it.variantLabel, it.sku, it.code, it.qty, it.unitPriceCents, it.unitCostCents, it.lineDiscountCents, it.netCents, kind, it.extraNote ?? null],
      );
      if (kind === 'extra') continue; // un extra es solo un cargo: NO mueve inventario
      await tx.run(
        `INSERT INTO inventory_movements (id, variant_id, branch_id, delta, type, reason, ref_type, ref_id, user_id, created_at, op_id, synced)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        [`${sale.id}:m${i}`, it.variantId, sale.branchId, -it.qty, 'venta', `Venta ${sale.folio}`, 'sale', sale.id, sale.userId, sale.createdAt, opId],
      );
    }
    for (const [i, p] of sale.payments.entries()) {
      await tx.run('INSERT INTO sale_payments (id, sale_id, method, amount_cents, tendered_cents, change_cents) VALUES (?,?,?,?,?,?)', [
        `${sale.id}:p${i}`, sale.id, p.method, p.amountCents, p.tenderedCents ?? null, p.changeCents ?? null,
      ]);
    }
  }

  private async loadSale(tx: RawDb, id: string): Promise<Sale | undefined> {
    const s = await tx.get<any>('SELECT * FROM sales WHERE id = ?', [id]);
    return s ? this.hydrateSale(tx, s) : undefined;
  }

  private async hydrateSale(tx: RawDb, s: any): Promise<Sale> {
    // rowid conserva el orden de captura (ordenar por id de texto pondría ":10" antes de ":2").
    const items = await tx.all<any>('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid', [s.id]);
    const pays = await tx.all<any>('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY rowid', [s.id]);
    return {
      id: s.id, folio: s.folio, branchId: s.branch_id, terminalId: s.terminal_id, userId: s.user_id, userName: s.user_name,
      cashSessionId: s.cash_session_id, createdAt: s.created_at, subtotalCents: s.subtotal_cents, discountCents: s.discount_cents,
      totalCents: s.total_cents, tenderedCents: s.tendered_cents, changeCents: s.change_cents, status: s.status,
      sellerId: s.seller_id ?? null, sellerName: s.seller_name ?? null, type: (s.sale_type ?? 'venta') as SaleType,
      items: items.map((i) => ({
        id: i.id, variantId: i.variant_id, productName: i.product_name, variantLabel: i.variant_label, sku: i.sku, code: i.code, qty: i.qty,
        unitPriceCents: i.unit_price_cents, unitCostCents: i.unit_cost_cents, lineDiscountCents: i.line_discount_cents, netCents: i.net_cents,
        kind: (i.kind ?? 'producto') as SaleItemKind, extraNote: i.extra_note ?? null,
      })),
      payments: pays.map((p) => ({ method: p.method, amountCents: p.amount_cents, tenderedCents: p.tendered_cents ?? undefined, changeCents: p.change_cents ?? undefined })),
    };
  }

  async getSale(idOrFolio: string): Promise<Sale | undefined> {
    const s = await this.db.get<any>('SELECT * FROM sales WHERE id = ? OR folio = ?', [idOrFolio, idOrFolio]);
    return s ? this.hydrateSale(this.db, s) : undefined;
  }

  /** Archivo de tickets (solo gerente para ver todos; el vendedor pasa su userId). */
  async listSales(f: { from?: string; to?: string; branchId?: string; folio?: string; userId?: string; terminalId?: string; status?: string; type?: SaleType; limit?: number }) {
    return this.db.all<any>(
      `SELECT id, folio, branch_id AS branchId, terminal_id AS terminalId, user_id AS userId, user_name AS userName,
              seller_id AS sellerId, seller_name AS sellerName, sale_type AS type,
              created_at AS createdAt, total_cents AS totalCents, status, sync_state AS syncState, origin
       FROM sales WHERE (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?) AND (? IS NULL OR branch_id = ?)
         AND (? IS NULL OR folio LIKE ?) AND (? IS NULL OR user_id = ?) AND (? IS NULL OR terminal_id = ?) AND (? IS NULL OR status = ?)
         AND (? IS NULL OR sale_type = ?)
       ORDER BY created_at DESC LIMIT ?`,
      [f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, f.branchId ?? null, f.branchId ?? null,
        f.folio ?? null, `%${f.folio ?? ''}%`, f.userId ?? null, f.userId ?? null, f.terminalId ?? null, f.terminalId ?? null,
        f.status ?? null, f.status ?? null, f.type ?? null, f.type ?? null, f.limit ?? 500],
    );
  }

  /**
   * Tickets de hoy (hora de México) SOLO con lo vendido: producto, cantidad y precio. No es el ticket impreso.
   * Pensado para la consulta del gerente en el móvil. Más recientes primero.
   */
  async listTodaySalesSummary(opts: { branchId?: string | null; day?: string } = {}): Promise<TodaySaleSummary[]> {
    const day = opts.day ?? mxDayKey(this.nowIso());
    const { from, to } = mxDayBounds(day);
    const rows = await this.db.all<any>(
      'SELECT * FROM sales WHERE created_at >= ? AND created_at < ? AND (? IS NULL OR branch_id = ?) ORDER BY created_at DESC',
      [from, to, opts.branchId ?? null, opts.branchId ?? null],
    );
    const out: TodaySaleSummary[] = [];
    for (const r of rows) {
      const items = await this.db.all<any>('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid', [r.id]);
      out.push({
        saleId: r.id, folio: r.folio, createdAt: r.created_at, status: r.status, type: (r.sale_type ?? 'venta') as SaleType,
        sellerId: r.seller_id ?? null, sellerName: r.seller_name ?? null, totalCents: r.total_cents,
        items: items.map((i) => ({
          name: i.product_name, label: i.variant_label, qty: i.qty, unitPriceCents: i.unit_price_cents, netCents: i.net_cents,
          kind: (i.kind ?? 'producto') as SaleItemKind, extraNote: i.extra_note ?? null,
        })),
      });
    }
    return out;
  }

  async getTicket(idOrFolio: string): Promise<{ payload: TicketPayload; printCount: number; lastPrintError: string | null; saleId: string } | undefined> {
    const r = await this.db.get<any>('SELECT * FROM tickets WHERE sale_id = ? OR folio = ?', [idOrFolio, idOrFolio]);
    if (!r) return undefined;
    const payload = parse<TicketPayload>(r.payload_json, null as any);
    const sale = await this.db.get<{ status: string }>('SELECT status FROM sales WHERE id = ?', [r.sale_id]);
    return { payload: { ...payload, status: sale?.status ?? payload.status }, printCount: r.print_count, lastPrintError: r.last_print_error, saleId: r.sale_id };
  }

  async markPrinted(saleId: string, copies: ('cliente' | 'tienda')[]): Promise<void> {
    const now = this.nowIso();
    await this.db.run(
      `UPDATE tickets SET print_count = print_count + ?, last_print_error = NULL,
         printed_customer_at = CASE WHEN ? THEN ? ELSE printed_customer_at END,
         printed_store_at = CASE WHEN ? THEN ? ELSE printed_store_at END WHERE sale_id = ?`,
      [copies.length, copies.includes('cliente') ? 1 : 0, now, copies.includes('tienda') ? 1 : 0, now, saleId],
    );
  }

  async recordPrintFailure(saleId: string, error: string): Promise<void> {
    await this.db.run('UPDATE tickets SET last_print_error = ? WHERE sale_id = ?', [error.slice(0, 300), saleId]);
  }

  // ───────────────────── Cancelaciones y devoluciones ─────────────────────

  private async priorRefundedQty(tx: RawDb, saleId: string): Promise<Map<string, number>> {
    const rows = await tx.all<any>('SELECT items_json FROM sale_adjustments WHERE sale_id = ?', [saleId]);
    const m = new Map<string, number>();
    for (const r of rows) for (const it of parse<AdjustmentItem[]>(r.items_json, [])) m.set(it.saleItemId, (m.get(it.saleItemId) ?? 0) + it.qty);
    return m;
  }

  private async writeAdjustment(tx: RawDb, adj: SaleAdjustment, sale: Sale, folio: string, authz: ResolvedAuthorization): Promise<void> {
    await tx.run(
      `INSERT INTO sale_adjustments (id, sale_id, branch_id, terminal_id, user_id, type, created_at, reason, amount_cents, payments_json, items_json, cash_session_id, authorization_json, authorized_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [adj.id, adj.saleId, adj.branchId, adj.terminalId, adj.userId, adj.type, adj.createdAt, adj.reason, adj.amountCents, j(adj.payments), j(adj.items), adj.cashSessionId, j(authz.authorization), authz.authorizedBy],
    );
    const opId = newId();
    for (const [i, it] of adj.items.entries()) {
      if (!it.restock || it.kind === 'extra') continue; // un extra devuelve dinero, nunca existencias
      await tx.run(
        `INSERT INTO inventory_movements (id, variant_id, branch_id, delta, type, reason, ref_type, ref_id, user_id, created_at, op_id, synced)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        [`${adj.id}:m${i}`, it.variantId, adj.branchId, it.qty, 'devolucion', `${adj.type === 'cancelacion' ? 'Cancelación' : 'Devolución'} ${folio}`, 'adjustment', adj.id, adj.userId, adj.createdAt, opId],
      );
    }
    await this.enqueue(tx, { opId, type: 'sale.adjust', branchId: adj.branchId, terminalId: adj.terminalId, userId: adj.userId, localTs: adj.createdAt, payload: { adjustment: adj, authorization: authz.authorization } });
    await this.audit(tx, {
      userId: adj.userId, action: `venta.${adj.type}`, entity: 'sale', entityId: sale.id, branchId: adj.branchId, terminalId: adj.terminalId,
      detail: { folio, amountCents: adj.amountCents, reason: adj.reason, authorization: authz.authorization, authorizedBy: authz.authorizedBy },
    });
    void sale;
  }

  /**
   * Cancela una venta completa. El gerente no necesita `authorization`; el vendedor SIEMPRE la necesita
   * (contraseña de administrador o token con propósito 'cancelacion').
   */
  async cancelSale(p: {
    adjustmentId?: string; saleId: string; actor: Actor; terminalId: string; reason: string;
    authorization?: ActionAuthorization; authorizationTrusted?: boolean;
  }): Promise<SaleAdjustment> {
    if (p.actor.role !== 'gerente' && p.actor.role !== 'vendedor') throw new StoreError('sin_permiso', 'No tienes permiso para cancelar ventas');
    if (p.reason.trim().length < 3) throw new StoreError('motivo_requerido', 'Escribe el motivo de la cancelación');
    return this.db.transaction(async (tx) => {
      const sale = await this.loadSale(tx, p.saleId);
      if (!sale) throw new StoreError('venta_no_encontrada', 'Venta no encontrada');
      const authz = await this.resolveSensitive(tx, {
        actor: p.actor, permission: 'ventas.cancelar', purpose: 'cancelacion', branchId: sale.branchId,
        authorization: p.authorization, trusted: p.authorizationTrusted, denied: 'Solo el gerente puede cancelar ventas',
      });
      if (sale.status !== 'completada') throw new StoreError('ya_cancelada', 'La venta ya está cancelada');
      const prior = await this.priorRefundedQty(tx, sale.id);
      if (prior.size > 0) throw new StoreError('tiene_devoluciones', 'La venta ya tiene devoluciones; registra devoluciones para el resto');
      const sessionId = await this.currentSessionId(tx, p.terminalId);
      if (!sessionId && sale.payments.some((x) => x.method === 'efectivo')) {
        throw new StoreError('caja_cerrada', 'Abre la caja para devolver el efectivo de la cancelación');
      }
      const adj: SaleAdjustment = {
        id: p.adjustmentId ?? newId(), saleId: sale.id, branchId: sale.branchId, terminalId: p.terminalId, userId: p.actor.userId,
        type: 'cancelacion', createdAt: this.nowIso(), reason: p.reason.trim(), amountCents: sale.totalCents,
        payments: sale.payments.map((x) => ({ method: x.method, amountCents: x.amountCents })),
        items: sale.items.map((i) => ({
          saleItemId: i.id, variantId: i.variantId, productName: i.productName, variantLabel: i.variantLabel, qty: i.qty, unitCostCents: i.unitCostCents,
          netCents: i.netCents, restock: (i.kind ?? 'producto') !== 'extra', kind: i.kind ?? 'producto',
        })),
        cashSessionId: sessionId,
      };
      await this.writeAdjustment(tx, adj, sale, sale.folio, authz);
      await tx.run("UPDATE sales SET status = 'cancelada' WHERE id = ?", [sale.id]);
      return adj;
    });
  }

  /**
   * Devolución (total o parcial). El gerente no necesita `authorization`; el vendedor SIEMPRE la necesita
   * (contraseña de administrador o token con propósito 'devolucion').
   */
  async refundSale(p: {
    adjustmentId?: string; saleId: string; actor: Actor; terminalId: string; reason: string; method?: PaymentMethod;
    lines: { saleItemId: string; qty: number; restock?: boolean }[];
    authorization?: ActionAuthorization; authorizationTrusted?: boolean;
  }): Promise<SaleAdjustment> {
    if (p.actor.role !== 'gerente' && p.actor.role !== 'vendedor') throw new StoreError('sin_permiso', 'No tienes permiso para registrar devoluciones');
    if (p.reason.trim().length < 3) throw new StoreError('motivo_requerido', 'Escribe el motivo de la devolución');
    return this.db.transaction(async (tx) => {
      const sale = await this.loadSale(tx, p.saleId);
      if (!sale) throw new StoreError('venta_no_encontrada', 'Venta no encontrada');
      const authz = await this.resolveSensitive(tx, {
        actor: p.actor, permission: 'ventas.devolver', purpose: 'devolucion', branchId: sale.branchId,
        authorization: p.authorization, trusted: p.authorizationTrusted, denied: 'Solo el gerente puede registrar devoluciones',
      });
      if (sale.status !== 'completada') throw new StoreError('ya_cancelada', 'La venta está cancelada');
      const prior = await this.priorRefundedQty(tx, sale.id);
      const items: AdjustmentItem[] = [];
      let amount = 0;
      for (const l of p.lines) {
        const line = sale.items.find((i) => i.id === l.saleItemId);
        if (!line) throw new StoreError('partida_invalida', 'Partida no pertenece a la venta');
        let refund: number;
        try {
          refund = refundAmountForLine(line.netCents, line.qty, prior.get(line.id) ?? 0, l.qty);
        } catch {
          throw new StoreError('cantidad_invalida', `Cantidad a devolver inválida para ${line.productName}`);
        }
        prior.set(line.id, (prior.get(line.id) ?? 0) + l.qty);
        amount += refund;
        const isExtra = (line.kind ?? 'producto') === 'extra';
        items.push({
          saleItemId: line.id, variantId: line.variantId, productName: line.productName, variantLabel: line.variantLabel, qty: l.qty,
          unitCostCents: line.unitCostCents, netCents: refund, restock: isExtra ? false : l.restock !== false, kind: line.kind ?? 'producto',
        });
      }
      if (items.length === 0 || amount <= 0) throw new StoreError('sin_partidas', 'No hay partidas por devolver');
      const method = p.method ?? (sale.payments.some((x) => x.method === 'efectivo') ? 'efectivo' : sale.payments[0]!.method);
      const sessionId = await this.currentSessionId(tx, p.terminalId);
      if (method === 'efectivo' && !sessionId) throw new StoreError('caja_cerrada', 'Abre la caja para devolver efectivo');
      const adj: SaleAdjustment = {
        id: p.adjustmentId ?? newId(), saleId: sale.id, branchId: sale.branchId, terminalId: p.terminalId, userId: p.actor.userId,
        type: 'devolucion', createdAt: this.nowIso(), reason: p.reason.trim(), amountCents: amount,
        payments: [{ method, amountCents: amount }], items, cashSessionId: sessionId,
      };
      await this.writeAdjustment(tx, adj, sale, sale.folio, authz);
      return adj;
    });
  }

  // ───────────────────────── Movimientos de inventario ─────────────────────────

  async activeGrant(userId: string, branchId: string, fn: string, atIso: string): Promise<Grant | undefined> {
    const rows = await this.db.all<any>('SELECT * FROM grants_local WHERE seller_id = ? AND branch_id = ?', [userId, branchId]);
    for (const r of rows) {
      const g: Grant = { id: r.id, sellerId: r.seller_id, branchId: r.branch_id, functions: parse(r.functions_json, []), startsAt: r.starts_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, grantedBy: r.granted_by };
      if (isGrantActive(g, fn, branchId, atIso)) return g;
    }
    return undefined;
  }

  async registerMovement(p: {
    id: string; actor: Actor; branchId: string; terminalId: string; variantId: string;
    type: 'entrada' | 'salida' | 'ajuste' | 'conteo'; qty: number; reason: string; location?: string;
  }): Promise<{ duplicate: boolean; delta: number; newQty: number }> {
    if (p.reason.trim().length < 3) throw new StoreError('motivo_requerido', 'Escribe el motivo del movimiento');
    const at = this.nowIso();
    let grant: Grant | undefined;
    if (p.type === 'entrada' && !can(p.actor.role, 'inventario.mover')) {
      // El vendedor solo puede dar entradas con permiso temporal VIGENTE (se valida con la hora local).
      if (p.actor.role === 'vendedor') grant = await this.activeGrant(p.actor.userId, p.branchId, 'inventario.entrada', at);
      if (!grant) throw new StoreError('sin_permiso', 'No tienes permiso vigente para ingresar mercancía');
    } else if (p.type !== 'entrada' && !can(p.actor.role, 'inventario.mover')) {
      throw new StoreError('sin_permiso', 'No tienes permiso para modificar inventario');
    }
    if (!Number.isInteger(p.qty)) throw new StoreError('cantidad_invalida', 'La cantidad debe ser un entero');

    return this.db.transaction(async (tx) => {
      const dup = await tx.get<{ delta: number }>('SELECT delta FROM inventory_movements WHERE id = ?', [p.id]);
      const current = (await tx.get<{ qty: number }>(
        `SELECT (COALESCE((SELECT base_qty FROM stock WHERE variant_id = ? AND branch_id = ?), 0)
          + COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE variant_id = ? AND branch_id = ? AND synced = 0), 0)) AS qty`,
        [p.variantId, p.branchId, p.variantId, p.branchId],
      ))!.qty;
      if (dup) return { duplicate: true, delta: dup.delta, newQty: current };

      const v = await tx.get('SELECT 1 AS x FROM variants WHERE id = ?', [p.variantId]);
      if (!v) throw new StoreError('producto_no_encontrado', 'Variante no encontrada');
      let delta: number;
      if (p.type === 'entrada') {
        if (p.qty <= 0) throw new StoreError('cantidad_invalida', 'La entrada debe ser mayor a cero');
        delta = p.qty;
      } else if (p.type === 'salida') {
        if (p.qty <= 0) throw new StoreError('cantidad_invalida', 'La salida debe ser mayor a cero');
        delta = -p.qty;
      } else if (p.type === 'ajuste') {
        if (p.qty === 0) throw new StoreError('cantidad_invalida', 'El ajuste no puede ser cero');
        delta = p.qty;
      } else {
        if (p.qty < 0) throw new StoreError('cantidad_invalida', 'La cantidad contada no puede ser negativa');
        delta = p.qty - current; // conteo físico: se registra la DIFERENCIA, nunca se pisa la existencia
      }
      await tx.run('INSERT OR IGNORE INTO stock (variant_id, branch_id, base_qty, updated_at) VALUES (?,?,0,?)', [p.variantId, p.branchId, at]);
      if (p.location) await tx.run('UPDATE stock SET location = ? WHERE variant_id = ? AND branch_id = ?', [p.location, p.variantId, p.branchId]);
      const opId = newId();
      await tx.run(
        `INSERT INTO inventory_movements (id, variant_id, branch_id, delta, type, reason, ref_type, ref_id, user_id, authorized_by, grant_id, location, created_at, op_id, synced)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        [p.id, p.variantId, p.branchId, delta, p.type, p.reason.trim(), null, null, p.actor.userId, grant?.grantedBy ?? null, grant?.id ?? null, p.location ?? null, at, opId],
      );
      await this.enqueue(tx, {
        opId, type: 'stock.movement', branchId: p.branchId, terminalId: p.terminalId, userId: p.actor.userId, localTs: at,
        payload: { movement: { id: p.id, variantId: p.variantId, branchId: p.branchId, type: p.type, delta, reason: p.reason.trim(), location: p.location ?? null, grantId: grant?.id ?? null, authorizedBy: grant?.grantedBy ?? null, countedQty: p.type === 'conteo' ? p.qty : null, expectedQty: p.type === 'conteo' ? current : null } },
      });
      await this.audit(tx, { userId: p.actor.userId, action: `inventario.${p.type}`, entity: 'variant', entityId: p.variantId, branchId: p.branchId, terminalId: p.terminalId, detail: { delta, reason: p.reason, grantId: grant?.id } });
      return { duplicate: false, delta, newQty: current + delta };
    });
  }

  // ───────────────────────── Caja ─────────────────────────

  async openCash(p: { sessionId?: string; actor: Actor; branchId: string; terminalId: string; openingCents: number }) {
    if (!can(p.actor.role, 'caja.abrir')) throw new StoreError('sin_permiso', 'Solo el gerente puede abrir la caja');
    if (!Number.isInteger(p.openingCents) || p.openingCents < 0) throw new StoreError('importe_invalido', 'Fondo inicial inválido');
    return this.db.transaction(async (tx) => {
      const open = await this.currentSessionId(tx, p.terminalId);
      if (open) throw new StoreError('caja_abierta', 'Ya hay una caja abierta en esta terminal');
      const id = p.sessionId ?? newId();
      const at = this.nowIso();
      await tx.run('INSERT INTO cash_sessions (id, branch_id, terminal_id, opened_by, opened_at, opening_cents) VALUES (?,?,?,?,?,?)', [id, p.branchId, p.terminalId, p.actor.userId, at, p.openingCents]);
      await this.enqueue(tx, { opId: newId(), type: 'cash.open', branchId: p.branchId, terminalId: p.terminalId, userId: p.actor.userId, localTs: at, payload: { session: { id, branchId: p.branchId, terminalId: p.terminalId, openedBy: p.actor.userId, openedAt: at, openingCents: p.openingCents } } });
      await this.audit(tx, { userId: p.actor.userId, action: 'caja.abrir', entity: 'cash_session', entityId: id, branchId: p.branchId, terminalId: p.terminalId, detail: { openingCents: p.openingCents } });
      return id;
    });
  }

  async addCashMovement(p: { id?: string; actor: Actor; terminalId: string; type: CashMovementType; amountCents: number; concept: string }) {
    if (!can(p.actor.role, 'caja.movimientos')) throw new StoreError('sin_permiso', 'Solo el gerente puede registrar movimientos de caja');
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new StoreError('importe_invalido', 'Importe inválido');
    if (p.concept.trim().length < 3) throw new StoreError('motivo_requerido', 'Escribe el concepto');
    return this.db.transaction(async (tx) => {
      const s = await tx.get<any>("SELECT id, branch_id FROM cash_sessions WHERE terminal_id = ? AND status = 'abierta'", [p.terminalId]);
      if (!s) throw new StoreError('caja_cerrada', 'No hay caja abierta');
      const id = p.id ?? newId();
      const at = this.nowIso();
      await tx.run('INSERT INTO cash_movements (id, session_id, type, amount_cents, concept, user_id, created_at) VALUES (?,?,?,?,?,?,?)', [id, s.id, p.type, p.amountCents, p.concept.trim(), p.actor.userId, at]);
      await this.enqueue(tx, { opId: newId(), type: 'cash.movement', branchId: s.branch_id, terminalId: p.terminalId, userId: p.actor.userId, localTs: at, payload: { movement: { id, sessionId: s.id, type: p.type, amountCents: p.amountCents, concept: p.concept.trim(), userId: p.actor.userId, createdAt: at } } });
      await this.audit(tx, { userId: p.actor.userId, action: `caja.${p.type}`, entity: 'cash_session', entityId: s.id, branchId: s.branch_id, terminalId: p.terminalId, detail: { amountCents: p.amountCents, concept: p.concept } });
      return id;
    });
  }

  /** Cálculo del corte para una sesión (también se usa para la vista previa antes de confirmar). */
  async cashBreakdown(sessionId: string) {
    const s = await this.db.get<any>('SELECT * FROM cash_sessions WHERE id = ?', [sessionId]);
    if (!s) throw new StoreError('sesion_no_encontrada', 'Sesión de caja no encontrada');
    const sales = await this.db.all<any>('SELECT id, cash_session_id FROM sales WHERE cash_session_id = ?', [sessionId]);
    const salesFull = [];
    for (const r of sales) {
      const pays = await this.db.all<any>('SELECT method, amount_cents FROM sale_payments WHERE sale_id = ?', [r.id]);
      salesFull.push({ cashSessionId: r.cash_session_id as string, payments: pays.map((p) => ({ method: p.method as PaymentMethod, amountCents: p.amount_cents as number })) });
    }
    const adjs = (await this.db.all<any>('SELECT cash_session_id, payments_json FROM sale_adjustments WHERE cash_session_id = ?', [sessionId])).map((a) => ({
      cashSessionId: a.cash_session_id as string, payments: parse<{ method: PaymentMethod; amountCents: number }[]>(a.payments_json, []),
    }));
    const movs = (await this.db.all<any>('SELECT session_id, type, amount_cents FROM cash_movements WHERE session_id = ?', [sessionId])).map((m) => ({
      sessionId: m.session_id as string, type: m.type as CashMovementType, amountCents: m.amount_cents as number,
    }));
    return { session: s, breakdown: computeCashBreakdown(s.opening_cents, sessionId, salesFull, adjs, movs) };
  }

  /**
   * Corte de caja. v2: NO se puede cerrar sin autorización.
   *  - Gerente: su propia sesión es la autorización (queda como `closeAuthorization` y `authorizedBy`).
   *  - Vendedor: obligatoria `authorization` (contraseña de administrador o token 'cierre_caja').
   */
  async closeCash(p: {
    actor: Actor; terminalId: string; countedCents: number; denominations?: Record<string, number>; notes?: string; offline?: boolean;
    authorization?: ActionAuthorization; authorizationTrusted?: boolean;
  }) {
    if (p.actor.role !== 'gerente' && p.actor.role !== 'vendedor') throw new StoreError('sin_permiso', 'No tienes permiso para realizar el corte de caja');
    if (!Number.isInteger(p.countedCents) || p.countedCents < 0) throw new StoreError('importe_invalido', 'Efectivo contado inválido');
    const open = await this.currentSession(p.terminalId);
    if (!open) throw new StoreError('caja_cerrada', 'No hay caja abierta en esta terminal');
    const { breakdown } = await this.cashBreakdown(open.id);
    const pendingOthers = await this.pendingCount();
    const provisional = !!p.offline || pendingOthers > 0;
    const difference = cashDifference(breakdown.expectedCents, p.countedCents);
    const closedAt = this.nowIso();
    const closure = { breakdown, countedCents: p.countedCents, differenceCents: difference, denominations: p.denominations ?? null, provisional, pendingOpsAtClose: pendingOthers };
    const authz = await this.db.transaction(async (tx) => {
      const authz = await this.resolveSensitive(tx, {
        actor: p.actor, permission: 'caja.corte', purpose: 'cierre_caja', branchId: open.branch_id,
        authorization: p.authorization, trusted: p.authorizationTrusted, denied: 'No tienes permiso para realizar el corte de caja',
      });
      await tx.run(
        `UPDATE cash_sessions SET status = 'cerrada', closed_by = ?, closed_at = ?, counted_cents = ?, expected_cents = ?, difference_cents = ?,
           provisional = ?, reconciliation = 'pendiente', closure_json = ?, notes = ?, close_authorization_json = ?, close_authorized_by = ? WHERE id = ?`,
        [p.actor.userId, closedAt, p.countedCents, breakdown.expectedCents, difference, provisional ? 1 : 0, j(closure), p.notes ?? null, j(authz.authorization), authz.authorizedBy, open.id],
      );
      await this.enqueue(tx, {
        opId: newId(), type: 'cash.close', branchId: open.branch_id, terminalId: p.terminalId, userId: p.actor.userId, localTs: closedAt,
        payload: {
          sessionId: open.id, closedBy: p.actor.userId, closedAt, countedCents: p.countedCents, expectedCents: breakdown.expectedCents, differenceCents: difference,
          provisional, denominations: p.denominations ?? null, notes: p.notes ?? null, breakdown, authorization: authz.authorization,
        },
      });
      await this.audit(tx, {
        userId: p.actor.userId, action: 'caja.cerrar', entity: 'cash_session', entityId: open.id, branchId: open.branch_id, terminalId: p.terminalId,
        detail: { expected: breakdown.expectedCents, counted: p.countedCents, difference, provisional, authorization: authz.authorization, authorizedBy: authz.authorizedBy },
      });
      return authz;
    });
    return {
      sessionId: open.id, breakdown, countedCents: p.countedCents, expectedCents: breakdown.expectedCents, differenceCents: difference, provisional,
      openedAt: open.opened_at as string, openingCents: open.opening_cents as number, closedAt, closedBy: p.actor.userId,
      authorization: authz.authorization, authorizedBy: authz.authorizedBy,
    };
  }

  /** Un corte ya hecho (para el "ticket de cierre"): apertura, cierre, esperado, contado, diferencia y quién autorizó. */
  async getClosure(sessionId: string) {
    const r = await this.db.get<any>('SELECT * FROM cash_sessions WHERE id = ?', [sessionId]);
    if (!r) return undefined;
    return {
      id: r.id as string, branchId: r.branch_id as string, terminalId: r.terminal_id as string, status: r.status as 'abierta' | 'cerrada',
      openedBy: r.opened_by as string, openedAt: r.opened_at as string, openingCents: r.opening_cents as number,
      closedBy: (r.closed_by ?? null) as string | null, closedAt: (r.closed_at ?? null) as string | null,
      countedCents: (r.counted_cents ?? null) as number | null, expectedCents: (r.expected_cents ?? null) as number | null,
      differenceCents: (r.difference_cents ?? null) as number | null, provisional: !!r.provisional, reconciliation: r.reconciliation as string,
      closeAuthorization: parse<ActionAuthorization | null>(r.close_authorization_json, null), authorizedBy: (r.close_authorized_by ?? null) as string | null,
      authorizedByName: await this.userName(this.db, r.close_authorized_by),
      openedByName: await this.userName(this.db, r.opened_by), closedByName: await this.userName(this.db, r.closed_by),
      closure: parse<any>(r.closure_json, null), notes: (r.notes ?? null) as string | null,
    };
  }

  async listClosures(limit = 100) {
    const rows = await this.db.all<any>(
      `SELECT id, branch_id AS branchId, terminal_id AS terminalId, opened_at AS openedAt, opened_by AS openedBy, closed_at AS closedAt, closed_by AS closedBy,
              opening_cents AS openingCents, expected_cents AS expectedCents, counted_cents AS countedCents, difference_cents AS differenceCents,
              provisional, reconciliation, close_authorization_json AS closeAuthorizationJson, close_authorized_by AS authorizedBy
       FROM cash_sessions WHERE status = 'cerrada' ORDER BY closed_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(({ closeAuthorizationJson, ...r }) => ({ ...r, closeAuthorization: parse<ActionAuthorization | null>(closeAuthorizationJson, null) }));
  }

  // ───────────────────────── Resumen / estadísticas locales ─────────────────────────

  async loadReportData(from: string, to: string, branchId?: string | null): Promise<{ sales: ReportSale[]; adjustments: ReportAdjustment[] }> {
    const saleRows = await this.db.all<any>(
      'SELECT id, branch_id, created_at, total_cents FROM sales WHERE created_at >= ? AND created_at < ? AND (? IS NULL OR branch_id = ?)',
      [from, to, branchId ?? null, branchId ?? null],
    );
    const sales: ReportSale[] = [];
    for (const s of saleRows) {
      const items = await this.db.all<any>('SELECT variant_id, product_name, variant_label, qty, unit_cost_cents, net_cents, kind FROM sale_items WHERE sale_id = ?', [s.id]);
      const pays = await this.db.all<any>('SELECT method, amount_cents FROM sale_payments WHERE sale_id = ?', [s.id]);
      sales.push({
        id: s.id, branchId: s.branch_id, createdAt: s.created_at, totalCents: s.total_cents,
        payments: pays.map((p) => ({ method: p.method, amountCents: p.amount_cents })),
        items: items.map((i) => ({ variantId: i.variant_id, productName: i.product_name, variantLabel: i.variant_label, qty: i.qty, unitCostCents: i.unit_cost_cents, netCents: i.net_cents, kind: (i.kind ?? 'producto') as SaleItemKind })),
      });
    }
    const adjRows = await this.db.all<any>(
      'SELECT * FROM sale_adjustments WHERE created_at >= ? AND created_at < ? AND (? IS NULL OR branch_id = ?)',
      [from, to, branchId ?? null, branchId ?? null],
    );
    const adjustments: ReportAdjustment[] = adjRows.map((a) => ({
      id: a.id, saleId: a.sale_id, branchId: a.branch_id, type: a.type, createdAt: a.created_at, amountCents: a.amount_cents,
      payments: parse(a.payments_json, []), items: parse(a.items_json, []),
    }));
    return { sales, adjustments };
  }

  /**
   * Resumen con lo que ESTE dispositivo conoce. `localOnly` y `pendingOps` permiten a la
   * pantalla advertir que puede faltar información de otras terminales.
   */
  async summary(p: { from: string; to: string; branchId?: string | null }): Promise<{
    summary: SalesSummary; source: 'local'; pendingOps: number; lastSyncOkAt: string | null; mayBeIncomplete: boolean;
  }> {
    const { sales, adjustments } = await this.loadReportData(p.from, p.to, p.branchId);
    const status = await this.syncStatus();
    return { summary: summarizeSales(sales, adjustments, {}), source: 'local', pendingOps: status.pending, lastSyncOkAt: status.lastSyncOkAt, mayBeIncomplete: true };
  }

  // ───────────────────────── Réplica LAN (teléfono → PC) ─────────────────────────

  /** Recibe una venta de un teléfono vinculado. Conserva folio e id; idempotente. */
  async ingestRemoteSale(op: SyncOp): Promise<{ duplicate: boolean }> {
    const sale = (op.payload as { sale?: Sale } | null)?.sale;
    if (!sale || !sale.id || !sale.folio) throw new StoreError('payload_invalido', 'Venta remota inválida');
    return this.db.transaction(async (tx) => {
      if (await tx.get('SELECT 1 AS x FROM sales WHERE id = ?', [sale.id])) return { duplicate: true };
      if (await tx.get('SELECT 1 AS x FROM sync_queue WHERE op_id = ?', [op.opId])) return { duplicate: true };
      const authorization = (op.payload as { authorization?: ActionAuthorization } | null)?.authorization ?? null;
      await this.insertSaleRows(tx, sale, 'lan', op.opId, authorization);
      await tx.run('INSERT INTO tickets (id, sale_id, folio, payload_json) VALUES (?,?,?,?)', [newId(), sale.id, sale.folio, j(this.ticketFromSale(sale, sale.branchId))]);
      await this.enqueue(tx, { ...op, origin: 'lan' });
      await this.audit(tx, { userId: sale.userId, action: 'venta.replica_lan', entity: 'sale', entityId: sale.id, branchId: sale.branchId, terminalId: sale.terminalId, detail: { folio: sale.folio } });
      return { duplicate: false };
    });
  }

  private ticketFromSale(sale: Sale, branchName: string): TicketPayload {
    return {
      business: 'Esotérica Amara', branchName, folio: sale.folio, createdAt: sale.createdAt, userName: sale.userName,
      // El vendedor (sellerName) es dato interno: NO se imprime en el ticket.
      items: sale.items.map((i) => ({
        name: i.productName, label: i.variantLabel, qty: i.qty, unitPriceCents: i.unitPriceCents, netCents: i.netCents,
        kind: i.kind ?? 'producto', extraNote: i.extraNote ?? null,
      })),
      subtotalCents: sale.subtotalCents, discountCents: sale.discountCents, totalCents: sale.totalCents,
      payments: sale.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, tenderedCents: p.tenderedCents, changeCents: p.changeCents })),
      status: sale.status,
      saleType: sale.type ?? 'venta',
    };
  }

  // ───────────────────────── Respaldos ─────────────────────────

  /**
   * Copia CONSISTENTE de la base abierta (VACUUM INTO). El archivo destino no debe existir.
   * Nunca se sobrescribe un respaldo anterior.
   */
  async backupInto(path: string): Promise<void> {
    const esc = path.replace(/'/g, "''");
    await this.db.run(`VACUUM INTO '${esc}'`);
  }

  async logBackup(e: { kind: string; path?: string; ok: boolean; sizeBytes?: number; verified?: boolean; error?: string }): Promise<void> {
    await this.db.run('INSERT INTO backups_log (id, at, kind, path, ok, size_bytes, verified, error) VALUES (?,?,?,?,?,?,?,?)', [
      newId(), this.nowIso(), e.kind, e.path ?? null, e.ok ? 1 : 0, e.sizeBytes ?? null, e.verified ? 1 : 0, e.error ?? null,
    ]);
    if (e.ok) await this.setMeta(`last_backup_${e.kind}_at`, this.nowIso());
  }

  async listBackups(limit = 50) {
    return this.db.all<any>('SELECT id, at, kind, path, ok, size_bytes AS sizeBytes, verified, error FROM backups_log ORDER BY at DESC LIMIT ?', [limit]);
  }

  async auditRecent(limit = 200) {
    return this.db.all<any>('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?', [limit]);
  }
}
