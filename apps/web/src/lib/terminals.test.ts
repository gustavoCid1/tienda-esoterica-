import { describe, expect, it } from 'vitest';
import {
  buildCredentials, buildNewTerminalPayload, buildTerminalName, credentialsText, isTerminalRevoked, suggestTerminalCode, unwrapTerminal,
} from './terminals.ts';

describe('código sugerido', () => {
  it('P para PC y M para móvil, el primer número libre', () => {
    expect(suggestTerminalCode('escritorio', [])).toBe('P1');
    expect(suggestTerminalCode('movil', [])).toBe('M1');
    expect(suggestTerminalCode('escritorio', ['P1', 'p2', 'M1'])).toBe('P3');
    expect(suggestTerminalCode('movil', ['P1', 'P2'])).toBe('M1');
  });
  it('rellena huecos y termina vacío si se agotan', () => {
    expect(suggestTerminalCode('escritorio', ['P1', 'P3'])).toBe('P2');
    expect(suggestTerminalCode('escritorio', Array.from({ length: 99 }, (_, i) => `P${i + 1}`))).toBe('');
  });
  it('el código sugerido cumple la regla de la API (1 a 3 caracteres)', () => {
    for (const c of ['P1', 'P99', 'M50']) expect(c).toMatch(/^[A-Z0-9]{1,3}$/);
  });
});

describe('nombre y formulario', () => {
  it('nombre automático con la persona', () => {
    expect(buildTerminalName('escritorio', '  Ana   López ')).toBe('PC de Ana López');
    expect(buildTerminalName('movil', 'Luis')).toBe('Móvil de Luis');
    expect(buildTerminalName('movil', 'x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
  it('arma el cuerpo con assignedTo y kind', () => {
    const r = buildNewTerminalPayload({ kind: 'movil', person: ' Luis ', branchId: 'b1', code: 'm1' }, ['P1']);
    expect(r.payload).toEqual({ code: 'M1', name: 'Móvil de Luis', branchId: 'b1', kind: 'movil', assignedTo: 'Luis' });
  });
  it('valida persona, sucursal, formato y repetidos', () => {
    const r = buildNewTerminalPayload({ kind: 'escritorio', person: 'A', branchId: '', code: 'ABCD' }, []);
    expect(r.payload).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(['branchId', 'code', 'person']);
    expect(buildNewTerminalPayload({ kind: 'escritorio', person: 'Ana', branchId: 'b', code: 'p1' }, ['P1']).errors.code).toMatch(/ya lo usa/);
  });
});

describe('respuestas de la API', () => {
  const t = { id: 't1', code: 'P1', name: 'PC de Ana', kind: 'escritorio', branchId: 'b1', assignedTo: 'Ana' };
  it('acepta el terminal directo o envuelto en { terminal }', () => {
    expect(unwrapTerminal(t)).toEqual(t);
    expect(unwrapTerminal({ terminal: t })).toEqual(t);
    expect(unwrapTerminal({ terminal: { ...t, assignedTo: undefined } })?.assignedTo).toBeNull();
    expect(unwrapTerminal(null)).toBeNull();
    expect(unwrapTerminal({ ok: true })).toBeNull();
  });
  it('arma los datos del segundo modal completando lo que falte', () => {
    const rec = unwrapTerminal(t)!;
    const c = buildCredentials(rec, { terminalId: 't1', token: 'abc.def' });
    expect(c).toEqual({ id: 't1', code: 'P1', name: 'PC de Ana', kind: 'escritorio', branchId: 'b1', assignedTo: 'Ana', token: 'abc.def' });
    expect(buildCredentials(rec, { token: 'x', kind: 'movil', code: 'M9' })).toMatchObject({ kind: 'movil', code: 'M9' });
  });
  it('sin token (se canceló la confirmación) queda en null', () => {
    expect(buildCredentials(unwrapTerminal(t)!, null).token).toBeNull();
    expect(buildCredentials(unwrapTerminal({ ...t, assignedTo: null })!, null, 'Respaldo').assignedTo).toBe('Respaldo');
  });
  it('texto para copiar todo', () => {
    const c = buildCredentials(unwrapTerminal(t)!, { token: 'TOK' });
    const txt = credentialsText(c, 'Centro');
    expect(txt).toContain('ID: t1');
    expect(txt).toContain('Sucursal: Centro');
    expect(txt).toContain('Token de activación: TOK');
    expect(credentialsText({ ...c, token: null }, 'Centro')).not.toContain('Token');
  });
  it('revocada: booleano `revoked` de la API v1 o fecha `revokedAt`', () => {
    expect(isTerminalRevoked({ revoked: true })).toBe(true);
    expect(isTerminalRevoked({ revoked: false, revokedAt: '2026-01-01T00:00:00.000Z' })).toBe(false); // se emitió un token nuevo
    expect(isTerminalRevoked({ revokedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
    expect(isTerminalRevoked({})).toBe(false);
  });
});
