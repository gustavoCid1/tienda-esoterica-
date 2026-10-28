/** v2: tokens de seguridad, límite de fallos, verificación en línea y reglas de autorización de rutas. Sin base de datos. */
import { describe, expect, it } from 'vitest';
import { hashTokenCode } from '@amara/shared';
import type { CachedSecurityToken } from '@amara/shared';
import { assertMayAttempt, verificationFilter } from '../src/authz-rules.ts';
import { buildToken, checkAuthorization, FailureLimiter, matchTokenCode, tokenView } from '../src/security.ts';
import type { AuthzDeps } from '../src/security.ts';
import { verifyOnline } from '../src/verify-online.ts';
import type { AdminWithHash, VerifyDeps } from '../src/verify-online.ts';
import { HttpError } from '../src/http.ts';

const B1 = 'b1111111-1111-4111-8111-111111111111';
const B2 = 'b2222222-2222-4222-8222-222222222222';
const NOW = '2026-10-22T18:00:00.000Z';
const ctx = { id: 'tok-1', createdBy: 'ger-1', nowIso: NOW };

describe('buildToken', () => {
  it('guarda sal + hash, nunca el código; el código solo está en el resultado', () => {
    const { doc, code } = buildToken({ label: ' Cierre ', purposes: ['cierre_caja', 'cierre_caja', 'limpias'], durationMinutes: 60, branchId: B1 }, ctx);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(doc.label).toBe('Cierre');
    expect(doc.purposes).toEqual(['cierre_caja', 'limpias']);
    expect(doc.expiresAt).toBe('2026-10-22T19:00:00.000Z');
    expect(doc.hash).toBe(hashTokenCode(code, doc.salt));
    expect(JSON.stringify(doc)).not.toContain(code);
    expect([doc.usedCount, doc.revokedAt, doc.maxUses, doc.forUserId, doc.createdBy]).toEqual([0, null, null, null, 'ger-1']);
  });
  it('respeta longitud, usuario destino y máximo de usos; cada token tiene sal y código distintos', () => {
    const a = buildToken({ label: 'x1', purposes: ['devolucion'], durationMinutes: 5, forUserId: 'u1', maxUses: 2, length: 10 }, ctx);
    const b = buildToken({ label: 'x1', purposes: ['devolucion'], durationMinutes: 5 }, ctx);
    expect(a.code).toHaveLength(10);
    expect([a.doc.forUserId, a.doc.maxUses]).toEqual(['u1', 2]);
    expect(a.doc.salt).not.toBe(b.doc.salt);
    expect(a.code).not.toBe(b.code);
  });
  it('la vista pública oculta sal y hash y calcula el estado', () => {
    const { doc } = buildToken({ label: 'Vista', purposes: ['cancelacion'], durationMinutes: 10 }, ctx);
    const v: any = tokenView({ ...doc, _id: doc.id } as any, NOW);
    expect(v.salt).toBeUndefined();
    expect(v.hash).toBeUndefined();
    expect(v._id).toBeUndefined();
    expect(v.status).toBe('vigente');
    expect(tokenView(doc as any, '2026-10-22T19:00:00.000Z').status).toBe('vencido');
    expect(tokenView({ ...doc, revokedAt: NOW, revokedBy: 'g' } as any, NOW).status).toBe('revocado');
    expect(tokenView({ ...doc, revokedAt: NOW, revokedBy: 'g' } as any, NOW).revokedBy).toBe('g');
  });
});

describe('matchTokenCode', () => {
  const mk = (over: Partial<CachedSecurityToken> = {}, code = 'ABCD2345') => {
    const { doc } = buildToken({ label: 'T', purposes: ['cierre_caja'], durationMinutes: 60, branchId: B1 }, ctx);
    const salt = doc.salt;
    return { ...doc, hash: hashTokenCode(code, salt), ...over } as CachedSecurityToken;
  };
  const p = { purpose: 'cierre_caja' as const, branchId: B1, userId: 'ven-1', atIso: NOW };
  it('acepta el código sin importar mayúsculas, espacios o guiones', () => {
    for (const c of ['ABCD2345', 'abcd2345', 'abcd-2345', ' ABCD 2345 ']) expect(matchTokenCode(c, [mk()], p).ok).toBe(true);
  });
  it('código equivocado → no_coincide; vigencia mal → razón concreta', () => {
    expect(matchTokenCode('ZZZZ9999', [mk()], p)).toEqual({ ok: false, reason: 'no_coincide' });
    expect(matchTokenCode('ABCD2345', [mk({ purposes: ['devolucion'] })], p)).toEqual({ ok: false, reason: 'proposito' });
    expect(matchTokenCode('ABCD2345', [mk({ branchId: B2 })], p)).toEqual({ ok: false, reason: 'sucursal' });
    expect(matchTokenCode('ABCD2345', [mk({ forUserId: 'otro' })], p)).toEqual({ ok: false, reason: 'usuario' });
    expect(matchTokenCode('ABCD2345', [mk({ expiresAt: '2026-10-22T17:59:00.000Z' })], p)).toEqual({ ok: false, reason: 'vencido' });
    expect(matchTokenCode('ABCD2345', [mk({ revokedAt: '2026-10-22T17:00:00.000Z' })], p)).toEqual({ ok: false, reason: 'revocado' });
    expect(matchTokenCode('ABCD2345', [mk({ maxUses: 1, usedCount: 1 })], p)).toEqual({ ok: false, reason: 'agotado' });
  });
  it('con varios candidatos con el mismo código usa el que sí sirve', () => {
    const bad = mk({ purposes: ['devolucion'], id: 'a' });
    const good = mk({ id: 'b' });
    const r = matchTokenCode('ABCD2345', [bad, good], p);
    expect(r.ok && r.token.id).toBe('b');
  });
});

describe('FailureLimiter (5 fallos por minuto)', () => {
  it('bloquea al sexto intento y avisa cuántos segundos faltan; otra llave no se afecta', () => {
    let t = 1_000_000;
    const l = new FailureLimiter(5, 60_000, () => t);
    for (let i = 0; i < 5; i++) {
      expect(l.blockedFor('u:1')).toBe(0);
      l.fail('u:1');
      t += 1000;
    }
    const wait = l.blockedFor('u:1');
    expect(wait > 0 && wait <= 60).toBe(true);
    expect(l.blockedFor('t:9')).toBe(0);
  });
  it('se libera cuando el primer fallo sale de la ventana, y un acierto reinicia', () => {
    let t = 0;
    const l = new FailureLimiter(5, 60_000, () => t);
    for (let i = 0; i < 5; i++) l.fail('k');
    expect(l.blockedFor('k')).toBe(60);
    t = 59_999;
    expect(l.blockedFor('k')).toBe(1);
    t = 60_000;
    expect(l.blockedFor('k')).toBe(0);
    for (let i = 0; i < 5; i++) l.fail('k');
    l.reset('k');
    expect(l.blockedFor('k')).toBe(0);
  });
});

// ───────────────────────────── checkAuthorization ─────────────────────────────

const users: Record<string, AdminWithHash> = {
  ger: { id: 'ger', name: 'Gerente', role: 'gerente', active: true, branchIds: [B1], passwordHash: 'h:secreto' },
  ger2: { id: 'ger2', name: 'Otra', role: 'gerente', active: true, branchIds: [B2], passwordHash: 'h:otra' },
  inactivo: { id: 'inactivo', name: 'Baja', role: 'gerente', active: false, branchIds: [B1], passwordHash: 'h:baja' },
  ven: { id: 'ven', name: 'Vendedora', role: 'vendedor', active: true, branchIds: [B1], passwordHash: 'h:ven' },
};
function authzDeps(tokens: CachedSecurityToken[] = [], uses: string[] = []): AuthzDeps {
  return {
    getUser: async (id) => users[id] ?? null,
    getSecurityToken: async (id) => tokens.find((t) => t.id === id) ?? null,
    hasTokenUse: async (tokenId, opId) => uses.includes(`${tokenId}:${opId}`),
  };
}
const tokenDoc = (over: Partial<CachedSecurityToken> = {}): CachedSecurityToken => ({ ...buildToken({ label: 'T', purposes: ['devolucion'], durationMinutes: 60, branchId: B1 }, { ...ctx, createdBy: 'ger' }).doc, ...over });
const base = { purpose: 'devolucion' as const, branchId: B1, userId: 'ven', opId: 'op-1', atIso: NOW };

describe('checkAuthorization', () => {
  it('contraseña de un gerente activo de la sucursal → ok y queda él como autorizador', async () => {
    const r = await checkAuthorization(authzDeps(), { kind: 'admin_password', adminUserId: 'ger' }, base);
    expect(r).toEqual({ ok: true, authorization: { kind: 'admin_password', adminUserId: 'ger' }, authorizedBy: 'ger', authorizedByName: 'Gerente', tokenId: null });
  });
  it('gerente de otra sucursal, inactivo, vendedor o inexistente → inválida', async () => {
    for (const id of ['ger2', 'inactivo', 'ven', 'nadie']) {
      const r = await checkAuthorization(authzDeps(), { kind: 'admin_password', adminUserId: id }, base);
      expect(r.ok).toBe(false);
    }
  });
  it('token vigente → ok con el creador como autorizador; el token no se consume aquí', async () => {
    const t = tokenDoc();
    const r = await checkAuthorization(authzDeps([t]), { kind: 'token', tokenId: t.id }, base);
    expect(r.ok && [r.authorizedBy, r.tokenId]).toEqual(['ger', t.id]);
  });
  it('basura, nulo o sin formato → inválida con mensaje', async () => {
    for (const raw of [undefined, null, 'x', 5, {}, { kind: 'token' }, { kind: 'otro', tokenId: 'a' }]) {
      const r = await checkAuthorization(authzDeps(), raw, base);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail.length > 5).toBe(true);
    }
  });
  it('token inexistente, de otro propósito, vencido a esa hora o agotado → inválida', async () => {
    expect((await checkAuthorization(authzDeps(), { kind: 'token', tokenId: 'no' }, base)).ok).toBe(false);
    const wrong = tokenDoc({ purposes: ['limpias'] });
    expect((await checkAuthorization(authzDeps([wrong]), { kind: 'token', tokenId: wrong.id }, base)).ok).toBe(false);
    const t = tokenDoc();
    expect((await checkAuthorization(authzDeps([t]), { kind: 'token', tokenId: t.id }, { ...base, atIso: '2026-10-22T19:30:00.000Z' })).ok).toBe(false);
    const full = tokenDoc({ maxUses: 1, usedCount: 1 });
    expect((await checkAuthorization(authzDeps([full]), { kind: 'token', tokenId: full.id }, base)).ok).toBe(false);
  });
  it('reproceso: si ESTA operación ya contó su uso, el token con máximo de usos sigue valiendo', async () => {
    const full = tokenDoc({ maxUses: 1, usedCount: 1 });
    const r = await checkAuthorization(authzDeps([full], [`${full.id}:op-1`]), { kind: 'token', tokenId: full.id }, base);
    expect(r.ok).toBe(true);
  });
});

// ───────────────────────────── verifyOnline ─────────────────────────────

function verifyDeps(tokens: CachedSecurityToken[] = []): VerifyDeps {
  return {
    candidateTokens: async (branchId) => tokens.filter((t) => t.branchId === null || t.branchId === branchId),
    getUser: async (id) => users[id] ?? null,
    branchAdmins: async (branchId, f) =>
      Object.values(users).filter((u) => u.role === 'gerente' && u.active && u.branchIds.includes(branchId) && (!f.adminUserId || u.id === f.adminUserId) && (!f.adminUsername || u.id === f.adminUsername)),
    checkPassword: (hash, pw) => hash === `h:${pw}`,
  };
}

describe('verifyOnline', () => {
  it('código correcto → ok con tokenId y vencimiento; el código viene sin normalizar', async () => {
    const { doc, code } = buildToken({ label: 'T', purposes: ['limpias'], durationMinutes: 30, branchId: B1 }, { ...ctx, createdBy: 'ger' });
    const r = await verifyOnline(verifyDeps([doc]), { code: code.toLowerCase(), purpose: 'limpias', branchId: B1 }, 'ven', NOW);
    expect(r.ok && [r.tokenId, r.expiresAt, r.authorizedBy, r.authorization]).toEqual([doc.id, doc.expiresAt, 'ger', { kind: 'token', tokenId: doc.id }]);
  });
  it('código incorrecto, otro propósito o token de otro usuario → denegado con motivo en español', async () => {
    const { doc, code } = buildToken({ label: 'T', purposes: ['limpias'], durationMinutes: 30, branchId: B1, forUserId: 'otro' }, { ...ctx, createdBy: 'ger' });
    const bad = await verifyOnline(verifyDeps([doc]), { code: 'NOEXISTE', purpose: 'limpias', branchId: B1 }, 'ven', NOW);
    expect(bad).toEqual({ ok: false, reason: 'no_coincide', message: 'Código incorrecto' });
    const wrongUser = await verifyOnline(verifyDeps([doc]), { code, purpose: 'limpias', branchId: B1 }, 'ven', NOW);
    expect(wrongUser.ok === false && wrongUser.reason).toBe('usuario');
    const wrongPurpose = await verifyOnline(verifyDeps([doc]), { code, purpose: 'cierre_caja', branchId: B1 }, 'otro', NOW);
    expect(wrongPurpose.ok === false && wrongPurpose.reason).toBe('proposito');
  });
  it('contraseña de gerente: correcta con y sin adminUserId; incorrecta, de otra sucursal o inactivo → denegado', async () => {
    const d = verifyDeps();
    const ok = await verifyOnline(d, { adminPassword: 'secreto', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW);
    expect(ok.ok && ok.authorization).toEqual({ kind: 'admin_password', adminUserId: 'ger' });
    expect((await verifyOnline(d, { adminPassword: 'secreto', adminUserId: 'ger', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW)).ok).toBe(true);
    expect((await verifyOnline(d, { adminPassword: 'mal', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW)).ok).toBe(false);
    expect((await verifyOnline(d, { adminPassword: 'otra', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW)).ok).toBe(false); // gerente de OTRA sucursal
    expect((await verifyOnline(d, { adminPassword: 'baja', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW)).ok).toBe(false);
    expect((await verifyOnline(d, { adminPassword: 'ven', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW)).ok).toBe(false); // un vendedor no autoriza
  });
  it('la respuesta nunca incluye el código ni la contraseña', async () => {
    const r = await verifyOnline(verifyDeps(), { adminPassword: 'secreto', purpose: 'cierre_caja', branchId: B1 }, 'ven', NOW);
    expect(JSON.stringify(r)).not.toContain('secreto');
  });
});

// ───────────────────────────── Reglas de ruta (puras) ─────────────────────────────

describe('autorización de acciones en línea', () => {
  it('gerente: directo; vendedor: solo con authorization; desarrollador: nunca', () => {
    expect(assertMayAttempt('gerente', 'caja.corte', false)).toBe('directo');
    expect(assertMayAttempt('vendedor', 'caja.corte', true)).toBe('autorizado');
    expect(() => assertMayAttempt('vendedor', 'caja.corte', false)).toThrow(HttpError);
    expect(() => assertMayAttempt('desarrollador', 'caja.corte', true)).toThrow(HttpError);
    try {
      assertMayAttempt('vendedor', 'ventas.cancelar', false);
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
    }
  });
  it('el filtro de verificación liga usuario, propósito, sucursal y la autorización exacta', () => {
    const now = new Date(NOW);
    expect(verificationFilter('ven', 'cierre_caja', B1, { kind: 'token', tokenId: 't1' }, now)).toEqual({
      requesterKey: 'u:ven', purpose: 'cierre_caja', branchId: B1, 'authorization.kind': 'token', expireAt: { $gt: now }, 'authorization.tokenId': 't1',
    });
    expect(verificationFilter('ven', 'devolucion', B1, { kind: 'admin_password', adminUserId: 'ger' }, now)).toEqual({
      requesterKey: 'u:ven', purpose: 'devolucion', branchId: B1, 'authorization.kind': 'admin_password', expireAt: { $gt: now }, 'authorization.adminUserId': 'ger',
    });
  });
});
