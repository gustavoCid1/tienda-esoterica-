import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  TOKEN_ALPHABET, TOKEN_CODE_MAX_LENGTH, generateTokenCode, generateTokenSalt, hashTokenCode, isTokenActive, normalizeTokenCode,
  sha256Hex, tokenExpiresAt, tokenStatus, verifyTokenCodeLocal, whyTokenInactive,
} from '../src/tokens.ts';
import type { CachedSecurityToken } from '../src/types.ts';

const B1 = 'branch-1';
const B2 = 'branch-2';
const T0 = '2026-10-22T16:00:00.000Z';
const plus = (min: number, base = T0) => new Date(Date.parse(base) + min * 60_000).toISOString();

function makeToken(code: string, over: Partial<CachedSecurityToken> = {}): CachedSecurityToken {
  const salt = over.salt ?? 'sal-de-prueba';
  return {
    id: 'tok-1', label: 'Cierre de la tarde', purposes: ['cierre_caja'], branchId: B1, forUserId: null,
    createdBy: 'admin-1', createdAt: T0, expiresAt: plus(30), revokedAt: null, maxUses: null, usedCount: 0,
    salt, hash: hashTokenCode(code, salt), ...over,
  };
}

test('sha256Hex coincide con node:crypto (vacío, abc, acentos, mensaje largo y límites de bloque)', () => {
  const samples = ['', 'abc', 'sal:ABCD2345', 'Esotérica Amara ñandú 🔮', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)];
  for (const s of samples) assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s.slice(0, 20)));
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('generateTokenCode: 8 por omisión, nunca más de 10, solo alfabeto sin ambiguos', () => {
  assert.equal(generateTokenCode().length, 8);
  assert.equal(generateTokenCode(6).length, 6);
  assert.equal(generateTokenCode(10).length, 10);
  assert.equal(generateTokenCode(25).length, TOKEN_CODE_MAX_LENGTH, 'se ajusta al máximo de 10');
  assert.equal(generateTokenCode(1).length, 4, 'mínimo 4');
  assert.equal(generateTokenCode(NaN).length, 8);
  assert.ok(!/[01OI]/.test(TOKEN_ALPHABET), 'el alfabeto no tiene 0, 1, O ni I');
  assert.equal(TOKEN_ALPHABET.length, 32);
  for (let i = 0; i < 300; i++) {
    const c = generateTokenCode(10);
    assert.match(c, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
  }
  const unique = new Set(Array.from({ length: 200 }, () => generateTokenCode()));
  assert.ok(unique.size > 195, 'los códigos no se repiten');
});

test('hashTokenCode: sha256 de "salt:CODIGO", insensible a mayúsculas, espacios y guiones; depende de la sal', () => {
  const h = hashTokenCode('abcd2345', 'sal1');
  assert.equal(h, createHash('sha256').update('sal1:ABCD2345').digest('hex'));
  assert.equal(hashTokenCode('ABCD-2345', 'sal1'), h);
  assert.equal(hashTokenCode(' abcd 2345 ', 'sal1'), h);
  assert.notEqual(hashTokenCode('ABCD2345', 'sal2'), h);
  assert.notEqual(hashTokenCode('ABCD2346', 'sal1'), h);
  assert.equal(normalizeTokenCode(' ab-cd '), 'ABCD');
  assert.match(generateTokenSalt(), /^[0-9a-f]{32}$/);
});

test('isTokenActive: vigencia (inicio, fin exclusivo y revocación)', () => {
  const t = makeToken('ABCD2345');
  assert.equal(isTokenActive(t, 'cierre_caja', B1, T0), true);
  assert.equal(isTokenActive(t, 'cierre_caja', B1, plus(29)), true);
  assert.equal(isTokenActive(t, 'cierre_caja', B1, plus(30)), false, 'vence exactamente en expiresAt');
  assert.equal(isTokenActive(t, 'cierre_caja', B1, plus(300)), false);
  assert.equal(whyTokenInactive(t, 'cierre_caja', B1, plus(31)), 'vencido');
  // antes de crearse (más allá de la tolerancia de reloj de 5 min)
  assert.equal(isTokenActive(t, 'cierre_caja', B1, plus(-60)), false);
  assert.equal(whyTokenInactive(t, 'cierre_caja', B1, plus(-60)), 'pendiente');
  assert.equal(isTokenActive(t, 'cierre_caja', B1, plus(-3)), true, 'tolerancia de reloj de 5 minutos');
  // revocado: vale la operación anterior a la revocación, no la posterior
  const rev = makeToken('ABCD2345', { revokedAt: plus(10) });
  assert.equal(isTokenActive(rev, 'cierre_caja', B1, plus(9)), true);
  assert.equal(isTokenActive(rev, 'cierre_caja', B1, plus(10)), false);
  assert.equal(whyTokenInactive(rev, 'cierre_caja', B1, plus(11)), 'revocado');
  assert.equal(tokenStatus(rev, plus(11)), 'revocado');
});

test('isTokenActive: propósito, sucursal y usuario', () => {
  const t = makeToken('ABCD2345', { purposes: ['devolucion', 'cancelacion'] });
  assert.equal(isTokenActive(t, 'devolucion', B1, plus(1)), true);
  assert.equal(isTokenActive(t, 'cancelacion', B1, plus(1)), true);
  assert.equal(isTokenActive(t, 'cierre_caja', B1, plus(1)), false);
  assert.equal(whyTokenInactive(t, 'limpias', B1, plus(1)), 'proposito');
  assert.equal(isTokenActive(t, 'devolucion', B2, plus(1)), false);
  assert.equal(whyTokenInactive(t, 'devolucion', B2, plus(1)), 'sucursal');
  const anyBranch = makeToken('ABCD2345', { branchId: null });
  assert.equal(isTokenActive(anyBranch, 'cierre_caja', B2, plus(1)), true, 'branchId null = cualquier sucursal');
  const forUser = makeToken('ABCD2345', { forUserId: 'vendedora-1' });
  assert.equal(isTokenActive(forUser, 'cierre_caja', B1, plus(1), 'vendedora-1'), true);
  assert.equal(isTokenActive(forUser, 'cierre_caja', B1, plus(1), 'otra'), false);
  assert.equal(isTokenActive(forUser, 'cierre_caja', B1, plus(1)), false, 'si exige usuario y no se indica, no sirve');
  assert.equal(whyTokenInactive(forUser, 'cierre_caja', B1, plus(1), 'otra'), 'usuario');
  const open = makeToken('ABCD2345');
  assert.equal(isTokenActive(open, 'cierre_caja', B1, plus(1), 'cualquiera'), true);
});

test('isTokenActive: máximo de usos', () => {
  assert.equal(isTokenActive(makeToken('ABCD2345', { maxUses: 2, usedCount: 1 }), 'cierre_caja', B1, plus(1)), true);
  const used = makeToken('ABCD2345', { maxUses: 2, usedCount: 2 });
  assert.equal(isTokenActive(used, 'cierre_caja', B1, plus(1)), false);
  assert.equal(whyTokenInactive(used, 'cierre_caja', B1, plus(1)), 'agotado');
  assert.equal(isTokenActive(makeToken('ABCD2345', { maxUses: null, usedCount: 999 }), 'cierre_caja', B1, plus(1)), true, 'null = ilimitado');
});

test('verifyTokenCodeLocal: valida contra la caché y explica por qué falla', () => {
  const a = makeToken('ABCD2345', { id: 'a', salt: 'sa' });
  const b = makeToken('ZXCV6789', { id: 'b', salt: 'sb', purposes: ['limpias'], forUserId: 'vend-1' });
  const cache = [a, b];
  const ok = verifyTokenCodeLocal('abcd-2345', cache, 'cierre_caja', B1, plus(5));
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.token.id, 'a');
  assert.deepEqual(verifyTokenCodeLocal('', cache, 'cierre_caja', B1, plus(5)), { ok: false, reason: 'codigo_vacio' });
  assert.deepEqual(verifyTokenCodeLocal('NOEXISTE1', cache, 'cierre_caja', B1, plus(5)), { ok: false, reason: 'no_coincide' });
  assert.deepEqual(verifyTokenCodeLocal('ABCD2345', cache, 'devolucion', B1, plus(5)), { ok: false, reason: 'proposito' });
  assert.deepEqual(verifyTokenCodeLocal('ABCD2345', cache, 'cierre_caja', B2, plus(5)), { ok: false, reason: 'sucursal' });
  assert.deepEqual(verifyTokenCodeLocal('ABCD2345', cache, 'cierre_caja', B1, plus(45)), { ok: false, reason: 'vencido' });
  assert.deepEqual(verifyTokenCodeLocal('ZXCV6789', cache, 'limpias', B1, plus(5), 'otro'), { ok: false, reason: 'usuario' });
  assert.equal(verifyTokenCodeLocal('ZXCV6789', cache, 'limpias', B1, plus(5), 'vend-1').ok, true);
  const revoked = [makeToken('ABCD2345', { revokedAt: plus(1) })];
  assert.deepEqual(verifyTokenCodeLocal('ABCD2345', revoked, 'cierre_caja', B1, plus(5)), { ok: false, reason: 'revocado' });
  assert.deepEqual(verifyTokenCodeLocal('ABCD2345', [], 'cierre_caja', B1, plus(5)), { ok: false, reason: 'no_coincide' });
});

test('tokenExpiresAt: de 1 minuto a 7 días', () => {
  assert.equal(tokenExpiresAt(T0, 1), plus(1));
  assert.equal(tokenExpiresAt(T0, 90), plus(90));
  assert.equal(tokenExpiresAt(T0, 7 * 24 * 60), plus(7 * 24 * 60));
  assert.throws(() => tokenExpiresAt(T0, 0), RangeError);
  assert.throws(() => tokenExpiresAt(T0, 7 * 24 * 60 + 1), RangeError);
  assert.throws(() => tokenExpiresAt(T0, NaN), RangeError);
});
