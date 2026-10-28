import { describe, expect, it } from 'vitest';
import type { PdfDoc } from './labelPdf.ts';
import {
  LINE_HEIGHT_MM, PERMIT_COLOR, PERMIT_WIDTH_MM, buildPermitTicketModel, formatMx, renderPermitTicket, ticketHeightMm, wrapText,
  type PermitTicketData,
} from './permitTicket.ts';

const data = (over: Partial<PermitTicketData> = {}): PermitTicketData => ({
  code: 'K7M2QX9A', label: 'Cierre de caja de Ana', purposes: ['cierre_caja', 'devolucion'], issuedAtIso: '2026-10-22T15:00:00.000Z',
  expiresAtIso: '2026-10-22T16:30:00.000Z', branchName: 'Centro', forUserName: 'Ana', maxUses: 1, authorizedBy: 'Dueña Amara', ...over,
});

describe('modelo del ticket de permiso', () => {
  const lines = buildPermitTicketModel(data());
  const all = lines.map((l) => l.text).join('\n');
  it('incluye código, propósitos, vigencia, sucursal y quién autoriza', () => {
    expect(lines.find((l) => l.kind === 'code')?.text).toBe('K7M2QX9A');
    expect(all).toContain('Cierre de caja');
    expect(all).toContain('Devolución');
    expect(all).toContain('Vence: 22/10/2026 10:30');
    expect(all).toContain('Duración: 1 h 30 min');
    expect(all).toContain('Sucursal: Centro');
    expect(all).toContain('Para: Ana');
    expect(all).toContain('Usos: 1');
    expect(all).toContain('Dueña Amara');
    expect(lines[0]).toEqual({ kind: 'band', text: 'TICKET DE PERMISO' });
  });
  it('valores por omisión cuando no hay sucursal, usuario ni límite', () => {
    const t = buildPermitTicketModel(data({ branchName: null, forUserName: '', maxUses: null })).map((l) => l.text).join('\n');
    expect(t).toContain('Cualquier sucursal');
    expect(t).toContain('Cualquier usuario');
    expect(t).toContain('Sin límite');
  });
  it('envuelve textos largos sin cortar el contenido', () => {
    const long = buildPermitTicketModel(data({ label: 'Autorización especial para el cierre de caja del turno vespertino de fin de semana' }));
    expect(long.filter((l) => l.kind === 'bold' && l.text.length > 36)).toEqual([]);
    expect(wrapText('uno dos tres cuatro', 9)).toEqual(['uno dos', 'tres', 'cuatro']);
    expect(wrapText('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
    expect(wrapText('', 10)).toEqual([]);
  });
  it('el alto sale de la suma de renglones', () => {
    const sum = lines.reduce((a, l) => a + LINE_HEIGHT_MM[l.kind], 0);
    expect(ticketHeightMm(lines)).toBe(Math.ceil(5 + sum + 6));
  });
  it('fecha en hora de México', () => {
    expect(formatMx('2026-10-22T15:00:00.000Z')).toBe('22/10/2026 09:00');
    expect(formatMx('basura')).toBe('-');
  });
});

describe('color distinto al ticket normal', () => {
  it('es violeta, no el negro del ticket de venta', () => {
    expect(PERMIT_COLOR).not.toEqual([0, 0, 0]);
    expect(PERMIT_COLOR[2]).toBeGreaterThan(PERMIT_COLOR[1]);
    expect(PERMIT_WIDTH_MM).toBe(80);
  });
  it('el dibujo usa el violeta para la banda, el marco y el código', () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const rec = (fn: string) => (...args: unknown[]) => {
      calls.push({ fn, args });
      return undefined;
    };
    const doc: PdfDoc = {
      addPage: rec('addPage'), setFont: rec('setFont'), setFontSize: rec('setFontSize'), setTextColor: rec('setTextColor'),
      setFillColor: rec('setFillColor'), setDrawColor: rec('setDrawColor'), setLineWidth: rec('setLineWidth'), text: rec('text'),
      rect: rec('rect'), addImage: rec('addImage'), splitTextToSize: (t: string) => [t], output: () => new Blob(['x']),
    };
    const lines = buildPermitTicketModel(data());
    renderPermitTicket(doc, lines);
    const violet = PERMIT_COLOR.join();
    expect(calls.some((c) => c.fn === 'setFillColor' && (c.args as number[]).join() === violet)).toBe(true);
    expect(calls.some((c) => c.fn === 'setDrawColor' && (c.args as number[]).join() === violet)).toBe(true);
    const printed = calls.filter((c) => c.fn === 'text').map((c) => c.args[0]);
    expect(printed).toContain('TICKET DE PERMISO');
    expect(printed).toContain('K7M2QX9A');
    // Un renglón de texto por cada renglón visible del modelo.
    expect(printed).toHaveLength(lines.filter((l) => l.kind !== 'rule' && l.kind !== 'gap').length);
  });
});
