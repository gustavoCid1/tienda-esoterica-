/**
 * Hoja de etiquetas (v2): HTML para la vista previa, la impresión (expo-print) y el PDF (compartir/guardar).
 * Lógica PURA: el generador de la matriz del QR se inyecta (src/services/qr.ts) para poder probar sin librerías.
 *
 * Opciones: mostrar/ocultar nombre, precio y QR (y el código de barras). Con QR en etiquetas chicas el módulo
 * es muy fino: en impresoras de 203 dpi conviene 60x40 o 70x40 mm, o quitar el QR. NO se ha leído con lector físico.
 */
import { formatMXN } from '@amara/shared';
import { code128Layout } from './code128.ts';
import { escapeHtml } from './ticket-render.ts';

export type LabelSizeId = 'r50x30' | 'r60x40' | 'r70x40' | 'hoja';

export interface LabelSize {
  id: LabelSizeId;
  name: string;
  /** Tamaño de CADA etiqueta en mm. */
  widthMm: number;
  heightMm: number;
  /** 'rollo' = una etiqueta por página; 'hoja' = rejilla en hoja Carta. */
  layout: 'rollo' | 'hoja';
  columns: number;
}

export const LABEL_SIZES: readonly LabelSize[] = [
  { id: 'r50x30', name: 'Rollo 50 x 30 mm', widthMm: 50, heightMm: 30, layout: 'rollo', columns: 1 },
  { id: 'r60x40', name: 'Rollo 60 x 40 mm', widthMm: 60, heightMm: 40, layout: 'rollo', columns: 1 },
  { id: 'r70x40', name: 'Rollo 70 x 40 mm', widthMm: 70, heightMm: 40, layout: 'rollo', columns: 1 },
  { id: 'hoja', name: 'Hoja Carta (3 columnas)', widthMm: 64, heightMm: 32, layout: 'hoja', columns: 3 },
];

export function labelSize(id: LabelSizeId): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES[1]!;
}

export interface LabelOptions {
  showName: boolean;
  showPrice: boolean;
  showQr: boolean;
  showBarcode: boolean;
  size: LabelSizeId;
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = { showName: true, showPrice: true, showQr: true, showBarcode: true, size: 'r60x40' };

export interface LabelItem {
  name: string;
  variantLabel: string;
  priceCents: number;
  /** Código de barras del producto o, si no tiene, el interno. */
  code: string;
  qrValue: string;
  copies: number;
}

export type QrMatrix = (text: string) => boolean[][];

export const MAX_COPIES_PER_ITEM = 99;
export const MAX_LABELS = 400;

/** Etiquetas a imprimir, ya repetidas por copias (acotadas para no generar documentos enormes). */
export function expandLabels(items: LabelItem[]): LabelItem[] {
  const out: LabelItem[] = [];
  for (const it of items) {
    const n = Math.min(MAX_COPIES_PER_ITEM, Math.max(0, Math.floor(it.copies)));
    for (let i = 0; i < n && out.length < MAX_LABELS; i++) out.push(it);
  }
  return out;
}

export const mmToPoints = (mm: number): number => Math.round((mm * 72) / 25.4);

const f = (n: number) => Number(n.toFixed(3));

/** SVG del código de barras (una sola ruta, sin atributos de texto). Vacío si el texto no se puede codificar. */
export function barcodeSvg(code: string): string {
  let layout;
  try {
    layout = code128Layout(code, 0);
  } catch {
    return '';
  }
  const rects = layout.bars.map((b) => `M${b.x} 0h${b.width}v10h-${b.width}z`).join('');
  return `<svg class="bc" viewBox="0 0 ${layout.totalModules} 10" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="${rects}" fill="#000"/></svg>`;
}

/** SVG del QR a partir de su matriz (con la zona blanca la pone el contenedor). */
export function qrSvg(matrix: boolean[][]): string {
  const n = matrix.length;
  if (n === 0) return '';
  let d = '';
  for (let y = 0; y < n; y++) {
    const row = matrix[y]!;
    for (let x = 0; x < n; x++) if (row[x]) d += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
}

function oneLabel(it: LabelItem, o: LabelOptions, qr: QrMatrix): string {
  const name = o.showName ? `<div class="nm">${escapeHtml(it.name)}${it.variantLabel ? ` <span class="vl">${escapeHtml(it.variantLabel)}</span>` : ''}</div>` : '';
  const price = o.showPrice ? `<div class="pr">${escapeHtml(formatMXN(it.priceCents))}</div>` : '';
  const bars = o.showBarcode ? `<div class="bcw">${barcodeSvg(it.code)}<div class="cd">${escapeHtml(it.code)}</div></div>` : '';
  let qrHtml = '';
  if (o.showQr) {
    try {
      qrHtml = `<div class="qrw">${qrSvg(qr(it.qrValue))}</div>`;
    } catch {
      qrHtml = '';
    }
  }
  return `<div class="lb"><div class="tx">${name}${price}${bars}</div>${qrHtml}</div>`;
}

export interface LabelDocument {
  html: string;
  /** Tamaño de página para expo-print (puntos). */
  pageWidthPt: number;
  pageHeightPt: number;
  count: number;
}

export function labelsDocument(items: LabelItem[], opts: LabelOptions, qr: QrMatrix): LabelDocument {
  const size = labelSize(opts.size);
  const labels = expandLabels(items);
  const w = size.widthMm;
  const h = size.heightMm;
  const hoja = size.layout === 'hoja';
  const pageW = hoja ? 215.9 : w;
  const pageH = hoja ? 279.4 : h;
  const body = labels.map((l) => oneLabel(l, opts, qr)).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Etiquetas</title>
<style>
@page { size: ${f(pageW)}mm ${f(pageH)}mm; margin: ${hoja ? '10mm 10mm' : '0'}; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.sheet { ${hoja ? `display: grid; grid-template-columns: repeat(${size.columns}, ${w}mm); grid-auto-rows: ${h}mm;` : ''} }
.lb { width: ${w}mm; height: ${h}mm; padding: 1.5mm; display: flex; align-items: stretch; gap: 1.5mm; overflow: hidden; ${hoja ? 'border: 0.2mm dashed #bbb;' : 'page-break-after: always;'} }
.tx { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
.nm { font-size: ${h <= 30 ? '8' : '10'}pt; font-weight: bold; line-height: 1.1; max-height: 2.4em; overflow: hidden; }
.vl { font-weight: normal; }
.pr { font-size: ${h <= 30 ? '11' : '14'}pt; font-weight: bold; }
.bcw { width: 100%; }
.bc { width: 100%; height: ${h <= 30 ? '7' : '10'}mm; display: block; }
.cd { font-size: 6pt; text-align: center; letter-spacing: 0.5px; }
.qrw { flex: 0 0 auto; width: ${Math.min(h - 3, w * 0.4).toFixed(1)}mm; align-self: center; }
.qr { width: 100%; height: auto; display: block; }
@media screen { body { background: #ddd; padding: 8px; } .lb { background: #fff; border: 1px solid #999; margin: 0 0 8px; page-break-after: auto; } .sheet { gap: 0; } }
</style></head><body><div class="sheet">${body}</div></body></html>`;
  return { html, pageWidthPt: mmToPoints(pageW), pageHeightPt: mmToPoints(pageH), count: labels.length };
}
