import { describe, expect, it } from 'vitest';
import type { TicketPayload } from '@amara/database';
import { COPY_LABEL, buildTestTicketHtml, buildTicketHtml, escapeHtml, printableWidthMm } from '../src/shared/ticket-format.ts';
import { buildLabelSheetHtml } from '../src/shared/label-html.ts';

const ticket: TicketPayload = {
  business: 'Esotérica Amara',
  branchName: 'Sucursal Centro',
  folio: 'AMA-AA-261022-0007',
  createdAt: '2026-10-22T19:45:10.000Z',
  userName: 'Vendedora',
  items: [
    { name: 'Vela ritual', label: 'Grande', qty: 2, unitPriceCents: 15000, netCents: 30000 },
    { name: 'Incienso <b>"Sándalo"</b>', label: 'Única', qty: 1, unitPriceCents: 4550, netCents: 4550 },
  ],
  subtotalCents: 34550,
  discountCents: 550,
  totalCents: 34000,
  payments: [
    { method: 'tarjeta', amountCents: 10000 },
    { method: 'efectivo', amountCents: 24000, tenderedCents: 30000, changeCents: 6000 },
  ],
  status: 'completada',
};

describe('ticket térmico', () => {
  it('cada copia lleva su rótulo y el MISMO folio e importes', () => {
    const c = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' });
    const t = buildTicketHtml(ticket, { paperMm: 80, copy: 'tienda' });
    expect(c).toContain(COPY_LABEL.cliente);
    expect(c).not.toContain(COPY_LABEL.tienda);
    expect(t).toContain(COPY_LABEL.tienda);
    for (const html of [c, t]) {
      expect(html).toContain('AMA-AA-261022-0007');
      expect(html).toContain('$340.00'); // total
      expect(html).toContain('$345.50'); // subtotal
      expect(html).toContain('-$5.50'); // descuento
      expect(html).toContain('22/10/2026 13:45'); // hora de México
      expect(html).toContain('Recibido');
      expect(html).toContain('$60.00'); // cambio
    }
  });

  it('escapa HTML de los nombres de producto', () => {
    const html = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' });
    expect(html).not.toContain('<b>"Sándalo"</b>');
    expect(html).toContain('Incienso &lt;b&gt;&quot;Sándalo&quot;&lt;/b&gt;');
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });

  it('58 y 80 mm usan anchos distintos', () => {
    const a = buildTicketHtml(ticket, { paperMm: 58, copy: 'cliente' });
    const b = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' });
    expect(a).toContain('size: 58mm auto');
    expect(b).toContain('size: 80mm auto');
    expect(a).toContain(`width: ${printableWidthMm(58)}mm`);
    expect(b).toContain(`width: ${printableWidthMm(80)}mm`);
    expect(printableWidthMm(58)).toBeLessThan(printableWidthMm(80));
  });

  it('el logo conserva proporción: solo ancho fijo, alto automático', () => {
    const html = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente', logoSrc: 'file:///C:/app/logo-ticket.png' });
    expect(html).toContain('<img class="logo" src="file:///C:/app/logo-ticket.png"');
    expect(html).toMatch(/\.logo \{[^}]*height: auto/);
    expect(html).toMatch(/\.logo \{[^}]*width: 40mm/);
    // sin logo no hay <img>
    expect(buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' })).not.toContain('<img');
  });

  it('marca REIMPRESIÓN y VENTA CANCELADA solo cuando corresponde', () => {
    expect(buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' })).not.toContain('REIMPRESIÓN');
    expect(buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente', reprint: true })).toContain('REIMPRESIÓN');
    expect(buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' })).not.toContain('VENTA CANCELADA');
    expect(buildTicketHtml({ ...ticket, status: 'cancelada' }, { paperMm: 80, copy: 'tienda' })).toContain('VENTA CANCELADA');
  });

  it('no muestra descuento ni recibido cuando no aplican', () => {
    const simple: TicketPayload = { ...ticket, discountCents: 0, subtotalCents: 34000, payments: [{ method: 'efectivo', amountCents: 34000, tenderedCents: 34000, changeCents: 0 }] };
    const html = buildTicketHtml(simple, { paperMm: 80, copy: 'cliente' });
    expect(html).not.toContain('Descuento');
    expect(html).not.toContain('Recibido');
  });

  it('el ticket de prueba no es una venta', () => {
    const html = buildTestTicketHtml({ paperMm: 58, printerName: 'POS-58', now: '2026-10-22T19:45:10.000Z' });
    expect(html).toContain('PRUEBA DE IMPRESION');
    expect(html).toContain('POS-58');
    expect(html).not.toContain('AMA-');
  });
});

describe('hoja de etiquetas', () => {
  it('una etiqueta por página con el tamaño del rollo y precio opcional', () => {
    const l = { productName: 'Vela', variantLabel: 'Grande', priceCents: 15000, code: 'AMA00000002', barcodeSvg: '<svg id="b"/>', qrSvg: '<svg id="q"/>' };
    const withPrice = buildLabelSheetHtml([l, l], { widthMm: 50, heightMm: 30, showPrice: true });
    expect(withPrice).toContain('size: 50mm 30mm');
    expect(withPrice.match(/class="label"/g)).toHaveLength(2);
    expect(withPrice).toContain('$150.00');
    expect(withPrice).toContain('AMA00000002');
    expect(buildLabelSheetHtml([l], { widthMm: 50, heightMm: 30, showPrice: false })).not.toContain('$150.00');
  });
});
