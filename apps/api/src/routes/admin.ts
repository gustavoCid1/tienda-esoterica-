/** /admin: usuarios, sucursales, terminales, permisos temporales, conflictos, auditoría, respaldos, sincronización y diagnóstico. */
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { can, newId } from '@amara/shared';
import { hashPassword } from '@amara/shared/password';
import { branchSchema, grantCreateSchema, terminalSchema, userCreateSchema, userUpdateSchema } from '@amara/shared/schemas';
import { audit } from '../audit.ts';
import { assertBranch, branchScope, requirePerm, requireReauth, signTerminal } from '../auth.ts';
import { config } from '../config.ts';
import { col, getDb } from '../db.ts';
import { ah, HttpError, out, parse } from '../http.ts';
import { publicUser } from '../serialize.ts';
import { compact, dayRangeIso, dayStr, isoRangeFilter, pageQuery, runMw, sessionUser } from '../util.ts';

export const adminRouter = Router();

const dupMsg = (e: unknown, msg: string) => ((e as { code?: number })?.code === 11000 ? new HttpError(409, msg) : e);

// ───────────────────────────── Usuarios ─────────────────────────────

adminRouter.get(
  '/users',
  requirePerm('usuarios.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    // Cada gerente ve a los usuarios de sus sucursales (y a sí mismo).
    const users = await col('users').find({ $or: [{ branchIds: { $in: me.branchIds } }, { _id: me.id }] }).sort({ name: 1 }).toArray();
    res.json({ items: users.map(publicUser) });
  }),
);

adminRouter.post(
  '/users',
  requirePerm('usuarios.gestionar'),
  requireReauth,
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(userCreateSchema, req.body);
    // El desarrollador es una cuenta técnica: no se crea desde el punto de venta.
    if (body.role === 'desarrollador') throw new HttpError(403, 'Un gerente no puede crear usuarios desarrollador');
    for (const b of body.branchIds) assertBranch(me, b);
    const existingBranches = await col('branches').countDocuments({ _id: { $in: body.branchIds } });
    if (existingBranches !== new Set(body.branchIds).size) throw new HttpError(400, 'Alguna sucursal no existe');
    const username = body.username.toLowerCase();
    if (await col('users').findOne({ username }, { projection: { _id: 1 } })) throw new HttpError(409, 'Ese nombre de usuario ya existe');
    const id = newId();
    const now = new Date().toISOString();
    try {
      await col('users').insertOne({
        _id: id, id, username, name: body.name, role: body.role, branchIds: [...new Set(body.branchIds)], active: true,
        passwordHash: hashPassword(body.password), failedLogins: 0, lockedUntil: null, createdAt: now, updatedAt: now, createdBy: me.id,
      });
    } catch (e) {
      throw dupMsg(e, 'Ese nombre de usuario ya existe');
    }
    await audit({ userId: me.id, action: 'usuario.crear', entity: 'user', entityId: id, detail: { username, role: body.role, branchIds: body.branchIds } });
    res.status(201).json({ user: publicUser((await col('users').findOne({ _id: id }))!) });
  }),
);

adminRouter.patch(
  '/users/:id',
  requirePerm('usuarios.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const id = req.params.id!;
    const upd = parse(userUpdateSchema, req.body);
    const target = await col('users').findOne({ _id: id });
    if (!target) throw new HttpError(404, 'Usuario no encontrado');
    if (target.role === 'desarrollador') throw new HttpError(403, 'Las cuentas de desarrollador no se administran desde el punto de venta');
    if (id !== me.id && !(target.branchIds ?? []).some((b: string) => me.branchIds.includes(b))) throw new HttpError(403, 'Ese usuario no pertenece a tus sucursales');
    if (upd.role === 'desarrollador') throw new HttpError(403, 'Un gerente no puede asignar el rol desarrollador');

    const roleChange = upd.role !== undefined && upd.role !== target.role;
    const activeChange = upd.active !== undefined && upd.active !== !!target.active;
    const sensitive = roleChange || upd.password !== undefined || activeChange || upd.branchIds !== undefined;
    if (sensitive) await runMw(requireReauth, req, res); // rol, contraseña, estado y sucursales exigen contraseña reciente

    if (id === me.id && (roleChange || upd.active === false)) throw new HttpError(400, 'No puedes cambiar tu propio rol ni desactivarte');
    if (target.role === 'gerente' && (roleChange || upd.active === false)) {
      const others = await col('users').countDocuments({ role: 'gerente', active: true, _id: { $ne: id } });
      if (others === 0) throw new HttpError(409, 'Debe quedar al menos un gerente activo');
    }
    if (upd.branchIds) {
      for (const b of upd.branchIds) assertBranch(me, b);
      if ((await col('branches').countDocuments({ _id: { $in: upd.branchIds } })) !== new Set(upd.branchIds).size) throw new HttpError(400, 'Alguna sucursal no existe');
    }

    const set: Record<string, unknown> = compact({ name: upd.name, role: upd.role, active: upd.active, branchIds: upd.branchIds ? [...new Set(upd.branchIds)] : undefined });
    const changed = Object.keys(set);
    if (upd.password !== undefined) {
      set.passwordHash = hashPassword(upd.password);
      set.passwordChangedAt = new Date().toISOString();
      set.failedLogins = 0;
      set.lockedUntil = null;
      changed.push('password');
    }
    if (changed.length === 0) return void res.json({ user: publicUser(target), unchanged: true });
    set.updatedAt = new Date().toISOString();
    await col('users').updateOne({ _id: id }, { $set: set });
    // Nunca se audita la contraseña ni su hash: solo que cambió.
    await audit({ userId: me.id, action: 'usuario.editar', entity: 'user', entityId: id, detail: { fields: changed, role: roleChange ? { old: target.role, new: upd.role } : undefined, active: activeChange ? upd.active : undefined } });
    res.json({ user: publicUser((await col('users').findOne({ _id: id }))!) });
  }),
);

// ───────────────────────────── Sucursales ─────────────────────────────

adminRouter.get(
  '/branches',
  requirePerm('sucursales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const items = await col('branches').find({ _id: { $in: me.branchIds } }).sort({ code: 1 }).toArray();
    res.json({ items: items.map((b) => out(b)) });
  }),
);

adminRouter.post(
  '/branches',
  requirePerm('sucursales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(branchSchema, req.body);
    const id = newId();
    const now = new Date().toISOString();
    try {
      await col('branches').insertOne(compact({ _id: id, id, code: body.code, name: body.name, address: body.address, locations: body.locations, status: 'activa', createdAt: now, updatedAt: now }));
    } catch (e) {
      throw dupMsg(e, 'Ya existe una sucursal con ese código');
    }
    // El gerente que la crea puede verla y operarla de inmediato.
    await col('users').updateOne({ _id: me.id }, { $addToSet: { branchIds: id } });
    await audit({ userId: me.id, action: 'sucursal.crear', entity: 'branch', entityId: id, branchId: id, detail: { code: body.code, name: body.name } });
    res.status(201).json({ branch: out(await col('branches').findOne({ _id: id })) });
  }),
);

adminRouter.patch(
  '/branches/:id',
  requirePerm('sucursales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const id = req.params.id!;
    assertBranch(me, id);
    // El código no se edita: forma parte de los folios ya emitidos.
    const patch = parse(
      z.object({ name: z.string().trim().min(2).max(80).optional(), address: z.string().trim().max(200).optional(), locations: z.array(z.string().trim().min(1).max(60)).max(100).optional(), status: z.enum(['activa', 'inactiva']).optional() }),
      req.body,
    );
    const cur = await col('branches').findOne({ _id: id });
    if (!cur) throw new HttpError(404, 'Sucursal no encontrada');
    const set: Record<string, unknown> = compact({ ...patch });
    if (Object.keys(set).length === 0) return void res.json({ branch: out(cur), unchanged: true });
    set.updatedAt = new Date().toISOString();
    await col('branches').updateOne({ _id: id }, { $set: set });
    await audit({ userId: me.id, action: 'sucursal.editar', entity: 'branch', entityId: id, branchId: id, detail: { changes: patch } });
    res.json({ branch: out(await col('branches').findOne({ _id: id })) });
  }),
);

// ───────────────────────────── Terminales ─────────────────────────────

const terminalView = (t: Record<string, any>) => {
  const { _id, tokenVersion: _v, ...rest } = t;
  return { id: _id, ...rest };
};

adminRouter.get(
  '/terminals',
  requirePerm('sucursales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const items = await col('terminals').find({ branchId: { $in: me.branchIds } }).sort({ code: 1 }).toArray();
    res.json({ items: items.map(terminalView) });
  }),
);

adminRouter.post(
  '/terminals',
  requirePerm('sucursales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(terminalSchema, req.body);
    assertBranch(me, body.branchId);
    if (!(await col('branches').findOne({ _id: body.branchId }, { projection: { _id: 1 } }))) throw new HttpError(400, 'La sucursal no existe');
    const id = newId();
    const now = new Date().toISOString();
    try {
      await col('terminals').insertOne({ _id: id, id, code: body.code, name: body.name, branchId: body.branchId, kind: body.kind, revoked: false, tokenVersion: 0, lastSyncAt: null, createdAt: now, updatedAt: now });
    } catch (e) {
      throw dupMsg(e, 'Ya existe una terminal con ese código');
    }
    await audit({ userId: me.id, action: 'terminal.crear', entity: 'terminal', entityId: id, branchId: body.branchId, detail: { code: body.code, kind: body.kind } });
    res.status(201).json({ terminal: terminalView((await col('terminals').findOne({ _id: id }))!) });
  }),
);

async function loadTerminal(req: Request) {
  const me = sessionUser(req);
  const t = await col('terminals').findOne({ _id: req.params.id! });
  if (!t) throw new HttpError(404, 'Terminal no encontrada');
  assertBranch(me, t.branchId);
  return { me, t };
}

adminRouter.patch(
  '/terminals/:id',
  requirePerm('sucursales.gestionar'),
  ah(async (req, res) => {
    const { me, t } = await loadTerminal(req);
    const patch = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), kind: z.enum(['escritorio', 'movil']).optional() }), req.body);
    const set: Record<string, unknown> = compact({ ...patch });
    if (Object.keys(set).length === 0) return void res.json({ terminal: terminalView(t), unchanged: true });
    set.updatedAt = new Date().toISOString();
    await col('terminals').updateOne({ _id: t._id }, { $set: set });
    await audit({ userId: me.id, action: 'terminal.editar', entity: 'terminal', entityId: t._id, branchId: t.branchId, detail: { changes: patch } });
    res.json({ terminal: terminalView((await col('terminals').findOne({ _id: t._id }))!) });
  }),
);

/** Emite un token de terminal (válido solo en /sync/*). Invalida los anteriores. Se muestra UNA vez: no se guarda. */
adminRouter.post(
  '/terminals/:id/token',
  requirePerm('sucursales.gestionar'),
  requireReauth,
  ah(async (req, res) => {
    const { me, t } = await loadTerminal(req);
    const upd = await col('terminals').findOneAndUpdate({ _id: t._id }, { $inc: { tokenVersion: 1 }, $set: { revoked: false, tokenIssuedAt: new Date().toISOString(), tokenIssuedBy: me.id } }, { returnDocument: 'after' });
    const token = await signTerminal(t._id, upd!.tokenVersion);
    await audit({ userId: me.id, action: 'terminal.token_emitido', entity: 'terminal', entityId: t._id, branchId: t.branchId, detail: { code: t.code } });
    res.json({ terminalId: t._id, token, note: 'Guarda este token ahora en la terminal: no se puede volver a consultar. Al emitir uno nuevo, el anterior deja de funcionar.' });
  }),
);

adminRouter.post(
  '/terminals/:id/revoke',
  requirePerm('sucursales.gestionar'),
  requireReauth,
  ah(async (req, res) => {
    const { me, t } = await loadTerminal(req);
    await col('terminals').updateOne({ _id: t._id }, { $set: { revoked: true, revokedAt: new Date().toISOString() }, $inc: { tokenVersion: 1 } });
    await audit({ userId: me.id, action: 'terminal.revocar', entity: 'terminal', entityId: t._id, branchId: t.branchId, detail: { code: t.code } });
    res.json({ ok: true });
  }),
);

// ───────────────────────────── Permisos temporales ─────────────────────────────

adminRouter.get(
  '/grants',
  requirePerm('permisos_temporales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const q = parse(z.object({ branchId: z.string().optional(), active: z.enum(['1', '0']).optional() }).merge(pageQuery(100, 500)), req.query);
    const filter: Record<string, unknown> = { branchId: { $in: branchScope(me, q.branchId) } };
    const now = new Date().toISOString();
    if (q.active === '1') Object.assign(filter, { revokedAt: null, startsAt: { $lte: now }, expiresAt: { $gt: now } });
    const grants = await col('grants').find(filter).sort({ startsAt: -1 }).skip(q.offset).limit(q.limit).toArray();
    const sellers = await col('users').find({ _id: { $in: [...new Set(grants.map((g) => g.sellerId))] } }).project({ name: 1 }).toArray();
    const names = new Map(sellers.map((s) => [s._id as string, s.name as string]));
    res.json({ items: grants.map((g) => ({ ...out(g), sellerName: names.get(g.sellerId) ?? null })) });
  }),
);

adminRouter.post(
  '/grants',
  requirePerm('permisos_temporales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(grantCreateSchema, req.body);
    assertBranch(me, body.branchId);
    const seller = await col('users').findOne({ _id: body.sellerId });
    if (!seller || !seller.active) throw new HttpError(404, 'Vendedor no encontrado o inactivo');
    if (seller.role !== 'vendedor') throw new HttpError(400, 'Los permisos temporales son solo para vendedores');
    if (!(seller.branchIds ?? []).includes(body.branchId)) throw new HttpError(400, 'El vendedor no pertenece a esa sucursal');
    const startsAt = new Date(body.startsAt).toISOString();
    const expiresAt = new Date(Date.parse(startsAt) + body.durationMinutes * 60_000).toISOString();
    if (expiresAt <= new Date().toISOString()) throw new HttpError(400, 'El permiso ya estaría vencido');
    const id = newId();
    await col('grants').insertOne({ _id: id, id, sellerId: body.sellerId, branchId: body.branchId, functions: body.functions, startsAt, expiresAt, revokedAt: null, grantedBy: me.id, createdAt: new Date().toISOString() });
    await audit({ userId: me.id, action: 'permiso_temporal.crear', entity: 'grant', entityId: id, branchId: body.branchId, detail: { sellerId: body.sellerId, functions: body.functions, startsAt, expiresAt } });
    res.status(201).json({ grant: out(await col('grants').findOne({ _id: id })) });
  }),
);

adminRouter.post(
  '/grants/:id/revoke',
  requirePerm('permisos_temporales.gestionar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const g = await col('grants').findOne({ _id: req.params.id! });
    if (!g) throw new HttpError(404, 'Permiso no encontrado');
    assertBranch(me, g.branchId);
    if (g.revokedAt) return void res.json({ ok: true, unchanged: true, grant: out(g) });
    const now = new Date().toISOString();
    await col('grants').updateOne({ _id: g._id, revokedAt: null }, { $set: { revokedAt: now, revokedBy: me.id } });
    await audit({ userId: me.id, action: 'permiso_temporal.revocar', entity: 'grant', entityId: g._id, branchId: g.branchId, detail: { sellerId: g.sellerId } });
    res.json({ ok: true, grant: out(await col('grants').findOne({ _id: g._id })) });
  }),
);

// ───────────────────────────── Conflictos de sincronización ─────────────────────────────

adminRouter.get(
  '/conflicts',
  requirePerm('sync.conflictos'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const q = parse(z.object({ status: z.enum(['abierto', 'resuelto', 'todos']).default('abierto'), branchId: z.string().optional() }).merge(pageQuery(100, 300)), req.query);
    const filter: Record<string, unknown> = { branchId: { $in: branchScope(me, q.branchId) } };
    if (q.status !== 'todos') filter.status = q.status;
    const [total, items] = await Promise.all([
      col('sync_conflicts').countDocuments(filter),
      col('sync_conflicts').find(filter).sort({ createdAt: -1 }).skip(q.offset).limit(q.limit).toArray(),
    ]);
    // La operación original sirve para decidir cómo resolver (p. ej. una venta rechazada).
    const events = await col('sync_events').find({ _id: { $in: items.map((c) => c.opId) } }).project({ op: 1, status: 1, localTs: 1 }).toArray();
    const evMap = new Map(events.map((e) => [e._id as string, e]));
    res.json({ total, items: items.map((c) => ({ ...out(c), op: evMap.get(c.opId)?.op ?? null, opStatus: evMap.get(c.opId)?.status ?? null })) });
  }),
);

adminRouter.post(
  '/conflicts/:id/resolve',
  requirePerm('sync.conflictos'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(z.object({ note: z.string().trim().min(3).max(300) }), req.body);
    const c = await col('sync_conflicts').findOne({ _id: req.params.id! });
    if (!c) throw new HttpError(404, 'Conflicto no encontrado');
    assertBranch(me, c.branchId);
    if (c.status === 'resuelto') throw new HttpError(409, 'El conflicto ya estaba resuelto');
    const now = new Date().toISOString();
    await col('sync_conflicts').updateOne({ _id: c._id, status: 'abierto' }, { $set: { status: 'resuelto', resolvedBy: me.id, resolvedAt: now, note: body.note } });
    await audit({ userId: me.id, action: 'sync.conflicto_resuelto', entity: 'sync_conflict', entityId: c._id, branchId: c.branchId, detail: { kind: c.kind, note: body.note } });
    res.json({ ok: true });
  }),
);

// ───────────────────────────── Auditoría y respaldos ─────────────────────────────

adminRouter.get(
  '/audit',
  requirePerm('auditoria.ver'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const q = parse(z.object({ entity: z.string().max(40).optional(), action: z.string().max(60).optional(), from: dayStr.optional(), to: dayStr.optional() }).merge(pageQuery(100, 500)), req.query);
    const range = dayRangeIso(q.from, q.to);
    // Eventos de sus sucursales y eventos globales (sin sucursal).
    const filter: Record<string, unknown> = { branchId: { $in: [...me.branchIds, null] }, ...isoRangeFilter('at', range.from, range.to) };
    if (q.entity) filter.entity = q.entity;
    if (q.action) filter.action = q.action;
    const [total, items] = await Promise.all([
      col('audit_log').countDocuments(filter),
      col('audit_log').find(filter).sort({ at: -1 }).skip(q.offset).limit(q.limit).toArray(),
    ]);
    res.json({ total, items: items.map((a) => out(a)) });
  }),
);

/** Registro de respaldos (solo nombres, conteos y verificación; sin datos del negocio). */
adminRouter.get(
  '/backups',
  requirePerm('respaldos.ver'),
  ah(async (_req, res) => {
    const items = await col('backups_log').find({}).sort({ at: -1 }).limit(100).toArray();
    res.json({ items: items.map((b) => out(b)) });
  }),
);

// ───────────────────────────── Sincronización y diagnóstico ─────────────────────────────

adminRouter.get(
  '/sync/status',
  requirePerm('sync.estado'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    // El desarrollador ve la infraestructura completa (solo datos técnicos); el gerente, sus sucursales.
    const scoped = can(me.role, 'sync.conflictos') ? { branchId: { $in: me.branchIds } } : {};
    const [terminals, pending, openConflicts] = await Promise.all([
      col('terminals').find(scoped).sort({ code: 1 }).toArray(),
      col('sync_events').aggregate([{ $match: { ...scoped, status: { $in: ['procesando', 'error'] } } }, { $group: { _id: '$terminalId', n: { $sum: 1 } } }]).toArray(),
      col('sync_conflicts').countDocuments({ ...scoped, status: 'abierto' }),
    ]);
    const pendingMap = new Map(pending.map((p) => [p._id as string, p.n as number]));
    res.json({
      serverTime: new Date().toISOString(),
      openConflicts,
      terminals: terminals.map((t) => ({
        id: t._id, code: t.code, name: t.name, branchId: t.branchId, kind: t.kind, revoked: !!t.revoked,
        lastSyncAt: t.lastSyncAt ?? null, lastPullAt: t.lastPullAt ?? null, pendingEvents: pendingMap.get(t._id) ?? 0,
      })),
    });
  }),
);

/** Solo técnico: sin ventas, importes ni existencias. */
adminRouter.get(
  '/diagnostics',
  requirePerm('sistema.diagnostico'),
  ah(async (_req, res) => {
    const t0 = Date.now();
    let dbOk = true;
    try {
      await getDb().command({ ping: 1 });
    } catch {
      dbOk = false;
    }
    const mem = process.memoryUsage();
    res.json({
      version: config.version, node: process.version, serverTime: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()),
      database: { connected: dbOk, latencyMs: Date.now() - t0 }, memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
    });
  }),
);
