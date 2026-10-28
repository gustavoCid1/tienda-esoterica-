/**
 * /security (v2): tokens de seguridad y verificación de autorizaciones.
 *  - Crear/listar/revocar tokens: SOLO gerente (permiso config.editar); crear exige además x-reauth.
 *  - POST /security/verify: usuario o terminal; limitado a 5 fallos por minuto por usuario/terminal.
 * Del código solo se guardan sal + hash; el código en claro aparece UNA vez, en la respuesta de la creación.
 */
import { Router } from 'express';
import { z } from 'zod';
import { newId, tokenDenyMessage } from '@amara/shared';
import { securityTokenCreateSchema, securityVerifySchema } from '@amara/shared/schemas';
import { audit } from '../audit.ts';
import { assertBranch, requirePerm, requireReauth, requireUser } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import { buildToken, FailureLimiter, tokenView } from '../security.ts';
import { sessionUser } from '../util.ts';
import { verifyOnline } from '../verify-online.ts';
import type { VerifyDeps } from '../verify-online.ts';
import { checkPassword } from './auth.ts';

export const securityRouter = Router();

/** Una verificación en línea vale 10 minutos y se usa UNA vez (la consume la ruta que ejecuta la acción). */
export const VERIFICATION_TTL_MS = 10 * 60_000;
export const verifyLimiter = new FailureLimiter(5, 60_000);

// ───────────────────────────── Tokens (gerente) ─────────────────────────────

securityRouter.post(
  '/tokens',
  requireUser,
  requirePerm('config.editar'),
  requireReauth,
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(securityTokenCreateSchema, req.body);
    // Sin sucursal = vale en todas las del gerente; con sucursal, debe ser una suya.
    if (body.branchId) assertBranch(me, body.branchId);
    if (body.forUserId) {
      const target = await col('users').findOne({ _id: body.forUserId }, { projection: { branchIds: 1, active: 1, role: 1 } });
      if (!target || !target.active) throw new HttpError(400, 'El usuario indicado no existe o está inactivo');
      if (body.branchId && !(target.branchIds ?? []).includes(body.branchId)) throw new HttpError(400, 'El usuario indicado no pertenece a esa sucursal');
    }
    const nowIso = new Date().toISOString();
    const { doc, code } = buildToken(body, { id: newId(), createdBy: me.id, nowIso });
    await col('security_tokens').insertOne({ _id: doc.id as any, ...doc });
    await audit({
      userId: me.id, action: 'token.crear', entity: 'security_token', entityId: doc.id, branchId: doc.branchId,
      detail: { label: doc.label, purposes: doc.purposes, expiresAt: doc.expiresAt, forUserId: doc.forUserId, maxUses: doc.maxUses },
    });
    res.status(201).json({ id: doc.id, code, expiresAt: doc.expiresAt, note: 'Guarda este código ahora: no se puede volver a consultar.' });
  }),
);

securityRouter.get(
  '/tokens',
  requireUser,
  requirePerm('config.editar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const q = parse(z.object({ status: z.enum(['vigente', 'vencido', 'revocado', 'agotado', 'pendiente']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    // Del gerente: los de sus sucursales y los generales (sin sucursal).
    const docs = await col('security_tokens').find({ branchId: { $in: [...me.branchIds, null] } }).sort({ createdAt: -1 }).limit(q.limit).toArray();
    const nowIso = new Date().toISOString();
    let items = docs.map((d) => tokenView(d as any, nowIso));
    if (q.status) items = items.filter((t) => t.status === q.status);
    res.json({ items });
  }),
);

securityRouter.post(
  '/tokens/:id/revoke',
  requireUser,
  requirePerm('config.editar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const t = await col('security_tokens').findOne({ _id: req.params.id! as any });
    if (!t) throw new HttpError(404, 'Token no encontrado');
    if (t.branchId) assertBranch(me, t.branchId);
    const nowIso = new Date().toISOString();
    if (!t.revokedAt) {
      await col('security_tokens').updateOne({ _id: t._id }, { $set: { revokedAt: nowIso, revokedBy: me.id } });
      await audit({ userId: me.id, action: 'token.revocar', entity: 'security_token', entityId: t._id as any, branchId: t.branchId ?? null, detail: { label: t.label } });
    }
    res.json({ ok: true, token: tokenView((await col('security_tokens').findOne({ _id: t._id })) as any, nowIso) });
  }),
);

// ───────────────────────────── Verificación ─────────────────────────────

const mongoDeps: VerifyDeps = {
  async candidateTokens(branchId) {
    const docs = await col('security_tokens').find({ branchId: { $in: [branchId, null] }, revokedAt: null }).limit(500).toArray();
    return docs.map((d: any) => ({ ...d, id: d._id }));
  },
  async getUser(id) {
    const u = await col('users').findOne({ _id: id as any }, { projection: { name: 1, role: 1, active: 1, branchIds: 1, passwordHash: 1 } });
    return u ? { id: u._id as any, name: u.name, role: u.role, active: !!u.active, branchIds: u.branchIds ?? [], passwordHash: u.passwordHash } : null;
  },
  async branchAdmins(branchId, f) {
    const filter: Record<string, unknown> = { role: 'gerente', active: true, branchIds: branchId };
    if (f.adminUserId) filter._id = f.adminUserId;
    if (f.adminUsername) filter.username = f.adminUsername.toLowerCase();
    const docs = await col('users').find(filter).limit(20).toArray();
    return docs.map((u) => ({ id: u._id as any, name: u.name, role: u.role, active: !!u.active, branchIds: u.branchIds ?? [], username: u.username, passwordHash: u.passwordHash }));
  },
  checkPassword: (hash, password) => checkPassword(hash ? { passwordHash: hash } : null, password),
};

securityRouter.post(
  '/verify',
  ah(async (req, res) => {
    const body = parse(securityVerifySchema, req.body);
    const user = req.user;
    const term = req.terminal;
    if (!user && !term) throw new HttpError(401, 'Falta iniciar sesión');
    if (user) assertBranch(user, body.branchId);
    else if (term!.branchId !== body.branchId) throw new HttpError(403, 'La terminal solo verifica en su sucursal');
    const key = user ? `u:${user.id}` : `t:${term!.id}`;

    const wait = verifyLimiter.blockedFor(key);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return void res.status(429).json({ ok: false, error: `Demasiados intentos fallidos. Espera ${wait} s e inténtalo de nuevo.`, retryAfterSeconds: wait });
    }

    const now = new Date();
    const outcome = await verifyOnline(mongoDeps, body, user?.id ?? '', now.toISOString());
    if (!outcome.ok) {
      verifyLimiter.fail(key);
      await audit({
        userId: user?.id ?? null, action: 'seguridad.verificacion_fallida', entity: 'security_token', branchId: body.branchId, terminalId: term?.id ?? null,
        detail: { purpose: body.purpose, via: body.code ? 'token' : 'admin_password', reason: outcome.reason },
      });
      // 200 con ok:false: así una denegación no se confunde con "sin conexión" en los clientes.
      return void res.json({ ok: false, reason: outcome.reason, message: outcome.message || tokenDenyMessage('no_coincide') });
    }
    verifyLimiter.reset(key);
    const verifiedUntil = new Date(now.getTime() + VERIFICATION_TTL_MS);
    await col('security_verifications').insertOne({
      _id: newId() as any, requesterKey: key, userId: user?.id ?? null, purpose: body.purpose, branchId: body.branchId, authorization: outcome.authorization,
      authorizedBy: outcome.authorizedBy, createdAt: now.toISOString(), expireAt: verifiedUntil,
    });
    await audit({
      userId: user?.id ?? null, action: 'seguridad.verificacion', entity: 'security_token', entityId: outcome.tokenId ?? undefined, branchId: body.branchId, terminalId: term?.id ?? null,
      detail: { purpose: body.purpose, authorization: outcome.authorization, authorizedBy: outcome.authorizedBy },
    });
    res.json({
      ok: true, tokenId: outcome.tokenId, expiresAt: outcome.expiresAt, authorization: outcome.authorization, authorizedBy: outcome.authorizedBy,
      authorizedByName: outcome.authorizedByName, verifiedUntil: verifiedUntil.toISOString(),
    });
  }),
);
