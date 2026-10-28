import { describe, expect, it } from 'vitest';
import {
  EMPTY_TOKEN_FORM, buildTokenPayload, durationToMinutes, expiryText, formatTokenDuration, minutesBetween, normalizeCreateResponse,
  normalizeTokenRows, parseNumber, purposesText, tokenStatus, togglePurpose, type TokenForm,
} from './tokens.ts';

const NOW = '2026-10-22T12:00:00.000Z';
const form = (over: Partial<TokenForm> = {}): TokenForm => ({ ...EMPTY_TOKEN_FORM, label: 'Cierre de Ana', purposes: ['cierre_caja'], ...over });

describe('duración', () => {
  it('convierte minutos y horas (con decimales) a minutos', () => {
    expect(durationToMinutes('30', 'minutos')).toBe(30);
    expect(durationToMinutes('2', 'horas')).toBe(120);
    expect(durationToMinutes('1,5', 'horas')).toBe(90);
    expect(durationToMinutes('0', 'minutos')).toBeNull();
    expect(durationToMinutes('abc', 'horas')).toBeNull();
    expect(durationToMinutes(-5, 'minutos')).toBeNull();
    expect(durationToMinutes(45, 'minutos')).toBe(45);
  });
  it('formatea para mostrar', () => {
    expect(formatTokenDuration(1)).toBe('1 min');
    expect(formatTokenDuration(45)).toBe('45 min');
    expect(formatTokenDuration(60)).toBe('1 h');
    expect(formatTokenDuration(90)).toBe('1 h 30 min');
    expect(formatTokenDuration(1440)).toBe('1 día');
    expect(formatTokenDuration(1440 * 2 + 180)).toBe('2 días 3 h');
    expect(formatTokenDuration(0)).toBe('0 min');
    expect(formatTokenDuration(NaN)).toBe('0 min');
  });
  it('minutos entre dos instantes', () => {
    expect(minutesBetween(NOW, '2026-10-22T13:30:00.000Z')).toBe(90);
    expect(minutesBetween(NOW, '2026-10-22T11:00:00.000Z')).toBe(0);
    expect(minutesBetween('x', NOW)).toBe(0);
  });
  it('texto de vencimiento', () => {
    expect(expiryText('2026-10-22T13:05:00.000Z', NOW)).toBe('Vence en 1 h 5 min');
    expect(expiryText('2026-10-22T11:00:00.000Z', NOW)).toBe('Venció hace 1 h');
  });
});

describe('estado del token', () => {
  const base = { revokedAt: null, expiresAt: '2026-10-22T13:00:00.000Z', maxUses: null, usedCount: 0 };
  it('vigente, vencido, revocado y usos agotados', () => {
    expect(tokenStatus(base, NOW)).toBe('vigente');
    expect(tokenStatus(base, '2026-10-22T13:00:00.000Z')).toBe('vencido');
    expect(tokenStatus({ ...base, revokedAt: '2026-10-22T11:00:00.000Z' }, NOW)).toBe('revocado');
    expect(tokenStatus({ ...base, maxUses: 2, usedCount: 2 }, NOW)).toBe('agotado');
    expect(tokenStatus({ ...base, maxUses: 2, usedCount: 1 }, NOW)).toBe('vigente');
  });
  it('revocado manda sobre vencido', () => {
    expect(tokenStatus({ ...base, revokedAt: '2026-10-22T11:00:00.000Z', expiresAt: '2026-10-21T00:00:00.000Z' }, NOW)).toBe('revocado');
  });
  it('sin fecha válida usa el estado que mande el servidor', () => {
    expect(tokenStatus({ ...base, expiresAt: '', status: 'Vencido' }, NOW)).toBe('vencido');
  });
});

describe('formulario de creación', () => {
  it('arma el cuerpo del contrato', () => {
    const r = buildTokenPayload(form({ amount: '2', unit: 'horas', branchId: 'b1', forUserId: 'u1', maxUses: '3', length: '10' }));
    expect(r.payload).toEqual({ label: 'Cierre de Ana', purposes: ['cierre_caja'], durationMinutes: 120, length: 10, branchId: 'b1', forUserId: 'u1', maxUses: 3 });
  });
  it('omite sucursal, usuario y usos cuando están vacíos; longitud por omisión 8', () => {
    const r = buildTokenPayload(form({ length: '' }));
    expect(r.payload).toEqual({ label: 'Cierre de Ana', purposes: ['cierre_caja'], durationMinutes: 30, length: 8 });
  });
  it('valida etiqueta, propósitos, duración, usos y longitud', () => {
    const r = buildTokenPayload(form({ label: ' a ', purposes: [], amount: '0', maxUses: '0', length: '11' }));
    expect(r.payload).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(['amount', 'label', 'length', 'maxUses', 'purposes']);
  });
  it('límites de duración: 1 minuto a 7 días', () => {
    expect(buildTokenPayload(form({ amount: '1', unit: 'minutos' })).payload?.durationMinutes).toBe(1);
    expect(buildTokenPayload(form({ amount: '168', unit: 'horas' })).payload?.durationMinutes).toBe(10080);
    expect(buildTokenPayload(form({ amount: '169', unit: 'horas' })).errors.amount).toMatch(/máxima/);
    expect(buildTokenPayload(form({ amount: '0,4', unit: 'minutos' })).payload).toBeNull(); // redondea a 0
  });
  it('longitud mínima 4 y máxima 10', () => {
    expect(buildTokenPayload(form({ length: '3' })).errors.length).toBeTruthy();
    expect(buildTokenPayload(form({ length: '4' })).payload?.length).toBe(4);
    expect(buildTokenPayload(form({ length: '10' })).payload?.length).toBe(10);
  });
  it('alterna propósitos sin mutar', () => {
    const a = togglePurpose([], 'limpias');
    expect(a).toEqual(['limpias']);
    expect(togglePurpose(a, 'limpias')).toEqual([]);
    expect(a).toEqual(['limpias']);
  });
  it('números con coma', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('1e3')).toBeNull();
  });
});

describe('respuestas del servidor', () => {
  it('lista: arreglo o { items }; descarta filas sin id y propósitos desconocidos', () => {
    const row = { id: 't1', label: 'X', purposes: ['limpias', 'otro'], branchId: null, expiresAt: NOW, usedCount: 2, maxUses: 5 };
    expect(normalizeTokenRows([row])[0]).toMatchObject({ id: 't1', purposes: ['limpias'], maxUses: 5, usedCount: 2, branchId: null, revokedAt: null });
    expect(normalizeTokenRows({ items: [row, { label: 'sin id' }] })).toHaveLength(1);
    expect(normalizeTokenRows(null)).toEqual([]);
  });
  it('creación: exige código y completa expiresAt', () => {
    expect(normalizeCreateResponse({ id: 't', code: 'ABCD2345', expiresAt: NOW }, 'fb')).toEqual({ id: 't', code: 'ABCD2345', expiresAt: NOW });
    expect(normalizeCreateResponse({ id: 't', code: 'ABCD2345' }, 'fb')?.expiresAt).toBe('fb');
    expect(normalizeCreateResponse({ id: 't' }, 'fb')).toBeNull();
    expect(normalizeCreateResponse(null, 'fb')).toBeNull();
  });
  it('texto de propósitos', () => {
    expect(purposesText(['cierre_caja', 'limpias'])).toBe('Cierre de caja, Limpias');
    expect(purposesText([])).toBe('-');
  });
});
