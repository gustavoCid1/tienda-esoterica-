/**
 * Aplicación de operaciones sincronizadas (ventas, ajustes, movimientos, caja).
 * Lógica PURA: todo acceso a datos pasa por `SyncRepo`, así se prueba con un repositorio en memoria
 * y en producción se usa la implementación de MongoDB (sync-repo.ts).
 *
 * Garantías:
 *  - IDEMPOTENCIA: el evento (sync_events, _id = opId) se inserta PRIMERO; si ya existía, se responde
 *    'duplicate' y no se vuelve a aplicar nada. Además cada paso interno es idempotente por _id
 *    (venta, ajuste, movimiento), de modo que un evento que quedó a medias (caída del proceso) se
 *    puede reprocesar con seguridad (`replayStuck`).
 *  - Una venta que YA OCURRIÓ físicamente nunca se rechaza por falta de existencias: se aplica y,
 *    si la existencia queda negativa, se registra un CONFLICTO para el gerente.
 *  - Se rechaza solo lo inválido (payload mal formado, importes que no cuadran, usuario sin permiso,
 *    ajuste imposible). Lo rechazado queda en sync_conflicts con la operación original guardada.
 *  - El rol, la sucursal y los permisos temporales se LEEN DEL SERVIDOR; lo que diga el dispositivo
 *    sobre autorizaciones (grantId, authorizedBy) se ignora.
 *  - Sin transacciones: movimiento (único por _id) y luego $inc; reconcileStock repara cualquier hueco.
 */
import {
  can,
  canRegisterEntry,
  cashDifference,
  computeCashBreakdown,
  computeSale,
  refundAmountForLine,
  SaleValidationError,
} from '@amara/shared';
import type {
  CashBreakdown,
  CashMovement,
  ComputedSale,
  Grant,
  InventoryMovement,
  OpType,
  Role,
  Sale,
  SaleAdjustment,
  SyncOp,
  SyncResult,
} from '@amara/shared';
import type { ZodError } from 'zod';
import {
  cashClosePayload,
  cashMovementPayload,
  cashOpenPayload,
  saleAdjustPayload,
  saleCreatePayload,
  stockMovementPayload,
} from './sync-payloads.ts';
import { deltaMatchesType } from './stock-math.ts';

// ───────────────────────────── Contratos de datos ─────────────────────────────

export type SyncSource = 'terminal' | 'usuario' | 'servidor';
export type EventStatus = 'procesando' | 'aplicada' | 'conflicto' | 'rechazada' | 'error';

export interface UserRec {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  branchIds: string[];
}
export interface TerminalRec {
  id: string;
  branchId: string;
  code: string;
}
export interface VariantRec {
  id: string;
  priceCents: number;
  costCents: number;
}
export interface SyncEventRec {
  id: string; // = opId
  type: OpType;
  terminalId: string;
  branchId: string;
  userId: string;
  localTs: string;
  receivedAt: string;
  status: EventStatus;
  source: SyncSource;
  /** Operación original completa: permite reprocesar y que el gerente revise lo rechazado. */
  op: SyncOp;
  attempts: number;
  conflictKind?: string | null;
  detail?: string | null;
  error?: string | null;
  finishedAt?: string | null;
}
export interface CashSessionRec {
  id: string;
  branchId: string;
  terminalId: string;
  openedBy: string;
  openedAt: string;
  openingCents: number;
  status: 'abierta' | 'cerrada';
  /** Sesión que llegó sincronizada cuando ya había otra abierta en la terminal (conflicto). */
  duplicateOpen?: boolean;
  closedAt?: string | null;
  closeOpId?: string | null;
}
export interface CashData {
  sales: Pick<Sale, 'cashSessionId' | 'payments'>[];
  adjustments: Pick<SaleAdjustment, 'cashSessionId' | 'payments'>[];
  movements: Pick<CashMovement, 'sessionId' | 'type' | 'amountCents'>[];
}
export type StoredSale = Sale & { receivedAt: string; syncOpId: string; source: SyncSource };
export type StoredAdjustment = SaleAdjustment & { receivedAt: string; syncOpId: string; source: SyncSource };
export type StoredMovement = InventoryMovement & { opId: string | null };
export interface ConflictRec {
  id: string;
  opId: string;
  opType: OpType;
  kind: string;
  detail: string;
  /** true si la operación NO se aplicó (rechazada); false si se aplicó con una diferencia. */
  rejected: boolean;
  status: 'abierto' | 'resuelto';
  branchId: string;
  terminalId: string;
  userId: string;
  createdAt: string;
}
export interface AuditRec {
  /** Determinista (opId + acción) para que reprocesar no duplique la auditoría. */
  id: string;
  at: string;
  userId: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  branchId?: string | null;
  terminalId?: string | null;
  detail?: unknown;
}

export interface SyncRepo {
  insertEvent(ev: SyncEventRec): Promise<boolean>;
  getEvent(opId: string): Promise<SyncEventRec | null>;
  finishEvent(opId: string, patch: Partial<SyncEventRec>): Promise<void>;
  listStuckEvents(receivedBeforeIso: string, limit: number): Promise<SyncEventRec[]>;
  hasPendingEvents(terminalId: string, exceptOpId: string): Promise<boolean>;

  getUser(id: string): Promise<UserRec | null>;
  getTerminal(id: string): Promise<TerminalRec | null>;
  listGrants(sellerId: string, branchId: string): Promise<Grant[]>;
  getVariant(id: string): Promise<VariantRec | null>;

  getSale(id: string): Promise<Sale | null>;
  insertSale(sale: StoredSale): Promise<boolean>;
  folioTaken(folio: string, exceptSaleId: string): Promise<boolean>;
  setSaleCancelled(saleId: string): Promise<void>;
  listAdjustmentsForSale(saleId: string): Promise<SaleAdjustment[]>;
  insertAdjustment(adj: StoredAdjustment): Promise<boolean>;

  /** Inserta el movimiento; false si ya existía (no se aplica $inc). */
  insertMovement(m: StoredMovement): Promise<boolean>;
  /** $inc atómico; devuelve la existencia resultante. */
  incStock(variantId: string, branchId: string, delta: number, location?: string | null): Promise<number>;

  getCashSession(id: string): Promise<CashSessionRec | null>;
  insertCashSession(s: CashSessionRec): Promise<'inserted' | 'exists' | 'terminal_busy'>;
  insertCashMovement(m: CashMovement & { receivedAt: string; syncOpId: string }): Promise<boolean>;
  cashDataForSession(sessionId: string): Promise<CashData>;
  closeCashSession(sessionId: string, patch: Record<string, unknown>): Promise<boolean>;

  insertConflict(c: ConflictRec): Promise<boolean>;
  audit(a: AuditRec): Promise<void>;
}

export interface ApplyContext {
  now: () => Date;
  source: SyncSource;
  /** Token de terminal usado en la petición: toda operación debe pertenecer a esta terminal. */
  terminal?: { id: string; branchId: string };
  /** Sesión de usuario usada en la petición (source = 'usuario'): la operación debe ser de ese usuario. */
  sessionUserId?: string;
}

/** Tiempo tras el cual un evento 'procesando' se considera abandonado y puede reprocesarse. */
export const STUCK_AFTER_MS = 2 * 60_000;
/** Tolerancia a relojes adelantados de los dispositivos. */
export const FUTURE_TOLERANCE_MS = 10 * 60_000;

// ───────────────────────────── Resultado de cada manejador ─────────────────────────────

interface Finding {
  kind: string;
  detail: string;
}
interface Outcome {
  rejected: boolean;
  findings: Finding[];
}

class Acc {
  findings: Finding[] = [];
  add(kind: string, detail: string) {
    this.findings.push({ kind, detail });
  }
  done(): Outcome {
    return { rejected: false, findings: this.findings };
  }
}
const reject = (kind: string, detail: string): Outcome => ({ rejected: true, findings: [{ kind, detail }] });
const zodMsg = (e: ZodError) => {
  const i = e.issues[0];
  return `${i?.path.join('.') || 'payload'}: ${i?.message ?? 'inválido'}`;
};
const minIso = (a: string, b: string) => (a < b ? a : b);

/** Mensaje corto para el dispositivo (la información completa queda en sync_conflicts). */
function summarize(findings: Finding[]): { kind?: string; detail?: string } {
  if (findings.length === 0) return {};
  return { kind: findings[0]!.kind, detail: findings.map((f) => `${f.kind}: ${f.detail}`).join(' | ').slice(0, 500) };
}

// ───────────────────────────── Punto de entrada ─────────────────────────────

export async function applySyncOp(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<SyncResult> {
  const receivedAt = ctx.now().toISOString();

  // Pertenencia de la operación al dispositivo/usuario autenticado en la petición.
  if (ctx.terminal && (op.terminalId !== ctx.terminal.id || op.branchId !== ctx.terminal.branchId)) {
    await repo.audit({
      id: `${op.opId}:terminal_ajena`, at: receivedAt, userId: op.userId, action: 'sync.operacion_ajena',
      entity: 'sync_op', entityId: op.opId, branchId: op.branchId, terminalId: ctx.terminal.id,
      detail: { declaredTerminal: op.terminalId, declaredBranch: op.branchId, type: op.type },
    });
    return { opId: op.opId, status: 'rejected', conflictKind: 'terminal_ajena', detail: 'La operación no pertenece a esta terminal', receivedAt };
  }
  if (ctx.sessionUserId && op.userId !== ctx.sessionUserId) {
    return { opId: op.opId, status: 'rejected', conflictKind: 'usuario_ajeno', detail: 'La operación pertenece a otro usuario', receivedAt };
  }

  const ev: SyncEventRec = {
    id: op.opId, type: op.type, terminalId: op.terminalId, branchId: op.branchId, userId: op.userId,
    localTs: op.localTs, receivedAt, status: 'procesando', source: ctx.source, op, attempts: 1,
  };
  // Se inserta PRIMERO: de dos peticiones simultáneas con el mismo opId, solo una aplica.
  const inserted = await repo.insertEvent(ev);
  if (inserted) return execute(repo, op, ctx, ev);

  const prev = await repo.getEvent(op.opId);
  if (!prev) {
    // Carrera improbable (evento borrado entre ambas lecturas): se trata como duplicado.
    return { opId: op.opId, status: 'duplicate', receivedAt };
  }
  const stuck = prev.status === 'procesando' && ctx.now().getTime() - Date.parse(prev.receivedAt) > STUCK_AFTER_MS;
  if (prev.status === 'error' || stuck) {
    // El intento anterior no terminó: se reprocesa la operación ORIGINAL (cada paso es idempotente).
    return execute(repo, prev.op, ctx, { ...prev, attempts: prev.attempts + 1 });
  }
  return {
    opId: op.opId, status: 'duplicate', receivedAt: prev.receivedAt,
    ...(prev.status === 'procesando' ? { detail: 'La operación original aún se está procesando' } : {}),
  };
}

async function execute(repo: SyncRepo, op: SyncOp, ctx: ApplyContext, ev: SyncEventRec): Promise<SyncResult> {
  const now = ctx.now().toISOString();
  let outcome: Outcome;
  try {
    outcome = await dispatch(repo, op, ctx);
    for (const f of outcome.findings) {
      await repo.insertConflict({
        id: `${op.opId}:${f.kind}`, opId: op.opId, opType: op.type, kind: f.kind, detail: f.detail.slice(0, 1000),
        rejected: outcome.rejected, status: 'abierto', branchId: op.branchId, terminalId: op.terminalId, userId: op.userId, createdAt: now,
      });
    }
  } catch (e) {
    // Quedó a medias: se marca 'error' para que el reintento del dispositivo lo reprocese (no 'duplicate').
    await repo
      .finishEvent(op.opId, { status: 'error', error: e instanceof Error ? e.message.slice(0, 300) : String(e), attempts: ev.attempts, finishedAt: now })
      .catch(() => undefined);
    throw e;
  }
  const { kind, detail } = summarize(outcome.findings);
  const status = outcome.rejected ? 'rejected' : outcome.findings.length > 0 ? 'conflict' : 'applied';
  await repo.finishEvent(op.opId, {
    status: status === 'rejected' ? 'rechazada' : status === 'conflict' ? 'conflicto' : 'aplicada',
    conflictKind: kind ?? null, detail: detail ?? null, error: null, attempts: ev.attempts, finishedAt: now,
  });
  return { opId: op.opId, status, ...(kind ? { conflictKind: kind } : {}), ...(detail ? { detail } : {}), receivedAt: ev.receivedAt };
}

/** Reprocesa eventos abandonados ('error' o 'procesando' viejos). Devuelve cuántos terminó. */
export async function replayStuck(repo: SyncRepo, ctx: ApplyContext, limit = 50): Promise<{ replayed: number; failed: number }> {
  const before = new Date(ctx.now().getTime() - STUCK_AFTER_MS).toISOString();
  const evs = await repo.listStuckEvents(before, limit);
  let replayed = 0;
  let failed = 0;
  for (const ev of evs) {
    try {
      await execute(repo, ev.op, { ...ctx, terminal: undefined, sessionUserId: undefined }, { ...ev, attempts: ev.attempts + 1 });
      replayed++;
    } catch {
      failed++;
    }
  }
  return { replayed, failed };
}

async function dispatch(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  switch (op.type) {
    case 'sale.create':
      return handleSaleCreate(repo, op, ctx);
    case 'sale.adjust':
      return handleSaleAdjust(repo, op, ctx);
    case 'stock.movement':
      return handleStockMovement(repo, op, ctx);
    case 'cash.open':
      return handleCashOpen(repo, op, ctx);
    case 'cash.movement':
      return handleCashMovement(repo, op, ctx);
    case 'cash.close':
      return handleCashClose(repo, op, ctx);
    default:
      return reject('tipo_desconocido', `Tipo de operación no soportado: ${String((op as SyncOp).type)}`);
  }
}

/** Usuario que ejecutó la operación, leído del servidor. Devuelve un rechazo si no existe o no tiene acceso. */
async function loadActor(repo: SyncRepo, op: SyncOp, branchId: string): Promise<{ user: UserRec } | { fail: Outcome }> {
  const user = await repo.getUser(op.userId);
  if (!user) return { fail: reject('usuario_desconocido', 'El usuario de la operación no existe en el servidor') };
  if (!user.branchIds.includes(branchId)) return { fail: reject('sin_acceso_sucursal', `${user.name} no tiene acceso a la sucursal de la operación`) };
  return { user };
}

// ───────────────────────────── sale.create ─────────────────────────────

async function handleSaleCreate(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  const parsed = saleCreatePayload.safeParse(op.payload);
  if (!parsed.success) return reject('payload_invalido', zodMsg(parsed.error));
  const sale = parsed.data.sale;
  if (sale.branchId !== op.branchId || sale.userId !== op.userId || sale.terminalId !== op.terminalId) {
    return reject('payload_inconsistente', 'La venta no coincide con sucursal, terminal o usuario de la operación');
  }
  const actor = await loadActor(repo, op, sale.branchId);
  if ('fail' in actor) return actor.fail;
  const { user } = actor;
  if (!can(user.role, 'ventas.crear')) return reject('sin_permiso', `${user.name} (${user.role}) no puede registrar ventas`);

  // Se recalculan importes con la MISMA función que usan los dispositivos.
  const lineDiscounts = sale.items.reduce((a, i) => a + i.lineDiscountCents, 0);
  let calc: ComputedSale;
  try {
    calc = computeSale(
      sale.items.map((i) => ({ variantId: i.variantId, qty: i.qty, unitPriceCents: i.unitPriceCents, unitCostCents: i.unitCostCents, lineDiscountCents: i.lineDiscountCents })),
      sale.discountCents - lineDiscounts,
      sale.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, tenderedCents: p.tenderedCents })),
    );
  } catch (e) {
    if (e instanceof SaleValidationError) return reject('importes_inconsistentes', e.message);
    throw e;
  }
  const lineMismatch = calc.lines.some((l, i) => l.netCents !== sale.items[i]!.netCents);
  if (
    lineMismatch || calc.totalCents !== sale.totalCents || calc.subtotalCents !== sale.subtotalCents ||
    calc.discountCents !== sale.discountCents || calc.tenderedCents !== sale.tenderedCents || calc.changeCents !== sale.changeCents
  ) {
    return reject('importes_inconsistentes', 'Los importes de la venta no coinciden con el recálculo del servidor');
  }

  const acc = new Acc();
  if (!user.active) acc.add('usuario_inactivo', `${user.name} está inactivo en el servidor (la venta ya ocurrió)`);
  if (sale.discountCents > 0 && !can(user.role, 'ventas.descuento')) {
    acc.add('descuento_sin_permiso', `${user.name} (${user.role}) aplicó descuento de ${sale.discountCents} centavos sin permiso`);
  }
  if (Date.parse(sale.createdAt) > ctx.now().getTime() + FUTURE_TOLERANCE_MS) {
    acc.add('hora_futura', `La hora de la venta (${sale.createdAt}) está en el futuro: revisar reloj de la terminal`);
  }
  if (await repo.folioTaken(sale.folio, sale.id)) acc.add('folio_duplicado', `El folio ${sale.folio} ya existe en otra venta`);
  if (sale.cashSessionId) {
    const s = await repo.getCashSession(sale.cashSessionId);
    if (!s) acc.add('caja_desconocida', 'La venta pertenece a una sesión de caja que el servidor no conoce');
    else if (s.branchId !== sale.branchId) acc.add('caja_otra_sucursal', 'La sesión de caja es de otra sucursal');
    else if (s.status === 'cerrada' && s.closedAt && sale.createdAt > s.closedAt) acc.add('venta_tras_corte', 'La venta es posterior al corte de su sesión de caja');
  }

  await repo.insertSale({ ...sale, status: 'completada', receivedAt: ctx.now().toISOString(), syncOpId: op.opId, source: ctx.source });

  const negatives: string[] = [];
  const unknown: string[] = [];
  const cheaper: string[] = [];
  for (const [i, it] of sale.items.entries()) {
    const v = await repo.getVariant(it.variantId);
    if (!v) {
      unknown.push(`${it.productName} ${it.variantLabel}`.trim());
      continue;
    }
    if (it.unitPriceCents < v.priceCents && it.lineDiscountCents === 0 && sale.discountCents === 0) {
      cheaper.push(`${it.productName} ${it.variantLabel}: vendido a ${it.unitPriceCents}, catálogo ${v.priceCents}`);
    }
    const isNew = await repo.insertMovement({
      id: `${sale.id}:m${i}`, variantId: it.variantId, branchId: sale.branchId, delta: -it.qty, type: 'venta',
      reason: `Venta ${sale.folio}`, refType: 'sale', refId: sale.id, userId: sale.userId, authorizedBy: null,
      grantId: null, location: null, createdAt: sale.createdAt, opId: op.opId,
    });
    if (!isNew) continue; // reproceso: este renglón ya descontó existencias
    const qty = await repo.incStock(it.variantId, sale.branchId, -it.qty);
    if (qty < 0) negatives.push(`${it.productName} ${it.variantLabel}: existencia ${qty}`.trim());
  }
  // La venta YA ocurrió: nunca se rechaza por existencias; se avisa al gerente.
  if (negatives.length) acc.add('stock_negativo', `La venta ${sale.folio} dejó existencia negativa → ${negatives.join('; ')}`);
  if (unknown.length) acc.add('producto_desconocido', `Productos que el servidor no conoce (no descontaron existencias): ${unknown.join('; ')}`);
  if (cheaper.length) acc.add('precio_menor_catalogo', `Precio menor al del catálogo actual (puede deberse a un cambio de precio posterior): ${cheaper.join('; ')}`);

  await repo.audit({
    id: `${op.opId}:venta`, at: ctx.now().toISOString(), userId: sale.userId, action: 'venta.crear', entity: 'sale', entityId: sale.id,
    branchId: sale.branchId, terminalId: sale.terminalId, detail: { folio: sale.folio, totalCents: sale.totalCents, origin: ctx.source },
  });
  return acc.done();
}

// ───────────────────────────── sale.adjust ─────────────────────────────

async function handleSaleAdjust(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  const parsed = saleAdjustPayload.safeParse(op.payload);
  if (!parsed.success) return reject('payload_invalido', zodMsg(parsed.error));
  const adj = parsed.data.adjustment;
  if (adj.branchId !== op.branchId || adj.userId !== op.userId || adj.terminalId !== op.terminalId) {
    return reject('payload_inconsistente', 'El ajuste no coincide con sucursal, terminal o usuario de la operación');
  }
  const actor = await loadActor(repo, op, adj.branchId);
  if ('fail' in actor) return actor.fail;
  const { user } = actor;
  const perm = adj.type === 'cancelacion' ? 'ventas.cancelar' : 'ventas.devolver';
  if (!can(user.role, perm)) return reject('sin_permiso', `${user.name} (${user.role}) no puede registrar ${adj.type === 'cancelacion' ? 'cancelaciones' : 'devoluciones'}`);

  const sale = await repo.getSale(adj.saleId);
  if (!sale) return reject('venta_no_encontrada', 'La venta del ajuste no existe en el servidor');
  if (sale.branchId !== adj.branchId) return reject('payload_inconsistente', 'El ajuste es de otra sucursal que la venta');

  const all = await repo.listAdjustmentsForSale(sale.id);
  const already = all.some((a) => a.id === adj.id); // reproceso del mismo ajuste
  const acc = new Acc();

  if (!already) {
    if (sale.status !== 'completada') return reject('ya_cancelada', 'La venta ya está cancelada');
    const used = new Map<string, number>();
    for (const a of all) for (const it of a.items) used.set(it.saleItemId, (used.get(it.saleItemId) ?? 0) + it.qty);
    if (adj.type === 'cancelacion' && all.length > 0) return reject('tiene_devoluciones', 'La venta ya tiene devoluciones; no puede cancelarse completa');

    let expectedTotal = 0;
    for (const it of adj.items) {
      const line = sale.items.find((l) => l.id === it.saleItemId);
      if (!line || line.variantId !== it.variantId) return reject('partida_invalida', 'Una partida del ajuste no pertenece a la venta');
      const before = used.get(line.id) ?? 0;
      try {
        expectedTotal += refundAmountForLine(line.netCents, line.qty, before, it.qty);
      } catch {
        return reject('devolucion_excedida', `Se devuelve más de lo vendido en "${line.productName}"`);
      }
      used.set(line.id, before + it.qty);
    }
    if (adj.type === 'cancelacion' && sale.items.some((l) => (used.get(l.id) ?? 0) !== l.qty)) {
      return reject('cancelacion_incompleta', 'Una cancelación debe incluir todas las partidas completas');
    }
    // Lo siguiente ya ocurrió con dinero real: se aplica y se avisa.
    if (expectedTotal !== adj.amountCents) acc.add('importe_ajuste_distinto', `Importe del ajuste ${adj.amountCents}; el servidor calcula ${expectedTotal}`);
    if (adj.payments.reduce((a, p) => a + p.amountCents, 0) !== adj.amountCents) acc.add('pagos_no_coinciden', 'Los pagos devueltos no suman el importe del ajuste');
    if (adj.cashSessionId) {
      const s = await repo.getCashSession(adj.cashSessionId);
      if (!s) acc.add('caja_desconocida', 'El ajuste pertenece a una sesión de caja que el servidor no conoce');
    }
    await repo.insertAdjustment({ ...adj, receivedAt: ctx.now().toISOString(), syncOpId: op.opId, source: ctx.source });
    if (adj.type === 'cancelacion') await repo.setSaleCancelled(sale.id);
  }

  const unknown: string[] = [];
  for (const [i, it] of adj.items.entries()) {
    if (!it.restock) continue; // producto dañado / merma: no regresa a existencias
    const v = await repo.getVariant(it.variantId);
    if (!v) {
      unknown.push(`${it.productName} ${it.variantLabel}`.trim());
      continue;
    }
    const isNew = await repo.insertMovement({
      id: `${adj.id}:m${i}`, variantId: it.variantId, branchId: adj.branchId, delta: it.qty, type: 'devolucion',
      reason: `${adj.type === 'cancelacion' ? 'Cancelación' : 'Devolución'} ${sale.folio}`, refType: 'adjustment', refId: adj.id,
      userId: adj.userId, authorizedBy: null, grantId: null, location: null, createdAt: adj.createdAt, opId: op.opId,
    });
    if (isNew) await repo.incStock(it.variantId, adj.branchId, it.qty);
  }
  if (unknown.length) acc.add('producto_desconocido', `Productos desconocidos que no regresaron a existencias: ${unknown.join('; ')}`);

  await repo.audit({
    id: `${op.opId}:ajuste`, at: ctx.now().toISOString(), userId: adj.userId, action: `venta.${adj.type}`, entity: 'sale', entityId: sale.id,
    branchId: adj.branchId, terminalId: adj.terminalId, detail: { folio: sale.folio, amountCents: adj.amountCents, reason: adj.reason, adjustmentId: adj.id },
  });
  return acc.done();
}

// ───────────────────────────── stock.movement ─────────────────────────────

async function handleStockMovement(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  const parsed = stockMovementPayload.safeParse(op.payload);
  if (!parsed.success) return reject('payload_invalido', zodMsg(parsed.error));
  const m = parsed.data.movement;
  if (m.branchId !== op.branchId) return reject('payload_inconsistente', 'El movimiento no coincide con la sucursal de la operación');
  const actor = await loadActor(repo, op, m.branchId);
  if ('fail' in actor) return actor.fail;
  const { user } = actor;
  const nowIso = ctx.now().toISOString();
  // La hora local no puede ubicarse en el futuro para "caer" dentro de un permiso temporal.
  const at = minIso(op.localTs, nowIso);

  let grant: Grant | undefined;
  if (m.type === 'entrada') {
    const grants = await repo.listGrants(user.id, m.branchId);
    const r = canRegisterEntry(user.role, user.id, m.branchId, grants, at);
    if (!r.allowed) return reject('sin_permiso', `${user.name} (${user.role}) no tenía permiso vigente para ingresar mercancía al momento de la operación`);
    grant = r.grant;
  } else if (!can(user.role, 'inventario.mover')) {
    return reject('sin_permiso', `${user.name} (${user.role}) no puede modificar inventario`);
  }
  if (!deltaMatchesType(m.type, m.delta)) return reject('delta_invalido', `La cantidad no es coherente con el tipo "${m.type}"`);
  const v = await repo.getVariant(m.variantId);
  if (!v) return reject('producto_no_encontrado', 'La variante del movimiento no existe en el servidor');

  const acc = new Acc();
  if (!user.active) acc.add('usuario_inactivo', `${user.name} está inactivo en el servidor`);
  if (Date.parse(op.localTs) > ctx.now().getTime() + FUTURE_TOLERANCE_MS) acc.add('hora_futura', `La hora del movimiento (${op.localTs}) está en el futuro`);

  const location = m.location ?? null;
  const isNew = await repo.insertMovement({
    id: m.id, variantId: m.variantId, branchId: m.branchId, delta: m.delta, type: m.type, reason: m.reason,
    refType: null, refId: null, userId: user.id, authorizedBy: grant?.grantedBy ?? null, grantId: grant?.id ?? null,
    location, createdAt: at, opId: op.opId,
  });
  if (isNew) {
    const qty = await repo.incStock(m.variantId, m.branchId, m.delta, location);
    if (qty < 0) acc.add('stock_negativo', `El movimiento dejó la existencia en ${qty}`);
    if (m.type === 'conteo' && m.countedQty != null && qty !== m.countedQty) {
      acc.add('conteo_difiere', `Se contaron ${m.countedQty} pero la existencia del servidor es ${qty} (hubo operaciones entre medio)`);
    }
  }
  await repo.audit({
    id: `${op.opId}:inventario`, at: nowIso, userId: user.id, action: `inventario.${m.type}`, entity: 'variant', entityId: m.variantId,
    branchId: m.branchId, terminalId: op.terminalId, detail: { delta: m.delta, reason: m.reason, movementId: m.id, grantId: grant?.id ?? null, authorizedBy: grant?.grantedBy ?? null },
  });
  return acc.done();
}

// ───────────────────────────── caja ─────────────────────────────

async function handleCashOpen(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  const parsed = cashOpenPayload.safeParse(op.payload);
  if (!parsed.success) return reject('payload_invalido', zodMsg(parsed.error));
  const s = parsed.data.session;
  if (s.branchId !== op.branchId || s.terminalId !== op.terminalId || s.openedBy !== op.userId) {
    return reject('payload_inconsistente', 'La sesión de caja no coincide con la operación');
  }
  const actor = await loadActor(repo, op, s.branchId);
  if ('fail' in actor) return actor.fail;
  if (!can(actor.user.role, 'caja.abrir')) return reject('sin_permiso', `${actor.user.name} no puede abrir caja`);
  const terminal = await repo.getTerminal(s.terminalId);
  if (!terminal) return reject('terminal_desconocida', 'La terminal de la sesión no existe en el servidor');
  if (terminal.branchId !== s.branchId) return reject('payload_inconsistente', 'La terminal pertenece a otra sucursal');

  const acc = new Acc();
  const rec: CashSessionRec = { id: s.id, branchId: s.branchId, terminalId: s.terminalId, openedBy: s.openedBy, openedAt: s.openedAt, openingCents: s.openingCents, status: 'abierta' };
  const r = await repo.insertCashSession(rec);
  if (r === 'terminal_busy') {
    // Ya hay otra caja abierta en la terminal (p. ej. se abrió también en línea). Se conserva la sesión
    // para no perder las ventas que la referencian, pero queda cerrada/duplicada y se avisa.
    await repo.insertCashSession({ ...rec, status: 'cerrada', duplicateOpen: true });
    acc.add('caja_duplicada', `La terminal ya tenía otra caja abierta en el servidor; la sesión ${s.id} se conservó como duplicada`);
  }
  await repo.audit({
    id: `${op.opId}:caja_abrir`, at: ctx.now().toISOString(), userId: s.openedBy, action: 'caja.abrir', entity: 'cash_session', entityId: s.id,
    branchId: s.branchId, terminalId: s.terminalId, detail: { openingCents: s.openingCents },
  });
  return acc.done();
}

async function handleCashMovement(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  const parsed = cashMovementPayload.safeParse(op.payload);
  if (!parsed.success) return reject('payload_invalido', zodMsg(parsed.error));
  const m = parsed.data.movement;
  if (m.userId !== op.userId) return reject('payload_inconsistente', 'El movimiento de caja no coincide con el usuario de la operación');
  const session = await repo.getCashSession(m.sessionId);
  if (!session) return reject('sesion_no_encontrada', 'La sesión de caja no existe en el servidor');
  if (session.branchId !== op.branchId) return reject('payload_inconsistente', 'La sesión de caja es de otra sucursal');
  const actor = await loadActor(repo, op, session.branchId);
  if ('fail' in actor) return actor.fail;
  if (!can(actor.user.role, 'caja.movimientos')) return reject('sin_permiso', `${actor.user.name} no puede registrar movimientos de caja`);

  const acc = new Acc();
  if (session.status === 'cerrada' && session.closedAt && m.createdAt > session.closedAt) {
    acc.add('movimiento_tras_corte', 'El movimiento es posterior al corte de su sesión de caja');
  }
  await repo.insertCashMovement({ ...m, receivedAt: ctx.now().toISOString(), syncOpId: op.opId });
  await repo.audit({
    id: `${op.opId}:caja_mov`, at: ctx.now().toISOString(), userId: m.userId, action: `caja.${m.type}`, entity: 'cash_session', entityId: session.id,
    branchId: session.branchId, terminalId: op.terminalId, detail: { amountCents: m.amountCents, concept: m.concept },
  });
  return acc.done();
}

async function handleCashClose(repo: SyncRepo, op: SyncOp, ctx: ApplyContext): Promise<Outcome> {
  const parsed = cashClosePayload.safeParse(op.payload);
  if (!parsed.success) return reject('payload_invalido', zodMsg(parsed.error));
  const c = parsed.data;
  if (c.closedBy !== op.userId) return reject('payload_inconsistente', 'El corte no coincide con el usuario de la operación');
  const session = await repo.getCashSession(c.sessionId);
  if (!session) return reject('sesion_no_encontrada', 'La sesión de caja no existe en el servidor');
  if (session.branchId !== op.branchId) return reject('payload_inconsistente', 'La sesión de caja es de otra sucursal');
  const actor = await loadActor(repo, op, session.branchId);
  if ('fail' in actor) return actor.fail;
  if (!can(actor.user.role, 'caja.corte')) return reject('sin_permiso', `${actor.user.name} (${actor.user.role}) no puede hacer cortes de caja`);
  if (session.closeOpId === op.opId) return new Acc().done(); // reproceso de este mismo corte
  if (session.status === 'cerrada' && !session.duplicateOpen) return reject('ya_cerrada', 'La sesión de caja ya tiene un corte registrado');

  // El esperado SIEMPRE lo calcula el servidor con lo que ya recibió (el dispositivo manda el suyo solo para comparar).
  const data = await repo.cashDataForSession(session.id);
  const breakdown: CashBreakdown = computeCashBreakdown(session.openingCents, session.id, data.sales, data.adjustments, data.movements);
  const difference = cashDifference(breakdown.expectedCents, c.countedCents);
  const acc = new Acc();
  const mismatch = c.expectedCents !== undefined && c.expectedCents !== breakdown.expectedCents;
  if (mismatch) {
    acc.add('corte_difiere', `El esperado de la terminal (${c.expectedCents}) no coincide con el del servidor (${breakdown.expectedCents}): faltan o sobran operaciones por sincronizar`);
  }
  const pending = await repo.hasPendingEvents(op.terminalId, op.opId);
  const provisional = !!c.provisional || pending || mismatch;
  const ok = await repo.closeCashSession(session.id, {
    status: 'cerrada', closedBy: c.closedBy, closedAt: c.closedAt, countedCents: c.countedCents, expectedCents: breakdown.expectedCents,
    clientExpectedCents: c.expectedCents ?? null, differenceCents: difference, provisional, reconciliation: mismatch ? 'con_diferencias' : 'conciliado',
    denominations: c.denominations ?? null, notes: c.notes ?? null, closure: { breakdown }, closeOpId: op.opId, closeReceivedAt: ctx.now().toISOString(),
  });
  if (!ok) return reject('ya_cerrada', 'La sesión de caja ya tiene un corte registrado');
  await repo.audit({
    id: `${op.opId}:caja_cerrar`, at: ctx.now().toISOString(), userId: c.closedBy, action: 'caja.cerrar', entity: 'cash_session', entityId: session.id,
    branchId: session.branchId, terminalId: op.terminalId,
    detail: { expectedCents: breakdown.expectedCents, countedCents: c.countedCents, differenceCents: difference, provisional },
  });
  return acc.done();
}
