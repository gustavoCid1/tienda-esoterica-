import { describe, expect, it } from 'vitest';
import { AttemptLimiter, AuthGrantStore } from '../src/shared/auth-grants.ts';
import type { AuthGrant } from '../src/shared/auth-grants.ts';

const grant = (over: Partial<AuthGrant> = {}): AuthGrant => ({
  authorization: { kind: 'token', tokenId: 'tok-1' }, trusted: false, purpose: 'cierre_caja', userId: 'u1', byName: 'Rosa', via: 'token', tokenLabel: 'Cierre', ...over,
});

describe('boletos de autorización', () => {
  it('un boleto sirve solo para su usuario y su propósito', () => {
    const s = new AuthGrantStore();
    const id = s.issue(grant());
    expect(s.peek(id, 'cierre_caja', 'u1')?.authorization).toEqual({ kind: 'token', tokenId: 'tok-1' });
    expect(s.peek(id, 'devolucion', 'u1')).toBeNull(); // propósito distinto
    expect(s.peek(id, 'cierre_caja', 'otro')).toBeNull(); // otro usuario
    expect(s.peek('inventado', 'cierre_caja', 'u1')).toBeNull();
    expect(s.peek(undefined, 'cierre_caja', 'u1')).toBeNull();
    expect(s.peek(42, 'cierre_caja', 'u1')).toBeNull();
  });

  it('caduca a los 10 minutos', () => {
    let t = 1_000_000;
    const s = new AuthGrantStore(() => t, 10 * 60_000);
    const id = s.issue(grant());
    t += 9 * 60_000;
    expect(s.peek(id, 'cierre_caja', 'u1')).not.toBeNull();
    t += 2 * 60_000;
    expect(s.peek(id, 'cierre_caja', 'u1')).toBeNull();
    expect(s.size).toBe(0);
  });

  it('peek no consume (si la acción falla se reintenta) y burn sí', () => {
    const s = new AuthGrantStore();
    const id = s.issue(grant());
    expect(s.peek(id, 'cierre_caja', 'u1')).not.toBeNull();
    expect(s.peek(id, 'cierre_caja', 'u1')).not.toBeNull();
    s.burn(id);
    expect(s.peek(id, 'cierre_caja', 'u1')).toBeNull();
  });

  it('al cerrar sesión se olvidan los boletos del usuario', () => {
    const s = new AuthGrantStore();
    const a = s.issue(grant({ userId: 'u1' }));
    const b = s.issue(grant({ userId: 'u2' }));
    s.clearUser('u1');
    expect(s.peek(a, 'cierre_caja', 'u1')).toBeNull();
    expect(s.peek(b, 'cierre_caja', 'u2')).not.toBeNull();
  });
});

describe('límite de intentos', () => {
  it('5 fallos bloquean 1 minuto y un acierto reinicia la cuenta', () => {
    let t = 0;
    const l = new AttemptLimiter(5, 60_000, () => t);
    for (let i = 0; i < 4; i++) l.fail('u1');
    expect(l.blockedFor('u1')).toBe(0);
    l.fail('u1');
    expect(l.blockedFor('u1')).toBeGreaterThan(0);
    expect(l.blockedFor('u2')).toBe(0);
    t += 61_000;
    expect(l.blockedFor('u1')).toBe(0);
    l.fail('u1');
    l.reset('u1');
    for (let i = 0; i < 4; i++) l.fail('u1');
    expect(l.blockedFor('u1')).toBe(0);
  });
});
