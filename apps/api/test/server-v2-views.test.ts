/** v2: terminales, auditoría y resumen de tickets de hoy (formas de respuesta). Sin base de datos. */
import { describe, expect, it } from 'vitest';
import { auditView, normalizeEntityFilter, scrubDetail, summarize } from '../src/audit-view.ts';
import { toTodaySaleSummary } from '../src/serialize.ts';
import { nextTerminalCode, terminalName, terminalPublic } from '../src/terminals.ts';

describe('terminales: código y nombre automáticos', () => {
  it('P para escritorio y M para móvil, el primero libre, sin repetir entre tipos', () => {
    expect(nextTerminalCode('escritorio', [])).toBe('P1');
    expect(nextTerminalCode('escritorio', ['P1', 'p2', 'M1'])).toBe('P3');
    expect(nextTerminalCode('movil', ['P1', 'M1'])).toBe('M2');
    expect(nextTerminalCode('escritorio', ['P1', 'P3'])).toBe('P2');
  });
  it('agotados los 99 números devuelve null (el gerente debe escribir uno)', () => {
    expect(nextTerminalCode('movil', Array.from({ length: 99 }, (_, i) => `M${i + 1}`))).toBeNull();
  });
  it('los códigos generados cumplen el formato del esquema (1 a 3 caracteres A-Z0-9)', () => {
    for (const c of [nextTerminalCode('escritorio', []), nextTerminalCode('movil', Array.from({ length: 98 }, (_, i) => `M${i + 1}`))]) expect(c).toMatch(/^[A-Z0-9]{1,3}$/);
  });
  it('nombre: "PC de Ana" / "Móvil de Ana"; sin persona usa el código; recorta a 60', () => {
    expect(terminalName('escritorio', ' Ana  María ', 'P1')).toBe('PC de Ana María');
    expect(terminalName('movil', 'Ana', 'M1')).toBe('Móvil de Ana');
    expect(terminalName('movil', undefined, 'M2')).toBe('Móvil M2');
    expect(terminalName('escritorio', 'x'.repeat(100), 'P1')).toHaveLength(60);
  });
  it('forma pública: id, assignedTo siempre presente y sin versión de token', () => {
    const v: any = terminalPublic({ _id: 't1', code: 'P1', name: 'PC de Ana', kind: 'escritorio', branchId: 'b', tokenVersion: 7, revoked: false });
    expect(v.id).toBe('t1');
    expect(v._id).toBeUndefined();
    expect(v.tokenVersion).toBeUndefined();
    expect(v.assignedTo).toBeNull();
    expect(terminalPublic({ _id: 't2', assignedTo: 'Ana' }).assignedTo).toBe('Ana');
  });
});

describe('GET /admin/audit: forma de respuesta', () => {
  const doc = { _id: 'a1', id: 'a1', at: '2026-10-22T18:00:00.000Z', userId: 'u1', action: 'usuario.crear', entity: 'user', entityId: 'u2', branchId: null, terminalId: null, detail: { username: 'ana', role: 'vendedor' } };
  it('conserva `at` y `detail` objeto, y agrega `createdAt`, `userName` y `summary` (lo que la web leía)', () => {
    const v = auditView(doc, new Map([['u1', 'Gerente']]));
    expect(v).toEqual({
      id: 'a1', at: doc.at, createdAt: doc.at, userId: 'u1', userName: 'Gerente', action: 'usuario.crear', entity: 'user', entityId: 'u2',
      branchId: null, terminalId: null, detail: { username: 'ana', role: 'vendedor' }, summary: 'username: ana · role: vendedor',
    });
  });
  it('filas incompletas no rompen: entity nulo → texto vacío, usuario desconocido → null, detail ausente → null', () => {
    const v = auditView({ _id: 'a2', at: '2026-10-22T18:00:00.000Z', action: 'sistema.arranque', entity: null, userId: null }, new Map());
    expect([v.entity, v.userName, v.detail, v.summary, v.entityId]).toEqual(['', null, null, '', null]);
    expect(auditView({ _id: 'a3', at: 'x', action: 'a', userId: 'zz', detail: 'texto' }, new Map()).userName).toBeNull();
  });
  it('nunca expone contraseñas, hashes ni sales, ni anidados', () => {
    const d: any = scrubDetail({ ok: 1, passwordHash: 'x', nested: { salt: 's', hash: 'h', label: 'bien', list: [{ password: 'p', n: 1 }] }, verifier: 'v' });
    expect(d).toEqual({ ok: 1, nested: { label: 'bien', list: [{ n: 1 }] } });
  });
  it('resumen corto con elipsis', () => {
    expect(summarize({ a: 'x'.repeat(300) }, 20)).toHaveLength(20);
    expect(summarize('hola')).toBe('hola');
    expect(summarize(null)).toBe('');
  });
  it('filtro de entidad acepta nombres en español y acentos', () => {
    expect(normalizeEntityFilter(undefined)).toBeUndefined();
    expect(normalizeEntityFilter('  ')).toBeUndefined();
    expect(normalizeEntityFilter('user')).toEqual(['user']);
    expect(normalizeEntityFilter('Usuario')).toEqual(['Usuario', 'usuario', 'user']);
    expect(normalizeEntityFilter('configuración')).toContain('setting');
    expect(normalizeEntityFilter('caja')).toContain('cash_session');
  });
});

describe('GET /sales/today-summary: solo lo vendido', () => {
  it('lista productos, cantidades y precios; sin costos, pagos ni ticket impreso', () => {
    const s = toTodaySaleSummary({
      _id: 's1', folio: 'AMA-1', createdAt: '2026-10-22T18:00:00.000Z', status: 'completada', type: 'limpia', userId: 'u1', userName: 'Ana', sellerId: 'u2', sellerName: 'Beto',
      totalCents: 11500, tenderedCents: 12000, payments: [{ method: 'efectivo', amountCents: 11500 }], printed: true, ticketText: 'secreto',
      items: [
        { productName: 'Vela', variantLabel: 'Chica', qty: 1, unitPriceCents: 9000, unitCostCents: 4000, netCents: 9000, sku: 'VEL' },
        { productName: 'Vela', variantLabel: 'Chica', qty: 1, unitPriceCents: 2500, unitCostCents: 0, netCents: 2500, kind: 'extra', extraNote: 'Aceite' },
      ],
    });
    expect(s).toEqual({
      saleId: 's1', folio: 'AMA-1', createdAt: '2026-10-22T18:00:00.000Z', status: 'completada', type: 'limpia', sellerId: 'u2', sellerName: 'Beto', totalCents: 11500,
      items: [
        { name: 'Vela', label: 'Chica', qty: 1, unitPriceCents: 9000, netCents: 9000, kind: 'producto', extraNote: null },
        { name: 'Vela', label: 'Chica', qty: 1, unitPriceCents: 2500, netCents: 2500, kind: 'extra', extraNote: 'Aceite' },
      ],
    });
    expect(JSON.stringify(s)).not.toContain('unitCost');
  });
  it('ventas V1 (sin vendedor ni tipo) usan el cajero y tipo "venta"', () => {
    const s = toTodaySaleSummary({ _id: 's2', folio: 'F', createdAt: 'x', status: 'cancelada', userId: 'u1', userName: 'Ana', totalCents: 1, items: [] });
    expect([s.type, s.sellerId, s.sellerName, s.status]).toEqual(['venta', 'u1', 'Ana', 'cancelada']);
  });
});
