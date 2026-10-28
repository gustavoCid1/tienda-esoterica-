import { describe, expect, it } from 'vitest';
import { ClosureTicketError, buildClosureTicketData, buildClosureTicketHtml, differenceText } from '../src/shared/closure-ticket.ts';
import type { ClosureRecordInput } from '../src/shared/closure-ticket.ts';
import { PERMIT_COLOR, buildPermitTicketHtml, groupCode, minutesBetween } from '../src/shared/permit-ticket.ts';
import type { PermitTicketData } from '../src/shared/permit-ticket.ts';
import { buildTicketHtml } from '../src/shared/ticket-format.ts';

const record: ClosureRecordInput = {
  id: 's1', status: 'cerrada', openedAt: '2026-10-22T15:00:00.000Z', openingCents: 100000, closedAt: '2026-10-23T01:30:00.000Z',
  countedCents: 215000, expectedCents: 220000, differenceCents: -5000, provisional: false,
  closeAuthorization: { kind: 'token', tokenId: 't1' }, authorizedByName: 'Gerente Rosa', openedByName: 'Gerente Rosa', closedByName: 'Vendedora Ana',
  closure: {
    breakdown: {
      openingCents: 100000, cashSalesCents: 150000, cashInCents: 20000, withdrawalsCents: 30000, expensesCents: 10000, cashRefundsCents: 10000, expectedCents: 220000,
      byMethod: { efectivo: 140000, tarjeta: 80000, transferencia: 12000, otro: 0 }, operations: 9,
    },
  },
  notes: 'Todo <bien>',
};

describe('ticket de cierre', () => {
  it('arma los datos con apertura, ventas por método, movimientos, esperado/contado/diferencia y responsables', () => {
    const d = buildClosureTicketData(record, { branchName: 'Centro', terminalCode: 'P1', tokenLabel: 'Cierre de Ana' });
    expect(d).toMatchObject({
      openingCents: 100000, expectedCents: 220000, countedCents: 215000, differenceCents: -5000, withdrawalsCents: 30000, expensesCents: 10000,
      cashInCents: 20000, openedByName: 'Gerente Rosa', closedByName: 'Vendedora Ana', branchName: 'Centro', terminalCode: 'P1',
    });
    expect(d.byMethod).toEqual({ efectivo: 140000, tarjeta: 80000, transferencia: 12000, otro: 0 });
    expect(d.authorizedBy).toBe('Token "Cierre de Ana" (emitido por Gerente Rosa)');
  });

  it('el HTML trae todo lo pedido y escapa las notas', () => {
    const html = buildClosureTicketHtml(buildClosureTicketData(record, { branchName: 'Centro', terminalCode: 'P1' }), { paperMm: 80 });
    for (const t of ['CIERRE DE CAJA', 'Apertura', '22/10/2026 09:00', 'Monto inicial', '$1,000.00', 'Ventas por método', 'Tarjeta', '$800.00', 'Entradas', 'Retiros', 'Gastos', 'Esperado en cajón', '$2,200.00', 'Contado', '$2,150.00', 'Faltante $50.00', 'Abrió', 'Cerró', 'Autorizó', 'Gerente Rosa', 'Vendedora Ana']) {
      expect(html).toContain(t);
    }
    expect(html).toContain('Todo &lt;bien&gt;');
    expect(html).not.toContain('Todo <bien>');
  });

  it('autorización por contraseña de administrador se describe con su nombre', () => {
    const d = buildClosureTicketData({ ...record, closeAuthorization: { kind: 'admin_password', adminUserId: 'g1' } }, { branchName: 'C', terminalCode: 'P1' });
    expect(d.authorizedBy).toBe('Contraseña de administrador (Gerente Rosa)');
  });

  it('una caja aún abierta no tiene ticket de cierre', () => {
    expect(() => buildClosureTicketData({ ...record, status: 'abierta', closedAt: null, countedCents: null, expectedCents: null }, { branchName: 'C', terminalCode: 'P1' })).toThrow(ClosureTicketError);
  });

  it('un corte con datos incompletos no truena: usa ceros y calcula la diferencia', () => {
    const d = buildClosureTicketData({ ...record, closure: null, differenceCents: null }, { branchName: 'C', terminalCode: 'P1' });
    expect(d.byMethod.efectivo).toBe(0);
    expect(d.differenceCents).toBe(-5000);
  });

  it('textos de diferencia', () => {
    expect(differenceText(0)).toBe('Sin diferencia');
    expect(differenceText(-2000)).toBe('Faltante $20.00');
    expect(differenceText(1500)).toBe('Sobrante $15.00');
  });
});

const permit: PermitTicketData = {
  business: 'Esotérica Amara', code: 'ABCD2345XY', label: 'Cierre de Ana <script>', purposes: ['cierre_caja', 'limpias'],
  createdAt: '2026-10-22T16:00:00.000Z', expiresAt: '2026-10-22T17:30:00.000Z', branchName: 'Centro', forUserName: null, maxUses: 1, authorizedBy: 'Rosa',
};

describe('ticket de permiso', () => {
  it('lleva el rótulo, el código agrupado, vigencia, propósitos y quién autoriza', () => {
    const html = buildPermitTicketHtml(permit, { paperMm: 80 });
    expect(html).toContain('TICKET DE PERMISO');
    expect(html).toContain('ABCD 2345 XY');
    expect(html).toContain('Cerrar caja, Limpias');
    expect(html).toContain('1 h 30 min');
    expect(html).toContain('Autorizó');
    expect(html).toContain('Rosa');
    expect(html).toContain('Cualquier usuario');
    expect(html).toContain('NO es un comprobante de compra');
    expect(html).toContain('Cierre de Ana &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('usa un color distinto al ticket de venta (violeta) y aun sin color tiene rótulo invertido y marco grueso', () => {
    const html = buildPermitTicketHtml(permit, { paperMm: 80 });
    expect(PERMIT_COLOR.toLowerCase()).toBe('#5b3a8c');
    expect(html.toLowerCase()).toContain('#5b3a8c');
    expect(html).toContain('border: 2.5px solid');
    const sale = buildTicketHtml(
      { business: 'X', branchName: 'Y', folio: 'F', createdAt: permit.createdAt, userName: 'U', items: [], subtotalCents: 0, discountCents: 0, totalCents: 0, payments: [], status: 'completada' },
      { paperMm: 80, copy: 'cliente' },
    );
    expect(sale.toLowerCase()).not.toContain('#5b3a8c');
  });

  it('utilidades', () => {
    expect(groupCode('ABCD2345')).toBe('ABCD 2345');
    expect(groupCode('ABCDEF')).toBe('ABCD EF');
    expect(minutesBetween('2026-10-22T16:00:00.000Z', '2026-10-22T16:45:00.000Z')).toBe(45);
    expect(minutesBetween('2026-10-22T16:00:00.000Z', 'basura')).toBe(0);
  });
});
