import { describe, expect, it } from 'vitest';
import { buildTokenBody, clampLength, describeAuthorization, durationToMinutes, formatDuration } from '../src/shared/token-form.ts';

describe('duración del token (minutos u horas)', () => {
  it('convierte minutos y horas, con decimales', () => {
    expect(durationToMinutes('30', 'minutos')).toEqual({ ok: true, minutes: 30 });
    expect(durationToMinutes('2', 'horas')).toEqual({ ok: true, minutes: 120 });
    expect(durationToMinutes('1.5', 'horas')).toEqual({ ok: true, minutes: 90 });
    expect(durationToMinutes('1,5', 'horas')).toEqual({ ok: true, minutes: 90 });
    expect(durationToMinutes('168', 'horas')).toEqual({ ok: true, minutes: 10080 });
  });

  it('rechaza lo que el servidor rechazaría: vacío, texto, menos de 1 minuto y más de 7 días', () => {
    expect(durationToMinutes('', 'minutos').ok).toBe(false);
    expect(durationToMinutes('abc', 'minutos').ok).toBe(false);
    expect(durationToMinutes('1e3', 'minutos').ok).toBe(false);
    expect(durationToMinutes('0', 'minutos').ok).toBe(false);
    expect(durationToMinutes('0.4', 'minutos').ok).toBe(false);
    expect(durationToMinutes('10081', 'minutos').ok).toBe(false);
    expect(durationToMinutes('169', 'horas').ok).toBe(false);
    expect(durationToMinutes('-5', 'minutos').ok).toBe(false);
  });

  it('formatea la duración en texto corto', () => {
    expect(formatDuration(1)).toBe('1 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(1440)).toBe('1 día');
    expect(formatDuration(1440 + 180)).toBe('1 día 3 h');
    expect(formatDuration(10080)).toBe('7 días');
  });
});

describe('formulario de token', () => {
  const ok = { label: ' Cierre  de Ana ', purposes: ['limpias', 'cierre_caja'] as const, durationText: '2', unit: 'horas' as const, branchId: null, maxUsesText: '', length: 8, forUserId: null };

  it('arma el cuerpo: nombre limpio, propósitos en orden fijo, minutos, sin límite de usos', () => {
    const r = buildTokenBody({ ...ok, purposes: [...ok.purposes] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toEqual({ label: 'Cierre de Ana', purposes: ['cierre_caja', 'limpias'], durationMinutes: 120, branchId: null, maxUses: null, length: 8, forUserId: null });
  });

  it('valida nombre, propósitos y usos máximos', () => {
    expect(buildTokenBody({ ...ok, purposes: ['limpias'], label: 'A' }).ok).toBe(false);
    expect(buildTokenBody({ ...ok, purposes: [] }).ok).toBe(false);
    expect(buildTokenBody({ ...ok, purposes: ['limpias'], maxUsesText: '0' }).ok).toBe(false);
    expect(buildTokenBody({ ...ok, purposes: ['limpias'], maxUsesText: '2.5' }).ok).toBe(false);
    const r = buildTokenBody({ ...ok, purposes: ['limpias'], maxUsesText: '3', branchId: 'b1', forUserId: 'u1' });
    expect(r.ok && r.body.maxUses).toBe(3);
    expect(r.ok && r.body.branchId).toBe('b1');
  });

  it('el largo del código nunca pasa de 10 ni baja de 6', () => {
    expect(clampLength(99)).toBe(10);
    expect(clampLength(2)).toBe(6);
    expect(clampLength(Number.NaN)).toBe(8);
    expect(clampLength(10)).toBe(10);
  });

  it('describe la autorización para tickets', () => {
    expect(describeAuthorization(null, null)).toBe('Sin registro');
    expect(describeAuthorization({ kind: 'admin_password', adminUserId: 'g' }, 'Rosa')).toBe('Contraseña de administrador (Rosa)');
    expect(describeAuthorization({ kind: 'token', tokenId: 't' }, null, null)).toBe('Token de seguridad');
  });
});
