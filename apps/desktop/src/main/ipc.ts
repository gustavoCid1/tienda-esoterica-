/**
 * Manejadores IPC. REGLA: toda llamada se valida AQUÍ (sesión + permiso del rol) aunque la
 * interfaz ya oculte el botón. Los errores se devuelven en un sobre {ok:false, code, error}
 * con mensaje en español; los errores inesperados no filtran trazas a la pantalla.
 */
import { app, dialog, ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { StoreError } from '@amara/database';
import type { CatalogHit } from '@amara/database';
import {
  SaleValidationError, can, mxDayBounds, mxRangeBounds, mxTodayKey, newId, sumDenominations,
} from '@amara/shared';
import type { Permission, Sale } from '@amara/shared';
import { productCreateSchema } from '@amara/shared/schemas';
import type { IpcChannel, IpcEnvelope, IpcFail, IpcMap, LabelBatch, SessionUser } from '../shared/ipc.ts';
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

function hideSaleCosts(sale: Sale, role: string): Sale {
  return role === 'gerente' ? sale : { ...sale, items: sale.items.map((i) => ({ ...i, unitCostCents: 0 })) };
}

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
    await ctx.auth.logout();
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
    const d = await device();
    const res = await ctx.store.registerSale({
      saleId: r.saleId,
      actor: ctx.auth.actor(),
      branchId: d.branchId,
      terminalId: d.terminalId,
      items: r.items.map((i) => ({ variantId: String(i.variantId), qty: Number(i.qty) })),
      discountCents: Number(r.discountCents) || 0,
      payments: r.payments,
    });
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

  on('sales:cancel', { anyOf: ['ventas.cancelar'] }, async (r) => {
    await ctx.auth.reauth(String(r.password ?? ''));
    const d = await device();
    const adj = await ctx.store.cancelSale({ adjustmentId: r.adjustmentId || newId(), saleId: r.saleId, actor: ctx.auth.actor(), terminalId: d.terminalId, reason: String(r.reason ?? '') });
    ctx.sync.syncSoon();
    return adj;
  });

  on('sales:refund', { anyOf: ['ventas.devolver'] }, async (r) => {
    await ctx.auth.reauth(String(r.password ?? ''));
    const d = await device();
    const adj = await ctx.store.refundSale({
      adjustmentId: r.adjustmentId || newId(), saleId: r.saleId, actor: ctx.auth.actor(), terminalId: d.terminalId,
      reason: String(r.reason ?? ''), method: r.method, lines: r.lines,
    });
    ctx.sync.syncSoon();
    return adj;
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
    return { sessionId: s.id as string, openedAt: s.opened_at as string, breakdown };
  });
  on('cash:close', { anyOf: ['caja.corte'] }, async (r) => {
    await ctx.auth.reauth(String(r.password ?? ''));
    const d = await device();
    const denoms = Object.fromEntries(Object.entries(r.denominations ?? {}).filter(([, q]) => q > 0));
    if (Object.keys(denoms).length > 0 && sumDenominations(denoms) !== r.countedCents) {
      throw new AppError('conteo_no_coincide', 'El total contado no coincide con el desglose de billetes y monedas.');
    }
    const res = await ctx.store.closeCash({
      actor: ctx.auth.actor(), terminalId: d.terminalId, countedCents: Number(r.countedCents),
      denominations: Object.keys(denoms).length ? denoms : undefined, notes: String(r.notes ?? '').slice(0, 300) || undefined,
      offline: !ctx.sync.state.online,
    });
    void ctx.backup.runNow('cierre'); // respaldo al cerrar la caja (en segundo plano)
    ctx.sync.syncSoon();
    return {
      sessionId: res.sessionId, expectedCents: res.breakdown.expectedCents, countedCents: res.countedCents,
      differenceCents: res.differenceCents, provisional: res.provisional,
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
