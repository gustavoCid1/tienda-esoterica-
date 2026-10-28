import { describe, expect, it } from 'vitest';
import type { TicketPayload } from '@amara/database';
import { buildTicketHtml, buildTicketPairHtml, ticketBodyHtml } from '../src/shared/ticket-format.ts';
import { buildLabelPreviewHtml, buildLabelSheetHtml, labelContentFlags, labelInnerHtml } from '../src/shared/label-html.ts';

const ticket: TicketPayload = {
  business: 'Esotérica Amara', branchName: 'Centro', folio: 'AMA-AP1-261022-0003', createdAt: '2026-10-22T19:45:10.000Z', userName: 'Caja Ana',
  items: [
    { name: 'Veladora', label: 'Blanca', qty: 2, unitPriceCents: 5000, netCents: 10000, kind: 'producto' },
    { name: 'Veladora', label: 'Blanca', qty: 1, unitPriceCents: 2500, netCents: 2500, kind: 'extra', extraNote: 'bordado <b>a mano</b>' },
  ],
  subtotalCents: 12500, discountCents: 0, totalCents: 12500,
  payments: [{ method: 'efectivo', amountCents: 12500, tenderedCents: 12500, changeCents: 0 }],
  status: 'completada',
};

describe('ticket con extras y limpias', () => {
  it('el extra se ve claramente como "Extra: nota", escapado, y el monto aparece una vez como cargo', () => {
    const html = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' });
    expect(html).toContain('Extra: bordado &lt;b&gt;a mano&lt;/b&gt;');
    expect(html).toContain('sobre Veladora - Blanca');
    expect(html).not.toContain('<b>a mano</b>');
    expect(html).toContain('2 x $50.00'); // el producto normal conserva su formato
    expect(html).toContain('$125.00'); // total
  });

  it('el vendedor (sellerName) jamás se imprime; "Atendió" es quien cobró', () => {
    const withSeller = { ...ticket, sellerName: 'Lupita Vendedora' } as unknown as TicketPayload;
    const html = buildTicketHtml(withSeller, { paperMm: 80, copy: 'tienda' });
    expect(html).not.toContain('Lupita');
    expect(html).toContain('Caja Ana');
  });

  it('una limpia se titula LIMPIA y una venta normal no', () => {
    expect(buildTicketHtml({ ...ticket, saleType: 'limpia' }, { paperMm: 58, copy: 'cliente' })).toContain('<div class="kind">LIMPIA</div>');
    expect(buildTicketHtml({ ...ticket, saleType: 'venta' }, { paperMm: 58, copy: 'cliente' })).not.toContain('<div class="kind">');
    expect(buildTicketHtml(ticket, { paperMm: 58, copy: 'cliente' })).not.toContain('<div class="kind">');
  });

  it('el PDF lleva las dos copias en un documento, una por página, con el mismo cuerpo que la impresión', () => {
    const pair = buildTicketPairHtml(ticket, { paperMm: 80 });
    expect(pair.match(/class="pg"/g)).toHaveLength(2);
    expect(pair).toContain('COPIA CLIENTE');
    expect(pair).toContain('COPIA TIENDA');
    expect(pair).toContain(ticketBodyHtml(ticket, { paperMm: 80, copy: 'cliente' }));
    expect(pair).toContain(ticketBodyHtml(ticket, { paperMm: 80, copy: 'tienda' }));
    // La vista previa y la impresión usan exactamente la misma función.
    expect(buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' })).toContain(ticketBodyHtml(ticket, { paperMm: 80, copy: 'cliente' }));
  });

  it('una reimpresión se marca igual en el ticket y no cambia importes', () => {
    const first = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente' });
    const again = buildTicketHtml(ticket, { paperMm: 80, copy: 'cliente', reprint: true });
    expect(first).not.toContain('REIMPRESIÓN');
    expect(again).toContain('REIMPRESIÓN');
    expect(again).toContain('$125.00');
  });
});

const l = { productName: 'Vela', variantLabel: 'Grande', priceCents: 15000, code: 'AMA00000002', barcodeSvg: '<svg id="b"/>', qrSvg: '<svg id="q"/>' };
const base = { widthMm: 50, heightMm: 30 };

describe('etiquetas con opciones de nombre, precio y QR', () => {
  it('por omisión (lotes de la v1) muestra nombre y QR', () => {
    expect(labelContentFlags({ showPrice: true })).toEqual({ name: true, price: true, qr: true });
    const html = labelInnerHtml(l, { ...base, showPrice: true });
    expect(html).toContain('Vela - Grande');
    expect(html).toContain('id="q"');
    expect(html).toContain('$150.00');
  });

  it('se puede quitar nombre, precio y QR por separado; el código de barras y su texto SIEMPRE quedan', () => {
    const noName = labelInnerHtml(l, { ...base, showPrice: true, showName: false, showQr: true });
    expect(noName).not.toContain('Vela - Grande');
    expect(noName).toContain('$150.00');
    const noPrice = labelInnerHtml(l, { ...base, showPrice: false });
    expect(noPrice).not.toContain('$150.00');
    const noQr = labelInnerHtml(l, { ...base, showPrice: true, showQr: false });
    expect(noQr).not.toContain('id="q"');
    expect(noQr).not.toContain('class="lq"');
    const bare = labelInnerHtml(l, { ...base, showPrice: false, showName: false, showQr: false });
    expect(bare).toContain('id="b"');
    expect(bare).toContain('AMA00000002');
    expect(bare).not.toContain('class="ln"');
  });

  it('la hoja de impresión sigue siendo una etiqueta por página y respeta las opciones', () => {
    const sheet = buildLabelSheetHtml([l, l, l], { ...base, showPrice: false, showQr: false });
    expect(sheet.match(/class="label"/g)).toHaveLength(3);
    expect(sheet).toContain('size: 50mm 30mm');
    expect(sheet).not.toContain('id="q"');
  });

  it('la vista previa usa las mismas etiquetas, separadas y numeradas', () => {
    const html = buildLabelPreviewHtml([l, l], { ...base, showPrice: true });
    expect(html.match(/class="label"/g)).toHaveLength(2);
    expect(html).toContain('Etiqueta 1 de 2');
    expect(html).toContain('Etiqueta 2 de 2');
    expect(html).toContain(labelInnerHtml(l, { ...base, showPrice: true }));
    expect(html).not.toContain('@page');
  });
});
