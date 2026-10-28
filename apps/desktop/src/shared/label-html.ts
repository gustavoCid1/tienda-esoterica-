/**
 * Hoja de etiquetas (Code128 + QR) como HTML para impresión. Lógica PURA: los SVG del
 * código de barras y del QR los genera el renderer (jsbarcode / qrcode) y aquí solo se
 * componen. Una etiqueta por página, del tamaño exacto del rollo (p. ej. 50 x 30 mm).
 */
import { formatMXN } from '@amara/shared';
import { escapeHtml } from './ticket-format.ts';

export interface LabelRender {
  productName: string;
  variantLabel: string;
  priceCents: number | null;
  /** Texto legible bajo el código de barras (código interno). */
  code: string;
  barcodeSvg: string;
  qrSvg: string;
}

export interface LabelSheetOptions {
  widthMm: number;
  heightMm: number;
  showPrice: boolean;
}

/** Contenido de una etiqueta (sin la página). Se usa también en la vista previa en pantalla. */
export function labelInnerHtml(l: LabelRender, o: LabelSheetOptions): string {
  const name = l.variantLabel && l.variantLabel !== 'Única' ? `${l.productName} - ${l.variantLabel}` : l.productName;
  const price = o.showPrice && l.priceCents !== null ? `<div class="lp">${formatMXN(l.priceCents)}</div>` : '';
  return `<div class="lq">${l.qrSvg}</div><div class="lt"><div class="ln">${escapeHtml(name)}</div>${price}<div class="lb">${l.barcodeSvg}</div><div class="lc">${escapeHtml(l.code)}</div></div>`;
}

/** Reglas de la etiqueta. `scope` (p. ej. ".label-preview") las limita para usarlas en la vista previa de pantalla. */
export function labelRules(o: LabelSheetOptions, scope = ''): string {
  const p = scope ? `${scope} ` : '';
  return `
${p}.label { width: ${o.widthMm}mm; height: ${o.heightMm}mm; padding: 1.5mm; display: flex; gap: 1.5mm; overflow: hidden; page-break-after: always; break-after: page; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
${p}.label:last-child { page-break-after: auto; break-after: auto; }
${p}.lq { flex: 0 0 ${Math.max(10, Math.min(o.heightMm - 3, o.widthMm * 0.38))}mm; }
${p}.lq svg { width: 100%; height: auto; display: block; }
${p}.lt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
${p}.ln { font-size: 7pt; font-weight: bold; line-height: 1.1; max-height: 2.4em; overflow: hidden; }
${p}.lp { font-size: 9pt; font-weight: bold; }
${p}.lb svg { width: 100%; height: ${Math.max(6, o.heightMm * 0.3)}mm; display: block; }
${p}.lc { font-size: 6pt; text-align: center; letter-spacing: 0.5px; }
`;
}

/** Hoja de impresión: una etiqueta por página, tamaño exacto del rollo. */
export const LABEL_CSS = (o: LabelSheetOptions) => `
@page { size: ${o.widthMm}mm ${o.heightMm}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
${labelRules(o)}`;

export function buildLabelSheetHtml(labels: LabelRender[], o: LabelSheetOptions): string {
  const body = labels.map((l) => `<div class="label">${labelInnerHtml(l, o)}</div>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas</title><style>${LABEL_CSS(o)}</style></head><body>${body}</body></html>`;
}
