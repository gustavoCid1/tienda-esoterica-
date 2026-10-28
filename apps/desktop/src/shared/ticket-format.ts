/**
 * Formato del ticket térmico (58 u 80 mm) como HTML autocontenido. Lógica PURA y probada:
 * recibe el ticket TAL COMO SE EMITIÓ (tabla `tickets.payload_json`), así que una
 * reimpresión sale idéntica aunque después cambie el catálogo o el precio.
 *
 * Se imprimen DOS copias consecutivas del MISMO folio: "COPIA CLIENTE" y "COPIA TIENDA".
 * El logo conserva su proporción: solo se fija el ANCHO y el alto es `auto` (nunca se deforma).
 */
import { formatMXN, formatMxDateTime } from '@amara/shared';
import type { TicketPayload } from '@amara/database';

export type TicketCopy = 'cliente' | 'tienda';

export const COPY_LABEL: Record<TicketCopy, string> = {
  cliente: 'COPIA CLIENTE',
  tienda: 'COPIA TIENDA',
};

export const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

export interface TicketRenderOptions {
  paperMm: 58 | 80;
  copy: TicketCopy;
  /** URL del logo (file:// o data:). Si falta, se imprime solo el nombre del negocio. */
  logoSrc?: string;
  /** Marca "REIMPRESIÓN" (el folio y los importes no cambian). */
  reprint?: boolean;
  footer?: string;
}

/** Ancho útil aproximado de impresión en milímetros (los rollos no imprimen de borde a borde). */
export function printableWidthMm(paperMm: 58 | 80): number {
  return paperMm === 58 ? 48 : 72;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const BASE_CSS = (paperMm: 58 | 80) => {
  const w = printableWidthMm(paperMm);
  const fs = paperMm === 58 ? 10.5 : 12;
  const logoMm = paperMm === 58 ? 30 : 40;
  return `
@page { size: ${paperMm}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; font-size: ${fs}px; color: #000; -webkit-print-color-adjust: exact; }
.t { width: ${w}mm; margin: 0 auto; padding: 2mm 0 6mm; }
.c { text-align: center; }
.logo { display: block; margin: 0 auto 2mm; width: ${logoMm}mm; height: auto; }
.biz { font-size: ${fs + 3}px; font-weight: bold; text-align: center; }
.copy { margin: 2mm 0; padding: 1mm 0; border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: center; font-weight: bold; letter-spacing: 1px; }
.reprint { text-align: center; font-weight: bold; margin-bottom: 1mm; }
.cancel { text-align: center; font-weight: bold; font-size: ${fs + 2}px; border: 2px solid #000; padding: 1mm; margin: 1mm 0 2mm; }
.meta div { display: flex; justify-content: space-between; gap: 2mm; }
.sep { border-top: 1px dashed #000; margin: 2mm 0; }
.item .n { font-weight: bold; word-break: break-word; }
.item .r, .row { display: flex; justify-content: space-between; gap: 2mm; }
.item { margin-bottom: 1.5mm; }
.total { font-size: ${fs + 4}px; font-weight: bold; }
.foot { text-align: center; margin-top: 3mm; }
.kind { text-align: center; font-weight: bold; letter-spacing: 2px; font-size: ${fs + 2}px; margin: 1mm 0; }
.extra .n { font-style: italic; }
.extra .sub { font-size: ${fs - 1.5}px; }
.pg { break-after: page; page-break-after: always; }
.pg:last-child { break-after: auto; page-break-after: auto; }
`;
};

export function page(title: string, paperMm: 58 | 80, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BASE_CSS(paperMm)}</style></head><body><div class="t">${body}</div></body></html>`;
}

export function header(t: { business: string }, o: Pick<TicketRenderOptions, 'logoSrc'>): string {
  const logo = o.logoSrc ? `<img class="logo" src="${escapeHtml(o.logoSrc)}" alt="${escapeHtml(t.business)}">` : '';
  return `${logo}<div class="biz">${escapeHtml(t.business)}</div>`;
}

/** Renglón de una partida. Un "extra" se ve claramente como "Extra: nota" y no cuenta como pieza. */
function itemHtml(i: TicketPayload['items'][number]): string {
  if (i.kind === 'extra') {
    const note = (i.extraNote ?? '').trim() || 'cargo adicional';
    const parent = i.label && i.label !== 'Única' ? `${i.name} - ${i.label}` : i.name;
    return `<div class="item extra"><div class="n">Extra: ${escapeHtml(note)}</div><div class="r sub"><span>sobre ${escapeHtml(parent)}</span><span>${formatMXN(i.netCents)}</span></div></div>`;
  }
  const name = i.label && i.label !== 'Única' ? `${i.name} - ${i.label}` : i.name;
  return `<div class="item"><div class="n">${escapeHtml(name)}</div><div class="r"><span>${i.qty} x ${formatMXN(i.unitPriceCents)}</span><span>${formatMXN(i.netCents)}</span></div></div>`;
}

/**
 * Cuerpo del ticket (sin <html>). OJO: el vendedor (sellerName) es un dato interno y NO se imprime nunca:
 * "Atendió" es quien cobró (usuario con sesión), no quien vendió.
 */
export function ticketBodyHtml(t: TicketPayload, o: TicketRenderOptions): string {
  const items = t.items.map(itemHtml).join('');

  const pays = t.payments
    .map((p) => {
      const lines = [`<div class="row"><span>${escapeHtml(METHOD_LABEL[p.method] ?? p.method)}</span><span>${formatMXN(p.amountCents)}</span></div>`];
      if (p.method === 'efectivo' && p.tenderedCents !== undefined && p.tenderedCents !== p.amountCents) {
        lines.push(`<div class="row"><span>Recibido</span><span>${formatMXN(p.tenderedCents)}</span></div>`);
        lines.push(`<div class="row"><span>Cambio</span><span>${formatMXN(p.changeCents ?? p.tenderedCents - p.amountCents)}</span></div>`);
      }
      return lines.join('');
    })
    .join('');

  return [
    header(t, o),
    `<div class="c">${escapeHtml(t.branchName)}</div>`,
    t.saleType === 'limpia' ? '<div class="kind">LIMPIA</div>' : '',
    `<div class="copy">${COPY_LABEL[o.copy]}</div>`,
    o.reprint ? '<div class="reprint">REIMPRESIÓN</div>' : '',
    t.status === 'cancelada' ? '<div class="cancel">VENTA CANCELADA</div>' : '',
    `<div class="meta"><div><span>Folio</span><b>${escapeHtml(t.folio)}</b></div><div><span>Fecha</span><span>${escapeHtml(formatMxDateTime(t.createdAt))}</span></div><div><span>Atendió</span><span>${escapeHtml(t.userName)}</span></div></div>`,
    '<div class="sep"></div>',
    items,
    '<div class="sep"></div>',
    `<div class="row"><span>Subtotal</span><span>${formatMXN(t.subtotalCents)}</span></div>`,
    t.discountCents > 0 ? `<div class="row"><span>Descuento</span><span>-${formatMXN(t.discountCents)}</span></div>` : '',
    `<div class="row total"><span>TOTAL</span><span>${formatMXN(t.totalCents)}</span></div>`,
    '<div class="sep"></div>',
    pays,
    `<div class="foot">${escapeHtml(o.footer ?? 'Gracias por su compra')}</div>`,
    `<div class="foot">${COPY_LABEL[o.copy]} - ${escapeHtml(t.folio)}</div>`,
  ].join('');
}

export function buildTicketHtml(t: TicketPayload, o: TicketRenderOptions): string {
  return page(`Ticket ${t.folio} - ${COPY_LABEL[o.copy]}`, o.paperMm, ticketBodyHtml(t, o));
}

/**
 * Las dos copias (cliente y tienda) en UN solo documento, una por página: es lo que se guarda como PDF.
 * (Para imprimir se mandan dos trabajos seguidos con buildTicketHtml; el contenido de cada copia es idéntico.)
 */
export function buildTicketPairHtml(t: TicketPayload, o: Omit<TicketRenderOptions, 'copy'>): string {
  const body = (['cliente', 'tienda'] as const)
    .map((copy) => `<div class="pg"><div class="t">${ticketBodyHtml(t, { ...o, copy })}</div></div>`)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(`Ticket ${t.folio}`)}</title><style>${BASE_CSS(o.paperMm)}</style></head><body>${body}</body></html>`;
}

/** Ticket de prueba de impresión (no es una venta ni consume folio). */
export function buildTestTicketHtml(o: { paperMm: 58 | 80; printerName: string; logoSrc?: string; now: string }): string {
  const body = [
    header({ business: 'Esotérica Amara' }, o),
    '<div class="copy">PRUEBA DE IMPRESION</div>',
    `<div class="c">Papel: ${o.paperMm} mm</div>`,
    `<div class="c">Impresora: ${escapeHtml(o.printerName || '(predeterminada)')}</div>`,
    `<div class="c">${escapeHtml(formatMxDateTime(o.now))}</div>`,
    '<div class="sep"></div>',
    '<div class="row"><span>Texto a la izquierda</span><span>Derecha</span></div>',
    '<div class="row total"><span>TOTAL</span><span>$1,234.50</span></div>',
    '<div class="sep"></div>',
    '<div class="foot">Si lees esto completo, la impresora esta lista.</div>',
  ].join('');
  return page('Prueba de impresion', o.paperMm, body);
}
