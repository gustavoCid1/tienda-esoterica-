import { describe, expect, it } from 'vitest';
import { auditDate, filterAuditRows, normalizeAuditRows, summarizeDetail } from './audit.ts';

// Fila tal como la guarda y devuelve apps/api (audit.ts): `at`, `detail` objeto, sin nombre de usuario.
const serverRow = {
  id: 'a1', at: '2026-10-22T15:30:00.000Z', userId: '11111111-2222-3333-4444-555555555555', action: 'usuario.crear',
  entity: 'user', entityId: 'u1', branchId: null, terminalId: null, detail: { username: 'ana', role: 'vendedor' },
};

describe('causa del fallo de Auditoría: forma real del servidor', () => {
  it('el detalle objeto se convierte en texto (React no puede pintar objetos)', () => {
    const [r] = normalizeAuditRows({ total: 1, items: [serverRow] });
    expect(typeof r!.summary).toBe('string');
    expect(r!.summary).toBe('username: ana · role: vendedor');
    expect(r!.at).toBe('2026-10-22T15:30:00.000Z');
    expect(r!.hasDiff).toBe(true);
  });
  it('acepta arreglo, { items } o basura sin lanzar', () => {
    expect(normalizeAuditRows([serverRow])).toHaveLength(1);
    expect(normalizeAuditRows({ items: [serverRow] })).toHaveLength(1);
    expect(normalizeAuditRows(null)).toEqual([]);
    expect(normalizeAuditRows('x')).toEqual([]);
    expect(normalizeAuditRows({ items: [null, 5, 'a'] })).toEqual([]);
  });
  it('fecha: usa at o createdAt y descarta valores inválidos', () => {
    expect(auditDate({ createdAt: '2026-01-01T00:00:00.000Z' })).toBe('2026-01-01T00:00:00.000Z');
    expect(auditDate({ at: 'no es fecha' })).toBe('');
    expect(auditDate({})).toBe('');
  });
  it('entidad nula y usuario desconocido tienen etiqueta legible', () => {
    const [a] = normalizeAuditRows([{ id: 'x', at: serverRow.at, action: 'sync.ok', entity: null, userId: null, terminalId: null, detail: null }]);
    expect(a!.entity).toBe('-');
    expect(a!.userLabel).toBe('Sistema');
    expect(a!.summary).toBe('');
    expect(a!.hasDiff).toBe(false);
    const [b] = normalizeAuditRows([{ id: 'y', action: 'x', terminalId: 'abcdef123456' }]);
    expect(b!.userLabel).toBe('Terminal abcdef');
  });
  it('resuelve el nombre del usuario con el mapa de usuarios', () => {
    const [r] = normalizeAuditRows([serverRow], { [serverRow.userId]: 'Ana Gerente' });
    expect(r!.userLabel).toBe('Ana Gerente');
    const [s] = normalizeAuditRows([serverRow]);
    expect(s!.userLabel).toBe('11111111');
  });
  it('antes/después: del detalle, de changes o de campos propios', () => {
    const [c] = normalizeAuditRows([{ ...serverRow, detail: { changes: { name: 'Nuevo' } } }]);
    expect(c!.after).toEqual({ name: 'Nuevo' });
    expect(c!.before).toBeNull();
    const [d] = normalizeAuditRows([{ ...serverRow, detail: { before: { p: 1 }, after: { p: 2 } } }]);
    expect(d!.before).toEqual({ p: 1 });
    expect(d!.after).toEqual({ p: 2 });
    const [e] = normalizeAuditRows([{ id: 'z', action: 'a', entity: 'e', before: 1, after: 2, createdAt: serverRow.at }]);
    expect([e!.before, e!.after]).toEqual([1, 2]);
  });
});

describe('resumen y filtro', () => {
  it('recorta textos largos y tolera cualquier tipo', () => {
    expect(summarizeDetail('x'.repeat(300), 20).length).toBe(20);
    expect(summarizeDetail(5)).toBe('5');
    expect(summarizeDetail(undefined)).toBe('');
    expect(summarizeDetail({ a: { b: 1 }, c: null })).toBe('a: {"b":1} · c: -');
  });
  it('filtra por texto libre sin distinguir mayúsculas', () => {
    const rows = normalizeAuditRows([serverRow, { ...serverRow, id: 'a2', action: 'venta.cancelar', entity: 'sale', detail: { motivo: 'error' } }]);
    expect(filterAuditRows(rows, 'CANCELAR')).toHaveLength(1);
    expect(filterAuditRows(rows, 'vendedor')).toHaveLength(1);
    expect(filterAuditRows(rows, '  ')).toHaveLength(2);
  });
});
