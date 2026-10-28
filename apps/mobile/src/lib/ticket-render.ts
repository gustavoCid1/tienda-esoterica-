/**
 * Presentación del ticket: texto plano (pantalla) y HTML (impresión del sistema / PDF).
 * El ticket se guarda como TicketPayload en SQLite al vender; aquí solo se DIBUJA, de modo que la
 * reimpresión es idéntica al original (mismo folio, importes y fecha).
 */
import { formatMXN, formatMxDateTime } from '@amara/shared';
import type { TicketPayload } from '@amara/database';

const METHOD: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' };
export const methodName = (m: string) => METHOD[m] ?? m;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Líneas de texto para mostrar el ticket en pantalla. */
export function ticketLines(t: TicketPayload): { text: string; strong?: boolean }[] {
  const out: { text: string; strong?: boolean }[] = [
    { text: t.business, strong: true },
    { text: t.branchName },
    { text: `Folio: ${t.folio}`, strong: true },
    { text: `Fecha: ${formatMxDateTime(t.createdAt)}` },
    { text: `Atendió: ${t.userName}` },
  ];
  if (t.saleType === 'limpia') out.push({ text: 'LIMPIA', strong: true });
  if (t.status === 'cancelada') out.push({ text: 'VENTA CANCELADA', strong: true });
  out.push({ text: '--------------------------------' });
  for (const it of t.items) {
    if (it.kind === 'extra') {
      out.push({ text: `Extra: ${it.name}${it.label ? ` (${it.label})` : ''}` });
      if (it.extraNote) out.push({ text: `  ${it.extraNote}` });
      out.push({ text: `     ${formatMXN(it.netCents)}` });
      continue;
    }
    out.push({ text: `${it.qty} x ${it.name}${it.label ? ` (${it.label})` : ''}` });
    out.push({ text: `     ${formatMXN(it.unitPriceCents)} c/u   ${formatMXN(it.netCents)}` });
  }
  out.push({ text: '--------------------------------' });
  out.push({ text: `Subtotal: ${formatMXN(t.subtotalCents)}` });
  if (t.discountCents > 0) out.push({ text: `Descuento: -${formatMXN(t.discountCents)}` });
  out.push({ text: `TOTAL: ${formatMXN(t.totalCents)}`, strong: true });
  for (const p of t.payments) {
    out.push({ text: `${methodName(p.method)}: ${formatMXN(p.amountCents)}` });
    if (p.method === 'efectivo' && p.tenderedCents !== undefined) {
      out.push({ text: `  Recibido: ${formatMXN(p.tenderedCents)}   Cambio: ${formatMXN(p.changeCents ?? 0)}` });
    }
  }
  out.push({ text: 'Gracias por su compra' });
  return out;
}

function ticketBodyHtml(t: TicketPayload, copy: string): string {
  const rows = t.items
    .map((it) => {
      if (it.kind === 'extra') {
        const note = it.extraNote ? `<br><span class="s">${escapeHtml(it.extraNote)}</span>` : '';
        return `<tr><td>Extra: ${escapeHtml(it.name)}${it.label ? ` (${escapeHtml(it.label)})` : ''}${note}</td><td class="r">${escapeHtml(formatMXN(it.netCents))}</td></tr>`;
      }
      return `<tr><td>${it.qty} x ${escapeHtml(it.name)}${it.label ? ` (${escapeHtml(it.label)})` : ''}</td><td class="r">${escapeHtml(formatMXN(it.netCents))}</td></tr>`;
    })
    .join('');
  const pays = t.payments
    .map((p) => {
      const extra = p.method === 'efectivo' && p.tenderedCents !== undefined ? `<tr><td class="s">Recibido ${escapeHtml(formatMXN(p.tenderedCents))} / Cambio ${escapeHtml(formatMXN(p.changeCents ?? 0))}</td><td></td></tr>` : '';
      return `<tr><td>${escapeHtml(methodName(p.method))}</td><td class="r">${escapeHtml(formatMXN(p.amountCents))}</td></tr>${extra}`;
    })
    .join('');
  return `<section>
<h1>${escapeHtml(t.business)}</h1>
<p class="c">${escapeHtml(t.branchName)}</p>
<p class="c"><b>${escapeHtml(copy)}</b></p>
<p>Folio: <b>${escapeHtml(t.folio)}</b><br>Fecha: ${escapeHtml(formatMxDateTime(t.createdAt))}<br>Atendió: ${escapeHtml(t.userName)}</p>
${t.saleType === 'limpia' ? '<p class="c"><b>LIMPIA</b></p>' : ''}
${t.status === 'cancelada' ? '<p class="c"><b>VENTA CANCELADA</b></p>' : ''}
<table>${rows}</table>
<hr>
<table>
<tr><td>Subtotal</td><td class="r">${escapeHtml(formatMXN(t.subtotalCents))}</td></tr>
${t.discountCents > 0 ? `<tr><td>Descuento</td><td class="r">-${escapeHtml(formatMXN(t.discountCents))}</td></tr>` : ''}
<tr><td><b>TOTAL</b></td><td class="r"><b>${escapeHtml(formatMXN(t.totalCents))}</b></td></tr>
${pays}
</table>
<p class="c">Gracias por su compra</p>
</section>`;
}

/**
 * Documento HTML con las DOS copias (cliente y tienda), cada una en su propia hoja. El MISMO documento sirve para la
 * vista previa en pantalla, para Imprimir (las 2 copias seguidas en un solo trabajo) y para el PDF. El vendedor
 * (sellerName) nunca forma parte de TicketPayload, así que no se imprime.
 */
export function ticketCopiesHtml(t: TicketPayload, opts: { reprint?: boolean } = {}): string {
  const mark = opts.reprint ? ' - REIMPRESION' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { size: 80mm auto; margin: 4mm; }
body { font-family: monospace; font-size: 12px; color: #000; margin: 0; }
section { page-break-after: always; padding: 4px; }
section:last-child { page-break-after: auto; }
h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
.c { text-align: center; margin: 2px 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 1px 0; vertical-align: top; }
.r { text-align: right; white-space: nowrap; padding-left: 8px; }
.s { font-size: 11px; }
hr { border: 0; border-top: 1px dashed #000; }
@media screen { body { padding: 8px; } section { border-bottom: 2px dashed #888; margin-bottom: 14px; padding-bottom: 14px; } section:last-child { border-bottom: 0; } }
</style></head><body>${ticketBodyHtml(t, `COPIA CLIENTE${mark}`)}${ticketBodyHtml(t, `COPIA TIENDA${mark}`)}</body></html>`;
}
