/**
 * Manejadores IPC. REGLA: toda llamada se valida AQUÍ (sesión + permiso del rol) aunque la
 * interfaz ya oculte el botón. Los errores se devuelven en un sobre {ok:false, code, error}
 * con mensaje en español; los errores inesperados no filtran trazas a la pantalla.
 */
import { app, dialog, ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { StoreError } from '@amara/database';
import type { CatalogHit, RegisterSaleItem } from '@amara/database';
import {
  SaleValidationError, can, isExtraCategory, isTokenPurpose, mxDayBounds, mxRangeBounds, mxTodayKey, newId, normalizeTokenCode,
  sanitizeExtraCategories, sumDenominations,
} from '@amara/shared';
import type { ActionAuthorization, Permission, Sale, TokenPurpose } from '@amara/shared';
import { productCreateSchema } from '@amara/shared/schemas';
import type { DocActionResult, DocPreview, DocRequest, IpcChannel, IpcEnvelope, IpcFail, IpcMap, LabelBatch, SellerRow, SessionUser, TokenRowView } from '../shared/ipc.ts';
import { AttemptLimiter, AuthGrantStore } from '../shared/auth-grants.ts';
import type { AuthGrant } from '../shared/auth-grants.ts';
import type { PermitTicketData } from '../shared/permit-ticket.ts';
import { ALL_PURPOSES, clampLength, durationToMinutes } from '../shared/token-form.ts';
import { ApiError, apiRequest } from './api-client.ts';
import { AppError } from './errors.ts';
import { appendLog, readJsonSync, writeFileAtomic } from './fsutil.ts';
import type { MainCtx } from './context.ts';
import { normalizeApiUrl } from '../shared/settings.ts';

type Handler<K extends IpcChannel> = (req: IpcMap[K]['req'], user: SessionUser | null) => Promise<IpcMap[K]['res']> | IpcMap[K]['res'];

interface Opts {
  /** false = canal público (antes de iniciar sesión). Por omisión exige sesión. */
  auth?: boolean;
  /** Basta UNO de estos permisos. */
  anyOf?: Permission[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toFail(e: unknown, logFile: string): IpcFail {
  if (e instanceof AppError || e instanceof StoreError || e instanceof SaleValidationError) return { ok: false, code: e.code, error: e.message };
  if (e instanceof ApiError) return { ok: false, code: `api_${e.status}`, error: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  appendLog(logFile, `IPC error: ${e instanceof Error ? (e.stack ?? msg) : msg}`);
  return { ok: false, code: 'error', error: `Ocurrió un error inesperado: ${msg}` };
}

/** El vendedor nunca recibe costos del catálogo. */
function hideCosts(hits: CatalogHit[], role: string): CatalogHit[] {
  return role === 'gerente' ? hits : hits.map((h) => ({ ...h, costCents: 0 }));
}

/** El vendedor no recibe costos ni quién figura como vendedor (dato interno del gerente). */
function hideSaleCosts(sale: Sale, role: string): Sale {
  return role === 'gerente' ? sale : { ...sale, sellerId: null, sellerName: null, items: sale.items.map((i) => ({ ...i, unitCostCents: 0 })) };
}

const MAX_EXTRA_CENTS = 10_000_000;
const MAX_NOTE_LEN = 120;
const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

export function registerIpc(ctx: MainCtx): void {
  const logFile = join(ctx.paths.logsDir, 'errores.log');

  function on<K extends IpcChannel>(channel: K, opts: Opts, fn: Handler<K>): void {
    ipcMain.handle(channel, async (event, req: IpcMap[K]['req']): Promise<IpcEnvelope<IpcMap[K]['res']>> => {
      try {
        const win = ctx.getWindow();
        if (!win || event.sender.id !== win.webContents.id) throw new AppError('no_autorizado', 'Origen no autorizado.');
        const user = ctx.auth.current();
        if (opts.auth !== false) {
          if (!user) throw new AppError('sin_sesion', 'Inicia sesión para continuar.');
          if (opts.anyOf && !opts.anyOf.some((p) => can(user.role, p))) {
            throw new AppError('sin_permiso', 'No tienes permiso para esta acción.');
          }
        }
        return { ok: true, data: await fn(req, user) };
      } catch (e) {
        return toFail(e, logFile);
      }
    });
  }

  const device = async () => {
    const d = await ctx.store.getDeviceInfo();
    if (!d) throw new AppError('sin_activar', 'La terminal no está activada.');
    return d;
  };
  const isManager = (u: SessionUser | null) => !!u && can(u.role, 'config.editar');

  // ───────────── v2: autorizaciones de acciones sensibles ─────────────
  const grants = new AuthGrantStore();
  const attempts = new AttemptLimiter(5, 60_000);

  /**
   * Autorización de una acción sensible (defensa en profundidad: la interfaz también la pide, pero AQUÍ se exige).
   *  - Gerente: confirma SU contraseña (salvo `managerNeedsPassword: false`, p. ej. al registrar una Limpia).
   *  - Vendedor: necesita un boleto vigente de este usuario y de este propósito (contraseña de administrador o token).
   * El boleto se quema con `done()` SOLO cuando la acción ya se guardó.
   */
  async function sensitive(
    user: SessionUser,
    p: { permission: Permission; purpose: TokenPurpose; password?: string; ticket?: string; managerNeedsPassword?: boolean },
  ): Promise<{ authorization?: ActionAuthorization; trusted: boolean; done: () => void }> {
    if (can(user.role, p.permission)) {
      if (p.managerNeedsPassword !== false) await ctx.auth.reauth(String(p.password ?? ''));
      return { trusted: false, done: () => undefined };
    }
    if (user.role !== 'vendedor') throw new AppError('sin_permiso', 'No tienes permiso para esta acción.');
    const g = grants.peek(p.ticket, p.purpose, user.id);
    if (!g) {
      throw new AppError('autorizacion_requerida', 'Se necesita la contraseña de un administrador o un token de seguridad vigente para continuar. Vuelve a autorizar.');
    }
    return { authorization: g.authorization, trusted: g.trusted, done: () => grants.burn(p.ticket) };
  }

  /** Empleados que pueden figurar como vendedor: usuarios activos (vendedor o gerente) de la sucursal de esta terminal. */
  async function listSellers(current: SessionUser): Promise<SellerRow[]> {
    const d = await device();
    const rows = await ctx.store.db.all<{ id: string; name: string; role: string; branch_ids_json: string }>(
      "SELECT id, name, role, branch_ids_json FROM users_local WHERE active = 1 AND role IN ('vendedor','gerente') ORDER BY name COLLATE NOCASE",
    );
    const out: SellerRow[] = rows
      .filter((r) => {
        const b = safeArray(r.branch_ids_json);
        return b.length === 0 || b.includes(d.branchId);
      })
      .map((r) => ({ id: r.id, name: r.name, role: r.role === 'gerente' ? ('gerente' as const) : ('vendedor' as const) }));
    if (!out.some((r) => r.id === current.id) && (current.role === 'vendedor' || current.role === 'gerente')) {
      out.push({ id: current.id, name: current.name, role: current.role });
    }
    return out;
  }

  const userName = async (id: string | null): Promise<string | null> =>
    id ? ((await ctx.store.db.get<{ name: string }>('SELECT name FROM users_local WHERE id = ?', [id]))?.name ?? null) : null;

  /** Token para consultar al servidor (sesión en línea o, si no, el de la terminal). */
  const serverBearer = () => ctx.auth.apiToken() ?? ctx.secrets.getTerminalToken();

  // ───────────── App ─────────────
  on('app:info', { auth: false }, () => {
    const notice = ctx.startupNotice;
    ctx.startupNotice = null; // se muestra una sola vez
    return { version: app.getVersion(), dataDir: ctx.paths.dataDir, dbPath: ctx.paths.dbPath, platform: process.platform, startupNotice: notice };
  });

  on('app:openFolder', { anyOf: ['config.editar'] }, async ({ which }) => {
    const s = ctx.settings.get();
    const dir = which === 'data' ? ctx.paths.dataDir : which === 'backup' ? s.backupDir : s.backupSecondaryDir;
    if (!dir) throw new AppError('sin_carpeta', 'No hay una carpeta configurada.');
    mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new AppError('abrir_carpeta', err);
    return true as const;
  });

  // ───────────── Activación ─────────────
  on('device:get', { auth: false }, () => ctx.activation.deviceState());

  const guardReactivation = async (user: SessionUser | null) => {
    if ((await ctx.store.getDeviceInfo()) && !isManager(user)) {
      throw new AppError('sin_permiso', 'Para cambiar la terminal inicia sesión como gerente.');
    }
  };
  on('activation:options', { auth: false }, async (r, user) => {
    await guardReactivation(user);
    return ctx.activation.options(r.apiUrl, r.username, r.password);
  });
  on('activation:activate', { auth: false }, async (r, user) => {
    await guardReactivation(user);
    return ctx.activation.activate(r.branchId, r.terminalId);
  });
  on('activation:manual', { auth: false }, async (r, user) => {
    await guardReactivation(user);
    return ctx.activation.manual(r);
  });

  // ───────────── Sesión ─────────────
  on('auth:current', { auth: false }, () => ctx.auth.current());
  on('auth:login', { auth: false }, async (r) => {
    const u = await ctx.auth.login(String(r.username ?? ''), String(r.password ?? ''));
    ctx.sync.syncSoon(1500);
    return u;
  });
  on('auth:logout', { auth: false }, async () => {
    const u = ctx.auth.current();
    await ctx.auth.logout();
    if (u) grants.clearUser(u.id);
    return true as const;
  });
  on('auth:reauth', {}, async (r) => {
    await ctx.auth.reauth(String(r.password ?? ''));
    return true as const;
  });

  // ───────────── Ajustes ─────────────
  on('settings:get', { auth: false }, () => ctx.settings.get());
  on('settings:save', { anyOf: ['config.editar'] }, async (patch) => {
    const before = ctx.settings.get();
    const saved = ctx.settings.save(patch);
    if (before.lanEnabled !== saved.lanEnabled) {
      if (saved.lanEnabled) await ctx.lan.start();
      else await ctx.lan.stop();
    }
    return saved;
  });
  on('settings:pickFolder', { anyOf: ['config.editar'] }, async ({ title }) => {
    const win = ctx.getWindow();
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!;
  });

  on('settings:testApi', { anyOf: ['config.editar'] }, async ({ url }) => {
    const base = normalizeApiUrl(url);
    if (!base) return { ok: false, status: null, error: 'La dirección no es válida.' };
    try {
      await apiRequest(base, '/health', { timeoutMs: 8000 });
      return { ok: true, status: 200 };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, status: e.status, error: e.message };
      return { ok: false, status: null, error: 'No se pudo conectar con el servidor.' };
    }
  });

  // ───────────── Impresión ─────────────
  on('print:printers', { anyOf: ['config.editar'] }, () => ctx.print.listPrinters());
  on('print:test', { anyOf: ['config.editar'] }, ({ target }) => ctx.print.printTest(target === 'label' ? 'label' : 'ticket'));
  on('print:ticket', { anyOf: ['tickets.imprimir_propios', 'tickets.archivo'] }, async (r, user) => {
    const sale = await ctx.store.getSale(r.saleId);
    if (!sale) throw new AppError('venta_no_encontrada', 'Venta no encontrada.');
    if (!can(user!.role, 'tickets.archivo') && sale.userId !== user!.id) {
      throw new AppError('sin_permiso', 'Solo puedes imprimir tus propios tickets.');
    }
    const copies = (r.copies ?? []).filter((c) => c === 'cliente' || c === 'tienda');
    return ctx.print.printTicket(sale.id, { copies: copies.length ? copies : undefined, reprint: r.reprint });
  });
  on('print:labels', { anyOf: ['productos.ver'] }, (r) => {
    if (typeof r.html !== 'string' || r.html.length > 8_000_000) throw new AppError('datos_invalidos', 'Hoja de etiquetas inválida.');
    return ctx.print.printLabels(r.html, Number(r.widthMm), Number(r.heightMm));
  });

  // ───────────── Catálogo ─────────────
  on('catalog:lookup', { anyOf: ['productos.ver'] }, async ({ code }, user) => {
    const d = await device();
    return hideCosts(await ctx.store.findByCode(String(code ?? ''), d.branchId), user!.role);
  });
  on('catalog:search', { anyOf: ['productos.ver'] }, async ({ text }, user) => {
    const d = await device();
    return hideCosts(await ctx.store.search(String(text ?? ''), d.branchId, 40), user!.role);
  });
  on('catalog:inventory', { anyOf: ['inventario.ver'] }, async (r, user) => {
    const filter = r.filter === 'agotados' || r.filter === 'bajos' ? r.filter : 'todos';
    return hideCosts(await ctx.store.inventoryList({ branchId: r.branchId, text: r.text ?? '', filter, limit: 300 }), user!.role);
  });
  on('catalog:variants', { anyOf: ['productos.ver'] }, async ({ productId, branchId }) => {
    const rows = await ctx.store.db.all<{ variantId: string; label: string; barcode: string | null; internalCode: string; qrValue: string; priceCents: number; location: string | null }>(
      `SELECT id AS variantId, label, barcode, internal_code AS internalCode, qr_value AS qrValue, price_cents AS priceCents, location
       FROM variants WHERE product_id = ? AND status = 'activo' ORDER BY label`,
      [productId],
    );
    const out = [];
    for (const r of rows) out.push({ ...r, qty: await ctx.store.stockQty(r.variantId, branchId) });
    return out;
  });
  on('catalog:branches', {}, async (_r, user) => {
    const rows = await ctx.store.db.all<{ id: string; code: string; name: string; locations_json: string }>("SELECT id, code, name, locations_json FROM branches WHERE status = 'activa' ORDER BY name");
    const allowed = user!.branchIds;
    return rows
      .filter((b) => allowed.length === 0 || allowed.includes(b.id))
      .map((b) => ({ id: b.id, code: b.code, name: b.name, locations: safeArray(b.locations_json) }));
  });
  on('catalog:checkCode', { anyOf: ['productos.editar'] }, async ({ code }) => {
    const clean = String(code ?? '').trim();
    const existsLocal = await ctx.store.codeExists(clean);
    let existsRemote: boolean | null = null;
    const token = ctx.auth.apiToken();
    const apiUrl = ctx.settings.get().apiUrl;
    if (token && apiUrl && clean) {
      try {
        existsRemote = (await apiRequest<{ duplicate: boolean }>(apiUrl, `/catalog/codes/check?code=${encodeURIComponent(clean)}`, { token, timeoutMs: 6000 })).duplicate;
      } catch {
        existsRemote = null;
      }
    }
    return { existsLocal, existsRemote };
  });
  on('catalog:createProduct', { anyOf: ['productos.editar'] }, async (r) => {
    const token = ctx.auth.apiToken();
    const apiUrl = ctx.settings.get().apiUrl;
    if (!token || !apiUrl) {
      throw new AppError(
        'requiere_internet',
        'Dar de alta productos necesita conexión con el servidor. Cierra sesión y entra de nuevo con internet (el catálogo se administra en el servidor).',
      );
    }
    if (r.barcode && (await ctx.store.codeExists(r.barcode))) throw new AppError('codigo_duplicado', 'Ya existe un producto con ese código.');
    const parsed = productCreateSchema.safeParse({
      product: { name: r.name, type: r.type, category: r.category, sku: r.sku, brand: r.brand || undefined, description: r.description || undefined, specs: {} },
      variants: [{ label: r.variantLabel, unit: 'pieza', barcode: r.barcode || undefined, costCents: r.costCents, priceCents: r.priceCents, minStock: r.minStock, location: r.location || undefined }],
      initialStock: r.initialQty > 0 ? [{ variantIndex: 0, branchId: r.branchId, qty: r.initialQty, location: r.location || undefined }] : [],
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AppError('datos_invalidos', `Revisa los datos del producto: ${first ? `${first.path.join('.')} - ${first.message}` : 'formato inválido'}`);
    }
    try {
      await apiRequest(apiUrl, '/catalog/products', { method: 'POST', token, body: parsed.data, timeoutMs: 20_000 });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw new AppError('sesion_servidor', 'La sesión con el servidor venció. Cierra sesión y entra de nuevo con internet.');
      throw e;
    }
    await ctx.sync.runNow(); // baja el catálogo con el producto nuevo
    return { created: true as const };
  });

  // ───────────── Ventas ─────────────
  on('sales:create', { anyOf: ['ventas.crear'] }, async (r, user) => {
    if (typeof r.saleId !== 'string' || r.saleId.length < 8) throw new AppError('datos_invalidos', 'Falta el identificador de la venta.');
    if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > 200) throw new AppError('datos_invalidos', 'La venta no tiene productos.');
    if (r.type !== undefined && r.type !== 'venta' && r.type !== 'limpia') throw new AppError('datos_invalidos', 'Tipo de venta desconocido.');
    const type = r.type === 'limpia' ? 'limpia' : 'venta';
    const d = await device();

    // Quién vende: debe ser un empleado activo de la sucursal. El nombre se toma de la base local, no de la pantalla.
    const seller = (await listSellers(user!)).find((x) => x.id === r.sellerId);
    if (!seller) throw new AppError('vendedor_invalido', 'Elige quién vende (la lista de empleados de esta sucursal).');

    // Líneas: producto (qty entero) o extra (1 pieza, monto y nota). Un extra solo en categorías configuradas (o dentro de una Limpia).
    const extraCats = await ctx.store.getExtraCategories();
    const items: RegisterSaleItem[] = [];
    for (const i of r.items) {
      const variantId = String(i.variantId ?? '');
      if (!variantId) throw new AppError('datos_invalidos', 'Hay una línea sin producto.');
      if (i.kind === 'extra') {
        const cents = Number(i.unitPriceCents);
        const note = String(i.extraNote ?? '').trim().replace(/\s+/g, ' ');
        if (Number(i.qty) !== 1) throw new AppError('datos_invalidos', 'Un extra es siempre de 1 unidad.');
        if (!Number.isInteger(cents) || cents < 0 || cents > MAX_EXTRA_CENTS) throw new AppError('datos_invalidos', 'El monto del extra no es válido.');
        if (note.length < 2 || note.length > MAX_NOTE_LEN) throw new AppError('datos_invalidos', 'Escribe una nota para el extra (de 2 a 120 letras).');
        if (type !== 'limpia') {
          const cat = await ctx.store.db.get<{ category: string }>('SELECT p.category AS category FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?', [variantId]);
          if (!cat || !isExtraCategory(cat.category, extraCats)) {
            throw new AppError('extra_no_permitido', 'Ese producto no admite Extra (su categoría no está configurada para extras).');
          }
        }
        items.push({ variantId, qty: 1, kind: 'extra' as const, unitPriceCents: cents, extraNote: note });
      } else {
        const qty = Number(i.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new AppError('datos_invalidos', 'Hay una cantidad no válida.');
        items.push({ variantId, qty });
      }
    }

    // Limpias: el gerente entra libremente; el vendedor solo con contraseña de administrador o token 'limpias'.
    const auth =
      type === 'limpia'
        ? await sensitive(user!, { permission: 'caja.corte', purpose: 'limpias', ticket: r.ticket, managerNeedsPassword: false })
        : { authorization: undefined, trusted: false, done: () => undefined };

    // Las existencias las valida el almacén local dentro de la transacción: StoreError('sin_existencia') llega a la pantalla con su mensaje.
    const res = await ctx.store.registerSale({
      saleId: r.saleId,
      actor: ctx.auth.actor(),
      branchId: d.branchId,
      terminalId: d.terminalId,
      items,
      discountCents: Number(r.discountCents) || 0,
      payments: r.payments,
      sellerId: seller.id,
      sellerName: seller.name,
      type,
      authorization: auth.authorization,
      authorizationTrusted: auth.trusted,
    });
    auth.done();
    // La venta YA está en SQLite (COMMIT). Lo que sigue (sincronizar, imprimir) no puede deshacerla.
    ctx.sync.syncSoon();
    return { sale: hideSaleCosts(res.sale, user!.role), duplicate: res.duplicate, warnings: res.warnings };
  });

  on('sales:list', { anyOf: ['ventas.ver_propias', 'tickets.archivo'] }, async (r, user) => {
    if (!DAY_RE.test(r.fromDay) || !DAY_RE.test(r.toDay)) throw new AppError('datos_invalidos', 'Fecha inválida.');
    const { from, to } = mxRangeBounds(r.fromDay, r.toDay);
    const all = can(user!.role, 'tickets.archivo');
    const rows = await ctx.store.listSales({
      from, to,
      folio: r.folio?.trim() || undefined,
      status: r.status,
      userId: all ? r.userId || undefined : user!.id, // el vendedor SOLO ve lo propio
      terminalId: all ? r.terminalId || undefined : undefined,
      limit: 500,
    });
    return rows;
  });

  on('sales:detail', { anyOf: ['ventas.ver_propias', 'tickets.archivo'] }, async ({ id }, user) => {
    const sale = await ctx.store.getSale(id);
    if (!sale) throw new AppError('venta_no_encontrada', 'Venta no encontrada.');
    if (!can(user!.role, 'tickets.archivo') && sale.userId !== user!.id) throw new AppError('sin_permiso', 'Solo puedes ver tus propias ventas.');
    const ticket = await ctx.store.getTicket(sale.id);
    const adjRows = await ctx.store.db.all<{ id: string; type: 'cancelacion' | 'devolucion'; created_at: string; reason: string; amount_cents: number; items_json: string }>(
      'SELECT id, type, created_at, reason, amount_cents, items_json FROM sale_adjustments WHERE sale_id = ? ORDER BY created_at',
      [sale.id],
    );
    const returned: Record<string, number> = {};
    for (const a of adjRows) {
      for (const it of safeArray<{ saleItemId: string; qty: number }>(a.items_json)) returned[it.saleItemId] = (returned[it.saleItemId] ?? 0) + it.qty;
    }
    return {
      sale: hideSaleCosts(sale, user!.role),
      printCount: ticket?.printCount ?? 0,
      lastPrintError: ticket?.lastPrintError ?? null,
      returned,
      adjustments: adjRows.map((a) => ({ id: a.id, type: a.type, createdAt: a.created_at, reason: a.reason, amountCents: a.amount_cents })),
    };
  });

  /** Cancelar / devolver: el gerente confirma su contraseña; el vendedor (solo sus propias ventas) presenta un boleto de administrador o token. */
  const adjustableSale = async (saleId: string, user: SessionUser) => {
    const sale = await ctx.store.getSale(String(saleId));
    if (!sale) throw new AppError('venta_no_encontrada', 'Venta no encontrada.');
    if (!can(user.role, 'tickets.archivo') && sale.userId !== user.id) throw new AppError('sin_permiso', 'Solo puedes ajustar tus propias ventas.');
    return sale;
  };

  on('sales:cancel', {}, async (r, user) => {
    const sale = await adjustableSale(r.saleId, user!);
    const auth = await sensitive(user!, { permission: 'ventas.cancelar', purpose: 'cancelacion', password: r.password, ticket: r.ticket });
    const d = await device();
    const adj = await ctx.store.cancelSale({
      adjustmentId: r.adjustmentId || newId(), saleId: sale.id, actor: ctx.auth.actor(), terminalId: d.terminalId, reason: String(r.reason ?? ''),
      authorization: auth.authorization, authorizationTrusted: auth.trusted,
    });
    auth.done();
    ctx.sync.syncSoon();
    return adj;
  });

  on('sales:refund', {}, async (r, user) => {
    const sale = await adjustableSale(r.saleId, user!);
    const auth = await sensitive(user!, { permission: 'ventas.devolver', purpose: 'devolucion', password: r.password, ticket: r.ticket });
    const d = await device();
    const adj = await ctx.store.refundSale({
      adjustmentId: r.adjustmentId || newId(), saleId: sale.id, actor: ctx.auth.actor(), terminalId: d.terminalId,
      reason: String(r.reason ?? ''), method: r.method, lines: r.lines,
      authorization: auth.authorization, authorizationTrusted: auth.trusted,
    });
    auth.done();
    ctx.sync.syncSoon();
    return adj;
  });

  // ───────────── v2: empleados, autorización, extras ─────────────
  on('sellers:list', { anyOf: ['ventas.crear'] }, (_r, user) => listSellers(user!));

  on('catalog:categories', { anyOf: ['productos.ver'] }, async () =>
    (await ctx.store.db.all<{ category: string }>("SELECT DISTINCT category FROM products WHERE status = 'activo' AND category <> '' ORDER BY category COLLATE NOCASE")).map((r) => r.category),
  );

  on('security:verify', { anyOf: ['ventas.crear'] }, async (r, user) => {
    // El gerente confirma con SU contraseña en cada acción; este canal es para el vendedor.
    if (user!.role !== 'vendedor') throw new AppError('no_aplica', 'El gerente confirma con su propia contraseña.');
    if (!isTokenPurpose(r.purpose)) throw new AppError('datos_invalidos', 'Propósito de autorización desconocido.');
    const purpose = r.purpose;
    const code = String(r.code ?? '').trim().slice(0, 40);
    const adminPassword = String(r.adminPassword ?? '').slice(0, 200);
    if (!code && !adminPassword) throw new AppError('datos_faltantes', 'Escribe la contraseña de un administrador o el código de un token.');
    const key = `verify:${user!.id}`;
    const wait = attempts.blockedFor(key);
    if (wait > 0) throw new AppError('bloqueado', `Demasiados intentos fallidos. Espera ${wait} segundos e inténtalo de nuevo.`);
    const d = await device();

    const issue = (g: Omit<AuthGrant, 'userId' | 'purpose'>, online: boolean) => {
      attempts.reset(key);
      return { ticket: grants.issue({ ...g, userId: user!.id, purpose }), via: g.via, byName: g.byName, tokenLabel: g.tokenLabel, online };
    };

    // 1) En línea (si hay conexión y sesión): el servidor es la autoridad.
    const apiUrl = ctx.settings.get().apiUrl;
    const bearer = serverBearer();
    if (apiUrl && bearer && ctx.sync.state.online) {
      type VerifyRes = { ok: boolean; message?: string; authorization?: ActionAuthorization; authorizedByName?: string | null };
      try {
        const res = await apiRequest<VerifyRes>(apiUrl, '/security/verify', {
          method: 'POST', token: bearer, timeoutMs: 8000,
          body: code ? { code, purpose, branchId: d.branchId } : { adminPassword, purpose, branchId: d.branchId },
        });
        if (res.ok && res.authorization) {
          const a = res.authorization;
          return issue({ authorization: a, trusted: true, byName: res.authorizedByName ?? null, via: a.kind === 'token' ? 'token' : 'admin_password', tokenLabel: null }, true);
        }
        attempts.fail(key);
        throw new AppError('autorizacion_denegada', res.message || (code ? 'Código incorrecto' : 'Contraseña de administrador incorrecta'));
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (e instanceof ApiError && e.status === 429) throw new AppError('bloqueado', e.message);
        // Sin respuesta útil del servidor: se comprueba con la caché local de este equipo.
      }
    }

    // 2) Sin conexión: caché local de tokens y verificadores de administradores bajados en la última sincronización.
    const v = await ctx.store.verifyActionAuthorization({ code: code || undefined, adminPassword: code ? undefined : adminPassword, purpose, branchId: d.branchId, userId: user!.id });
    if (!v.ok) {
      attempts.fail(key);
      throw new AppError('autorizacion_denegada', v.message);
    }
    return issue({ authorization: v.authorization, trusted: false, byName: v.authorizedByName, via: v.authorization.kind === 'token' ? 'token' : 'admin_password', tokenLabel: v.tokenLabel }, false);
  });

  on('extras:get', {}, async () => ({ categories: await ctx.store.getExtraCategories() }));

  on('extras:set', { anyOf: ['config.editar'] }, async (r) => {
    if (!Array.isArray(r.categories)) throw new AppError('datos_invalidos', 'Lista de categorías inválida.');
    const clean = sanitizeExtraCategories(r.categories.map(String));
    let categories = clean;
    let savedOnServer = false;
    const apiUrl = ctx.settings.get().apiUrl;
    const token = ctx.auth.apiToken();
    if (apiUrl && token) {
      try {
        const res = await apiRequest<{ categories: string[] }>(apiUrl, '/settings/extra-categories', { method: 'PUT', token, body: { categories: clean }, timeoutMs: 10_000 });
        categories = Array.isArray(res.categories) ? res.categories : clean;
        savedOnServer = true;
      } catch (e) {
        // Un rechazo del servidor (permiso, datos) se muestra; solo una falla de red permite guardar la copia local.
        if (!(e instanceof Error) || (e instanceof ApiError && e.status < 500 && e.status !== 408)) throw e;
      }
    }
    // Copia local (la que usa el botón Extra de esta terminal). Si no hubo conexión, la próxima sincronización la reemplaza con la del servidor.
    await ctx.store.db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('extraCategories', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [JSON.stringify(categories), new Date().toISOString()],
    );
    return { categories, savedOnServer };
  });

  // ───────────── v2: tokens de seguridad (gerente, EN LÍNEA) ─────────────
  const onlineSession = () => {
    const apiUrl = ctx.settings.get().apiUrl;
    const token = ctx.auth.apiToken();
    if (!apiUrl || !token) {
      throw new AppError('requiere_internet', 'Los tokens se administran en el servidor. Cierra sesión y entra de nuevo con internet para usarlos.');
    }
    return { apiUrl, token };
  };

  on('tokens:list', { anyOf: ['config.editar'] }, async () => {
    const { apiUrl, token } = onlineSession();
    const res = await apiRequest<{ items?: TokenRowView[] } | TokenRowView[]>(apiUrl, '/security/tokens', { token, timeoutMs: 12_000 });
    const items = Array.isArray(res) ? res : (res.items ?? []);
    return items.map((t) => ({
      id: t.id, label: t.label, purposes: t.purposes, branchId: t.branchId ?? null, forUserId: t.forUserId ?? null, createdBy: t.createdBy,
      createdAt: t.createdAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt ?? null, maxUses: t.maxUses ?? null, usedCount: t.usedCount ?? 0, status: t.status,
    }));
  });

  on('tokens:create', { anyOf: ['config.editar'] }, async (r, user) => {
    const { apiUrl, token } = onlineSession();
    const label = String(r.label ?? '').trim().replace(/\s+/g, ' ');
    if (label.length < 2 || label.length > 80) throw new AppError('datos_invalidos', 'El nombre del token debe tener de 2 a 80 letras.');
    const purposes = ALL_PURPOSES.filter((p) => Array.isArray(r.purposes) && r.purposes.includes(p));
    if (purposes.length === 0) throw new AppError('datos_invalidos', 'Elige al menos un propósito.');
    const dur = durationToMinutes(String(r.durationMinutes), 'minutos');
    if (!dur.ok) throw new AppError('datos_invalidos', dur.error);
    if (r.branchId && !user!.branchIds.includes(r.branchId) && user!.branchIds.length > 0) throw new AppError('sucursal_no_permitida', 'No tienes acceso a esa sucursal.');
    const maxUses = r.maxUses === null || r.maxUses === undefined ? null : Number(r.maxUses);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000)) throw new AppError('datos_invalidos', 'Los usos máximos no son válidos.');
    // Confirmación de contraseña: primero aquí (sin internet no hay token), luego el servidor emite el permiso de reautenticación.
    await ctx.auth.reauth(String(r.password ?? ''));
    const reauth = await apiRequest<{ token: string }>(apiUrl, '/auth/reauth', { method: 'POST', token, body: { password: String(r.password ?? '') }, timeoutMs: 10_000 });
    const created = await apiRequest<{ id: string; code: string; expiresAt: string }>(apiUrl, '/security/tokens', {
      method: 'POST', token, headers: { 'x-reauth': reauth.token }, timeoutMs: 12_000,
      body: {
        label, purposes, durationMinutes: dur.minutes, length: clampLength(Number(r.length)),
        ...(r.branchId ? { branchId: r.branchId } : {}), ...(r.forUserId ? { forUserId: r.forUserId } : {}), ...(maxUses !== null ? { maxUses } : {}),
      },
    });
    if (!created.code) throw new AppError('respuesta_invalida', 'El servidor no devolvió el código del token.');
    ctx.sync.syncSoon(1500); // baja el token a la caché de este equipo
    return { id: created.id, code: created.code, expiresAt: created.expiresAt };
  });

  on('tokens:revoke', { anyOf: ['config.editar'] }, async ({ id }) => {
    const { apiUrl, token } = onlineSession();
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new AppError('datos_invalidos', 'Token inválido.');
    await apiRequest(apiUrl, `/security/tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST', token, timeoutMs: 10_000 });
    ctx.sync.syncSoon(1500);
    return true as const;
  });

  // ───────────── v2: vista previa e impresión de documentos ─────────────
  const saleForDoc = async (saleId: string, user: SessionUser) => {
    const sale = await ctx.store.getSale(String(saleId));
    if (!sale) throw new AppError('venta_no_encontrada', 'Venta no encontrada.');
    if (!can(user.role, 'tickets.archivo') && sale.userId !== user.id) throw new AppError('sin_permiso', 'Solo puedes imprimir tus propios tickets.');
    return sale;
  };

  const permitData = async (p: Extract<DocRequest, { kind: 'permit' }>['permit'], user: SessionUser): Promise<PermitTicketData> => {
    const code = normalizeTokenCode(String(p.code ?? ''));
    if (!/^[A-Z2-9]{4,10}$/.test(code)) throw new AppError('datos_invalidos', 'Código de token inválido.');
    const purposes = ALL_PURPOSES.filter((x) => Array.isArray(p.purposes) && p.purposes.includes(x));
    const created = Date.parse(String(p.createdAt));
    const expires = Date.parse(String(p.expiresAt));
    if (purposes.length === 0 || !Number.isFinite(created) || !Number.isFinite(expires) || expires <= created) throw new AppError('datos_invalidos', 'Datos del permiso inválidos.');
    const branchName = p.branchId ? ((await ctx.store.db.get<{ name: string }>('SELECT name FROM branches WHERE id = ?', [String(p.branchId)]))?.name ?? null) : null;
    return {
      business: 'Esotérica Amara', code, label: String(p.label ?? '').trim().slice(0, 80) || 'Permiso', purposes,
      createdAt: new Date(created).toISOString(), expiresAt: new Date(expires).toISOString(), branchName,
      forUserName: await userName(p.forUserId ? String(p.forUserId) : null),
      maxUses: p.maxUses === null || p.maxUses === undefined ? null : Number(p.maxUses), authorizedBy: user.name,
    };
  };

  const buildPreview = async (doc: DocRequest, user: SessionUser): Promise<DocPreview> => {
    if (doc.kind === 'ticket') {
      const sale = await saleForDoc(doc.saleId, user);
      return ctx.print.ticketPreview(sale.id);
    }
    if (doc.kind === 'closure') {
      if (!can(user.role, 'caja.corte')) throw new AppError('sin_permiso', 'Solo el gerente puede ver el ticket de cierre.');
      return ctx.print.closurePreview(String(doc.sessionId));
    }
    if (doc.kind === 'permit') {
      if (!can(user.role, 'config.editar')) throw new AppError('sin_permiso', 'Solo el gerente puede generar tickets de permiso.');
      return ctx.print.permitPreview(await permitData(doc.permit, user));
    }
    throw new AppError('datos_invalidos', 'Documento desconocido.');
  };

  on('print:preview', { anyOf: ['tickets.imprimir_propios', 'tickets.archivo'] }, (doc, user) => buildPreview(doc, user!));

  on('print:document', { anyOf: ['tickets.imprimir_propios', 'tickets.archivo'] }, async ({ doc, action }, user): Promise<DocActionResult> => {
    if (action !== 'print' && action !== 'pdf') throw new AppError('datos_invalidos', 'Acción desconocida.');
    if (action === 'print' && doc.kind === 'ticket') {
      // La venta ya está guardada: imprimir (o reimprimir) NUNCA crea otra venta. Siempre las DOS copias, una tras otra.
      const sale = await saleForDoc(doc.saleId, user!);
      return ctx.print.printTicket(sale.id, {});
    }
    const preview = await buildPreview(doc, user!);
    if (action === 'print') return ctx.print.printPages(preview.pages.map((p) => p.html));
    // PDF real (printToPDF en ventana oculta) + diálogo nativo de guardado.
    if (doc.kind === 'ticket') {
      const sale = await saleForDoc(doc.saleId, user!);
      const t = await ctx.print.ticketPdfHtml(sale.id);
      return { ok: true, printedCopies: [], savedPath: await ctx.print.savePdf(t.html, t.fileName, { widthMm: preview.paperMm }) };
    }
    const name = doc.kind === 'closure' ? `Cierre-de-caja-${mxTodayKey()}.pdf` : 'Ticket-de-permiso.pdf';
    return { ok: true, printedCopies: [], savedPath: await ctx.print.savePdf(preview.pages[0]!.html, name, { widthMm: preview.paperMm }) };
  });

  on('labels:savePdf', { anyOf: ['productos.ver'] }, async (r) => {
    if (typeof r.html !== 'string' || r.html.length > 8_000_000) throw new AppError('datos_invalidos', 'Hoja de etiquetas inválida.');
    const w = Number(r.widthMm);
    const h = Number(r.heightMm);
    if (!(w >= 10 && w <= 300 && h >= 10 && h <= 300)) throw new AppError('datos_invalidos', 'Tamaño de etiqueta inválido.');
    return { savedPath: await ctx.print.savePdf(r.html, `Etiquetas-${mxTodayKey()}.pdf`, { widthMm: w, heightMm: h }) };
  });

  // ───────────── Inventario ─────────────
  on('inventory:permissions', {}, async (_r, user) => {
    const d = await device();
    const canMove = can(user!.role, 'inventario.mover');
    let grantExpiresAt: string | null = null;
    let canEnter = canMove;
    if (!canEnter && user!.role === 'vendedor') {
      const g = await ctx.store.activeGrant(user!.id, d.branchId, 'inventario.entrada', new Date().toISOString());
      if (g) {
        canEnter = true;
        grantExpiresAt = g.expiresAt;
      }
    }
    return { canView: can(user!.role, 'inventario.ver'), canEnter, canMove, canCreateProduct: can(user!.role, 'productos.editar'), grantExpiresAt };
  });

  on('inventory:move', { anyOf: ['inventario.ver'] }, async (r, user) => {
    const d = await device();
    if (user!.branchIds.length > 0 && !user!.branchIds.includes(r.branchId)) throw new AppError('sucursal_no_permitida', 'No tienes acceso a esa sucursal.');
    const res = await ctx.store.registerMovement({
      id: r.id, actor: ctx.auth.actor(), branchId: r.branchId, terminalId: d.terminalId, variantId: r.variantId,
      type: r.type, qty: Number(r.qty), reason: String(r.reason ?? ''), location: r.location?.trim() || undefined,
    });
    ctx.sync.syncSoon();
    return res;
  });

  // ───────────── Caja ─────────────
  on('cash:status', {}, async (_r, user) => {
    const d = await device();
    const s = await ctx.store.currentSession(d.terminalId);
    return {
      open: !!s,
      sessionId: s?.id ?? null,
      openedAt: s?.opened_at ?? null,
      openingCents: s && can(user!.role, 'caja.corte') ? (s.opening_cents as number) : null,
      openedByName: s ? await userName(s.opened_by as string) : null,
    };
  });
  on('cash:open', { anyOf: ['caja.abrir'] }, async ({ openingCents }) => {
    const d = await device();
    const sessionId = await ctx.store.openCash({ actor: ctx.auth.actor(), branchId: d.branchId, terminalId: d.terminalId, openingCents: Number(openingCents) });
    ctx.sync.syncSoon();
    return { sessionId };
  });
  on('cash:movement', { anyOf: ['caja.movimientos'] }, async (r) => {
    const d = await device();
    await ctx.store.addCashMovement({ actor: ctx.auth.actor(), terminalId: d.terminalId, type: r.type, amountCents: Number(r.amountCents), concept: String(r.concept ?? '') });
    ctx.sync.syncSoon();
    return true as const;
  });
  on('cash:breakdown', { anyOf: ['caja.corte'] }, async () => {
    const d = await device();
    const s = await ctx.store.currentSession(d.terminalId);
    if (!s) return null;
    const { breakdown } = await ctx.store.cashBreakdown(s.id);
    return { sessionId: s.id as string, openedAt: s.opened_at as string, openedByName: await userName(s.opened_by as string), breakdown };
  });
  /**
   * Cierre de caja. NO se puede cerrar sin autorización: el gerente confirma su contraseña; el vendedor (cierre a ciegas,
   * sin ver importes) presenta un boleto de contraseña de administrador o token 'cierre_caja'.
   */
  on('cash:close', {}, async (r, user) => {
    if (user!.role !== 'gerente' && user!.role !== 'vendedor') throw new AppError('sin_permiso', 'No tienes permiso para cerrar la caja.');
    const auth = await sensitive(user!, { permission: 'caja.corte', purpose: 'cierre_caja', password: r.password, ticket: r.ticket });
    const d = await device();
    const denoms = Object.fromEntries(Object.entries(r.denominations ?? {}).filter(([, q]) => q > 0));
    if (Object.keys(denoms).length > 0 && sumDenominations(denoms) !== r.countedCents) {
      throw new AppError('conteo_no_coincide', 'El total contado no coincide con el desglose de billetes y monedas.');
    }
    const res = await ctx.store.closeCash({
      actor: ctx.auth.actor(), terminalId: d.terminalId, countedCents: Number(r.countedCents),
      denominations: Object.keys(denoms).length ? denoms : undefined, notes: String(r.notes ?? '').slice(0, 300) || undefined,
      offline: !ctx.sync.state.online, authorization: auth.authorization, authorizationTrusted: auth.trusted,
    });
    auth.done();
    void ctx.backup.runNow('cierre'); // respaldo al cerrar la caja (en segundo plano)
    ctx.sync.syncSoon();
    const rec = await ctx.store.getClosure(res.sessionId);
    const redacted = !can(user!.role, 'caja.corte'); // el vendedor no ve esperado, contado ni diferencia
    return {
      sessionId: res.sessionId,
      expectedCents: redacted ? 0 : res.breakdown.expectedCents,
      countedCents: redacted ? 0 : res.countedCents,
      differenceCents: redacted ? 0 : res.differenceCents,
      provisional: res.provisional,
      closedAt: res.closedAt,
      authorizedByName: rec?.authorizedByName ?? null,
      redacted,
    };
  });
  on('cash:closures', { anyOf: ['caja.corte'] }, () => ctx.store.listClosures(60));
  on('cash:summaryToday', { anyOf: ['estadisticas.ver'] }, async () => {
    const d = await device();
    const { from, to } = mxDayBounds(mxTodayKey());
    const s = await ctx.store.summary({ from, to, branchId: d.branchId });
    return { summary: s.summary, pendingOps: s.pendingOps, mayBeIncomplete: s.mayBeIncomplete };
  });

  // ───────────── Sincronización ─────────────
  on('sync:state', {}, () => ctx.sync.state);
  on('sync:now', {}, () => ctx.sync.runNow());
  on('sync:queue', { anyOf: ['sync.estado'] }, async ({ status }) => {
    const rows = await ctx.store.listQueue(status || undefined, 200);
    return rows;
  });
  on('sync:conflicts', { anyOf: ['sync.estado'] }, async () => {
    const rows = await ctx.store.openConflicts();
    return rows.map((c: { id: string; op_id: string | null; kind: string; detail_json: string; created_at: string }) => ({
      id: c.id, opId: c.op_id, kind: c.kind, detail: safeJson(c.detail_json), createdAt: c.created_at,
    }));
  });

  // ───────────── Respaldos ─────────────
  on('backup:state', {}, () => ctx.backup.state);
  on('backup:now', { anyOf: ['respaldos.ver'] }, () => ctx.backup.runNow('manual'));
  on('backup:list', { anyOf: ['respaldos.ver'] }, () => ctx.store.listBackups(40));

  // ───────────── Teléfono (LAN) ─────────────
  on('lan:state', { anyOf: ['config.editar'] }, () => ctx.lan.state());
  on('lan:startPairing', { anyOf: ['config.editar'] }, ({ host }) => ctx.lan.startPairing(String(host ?? '')));
  on('lan:cancelPairing', { anyOf: ['config.editar'] }, () => ctx.lan.cancelPairing());
  on('lan:revoke', { anyOf: ['config.editar'] }, ({ deviceId }) => ctx.lan.revoke(String(deviceId ?? '')));
  on('lan:setEnabled', { anyOf: ['config.editar'] }, async ({ enabled }) => {
    ctx.settings.save({ lanEnabled: !!enabled });
    if (enabled) await ctx.lan.start();
    else await ctx.lan.stop();
    return ctx.lan.state();
  });

  // ───────────── Etiquetas ─────────────
  on('labels:history', {}, () => readJsonSync<LabelBatch[]>(ctx.paths.labelHistoryPath, []));
  on('labels:saveBatch', {}, async ({ items }) => {
    const clean = (Array.isArray(items) ? items : []).slice(0, 200).map((i) => ({
      variantId: String(i.variantId), code: String(i.code), productName: String(i.productName).slice(0, 120), label: String(i.label).slice(0, 60),
      priceCents: Number(i.priceCents) || 0, copies: Math.min(500, Math.max(1, Math.round(Number(i.copies) || 1))),
    }));
    if (clean.length === 0) throw new AppError('datos_invalidos', 'El lote está vacío.');
    const history = readJsonSync<LabelBatch[]>(ctx.paths.labelHistoryPath, []);
    const next = [{ id: newId(), at: new Date().toISOString(), items: clean }, ...history].slice(0, 50);
    await writeFileAtomic(ctx.paths.labelHistoryPath, JSON.stringify(next));
    return next;
  });
}

function safeArray<T = string>(json: string | null | undefined): T[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function safeJson(json: string | null | undefined): unknown {
  try {
    return JSON.parse(json ?? 'null');
  } catch {
    return null;
  }
}
