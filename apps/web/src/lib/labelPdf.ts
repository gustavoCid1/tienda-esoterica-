/**
 * Hoja de etiquetas en PDF. Todo el armado (paginación, medidas, texto, barras) es lógica pura que
 * dibuja sobre una interfaz mínima `PdfDoc`; el PDF real lo crea jsPDF en lib/pdf.ts y los
 * codificadores de Code 128 (jsbarcode) y QR (qrcode) se inyectan. Así se prueba sin navegador
 * (labelPdf.test.ts).
 *
 * Unidades: milímetros. Los puntos tipográficos se convierten con PT_MM.
 */
import type { LabelSize, LabelSpec } from './labels.ts';

/** Subconjunto de jsPDF que se usa aquí. */
export interface PdfDoc {
  addPage(format: [number, number], orientation: 'p' | 'l'): unknown;
  setFont(name: string, style: 'normal' | 'bold'): unknown;
  setFontSize(pt: number): unknown;
  setTextColor(r: number, g: number, b: number): unknown;
  setFillColor(r: number, g: number, b: number): unknown;
  setDrawColor(r: number, g: number, b: number): unknown;
  setLineWidth(w: number): unknown;
  text(t: string | string[], x: number, y: number, opts?: { baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic'; align?: 'left' | 'center' | 'right' }): unknown;
  rect(x: number, y: number, w: number, h: number, style?: 'S' | 'F' | 'FD'): unknown;
  addImage(data: string, format: 'PNG', x: number, y: number, w: number, h: number): unknown;
  splitTextToSize(t: string, maxWidth: number): string[];
  output(type: 'blob'): Blob;
}

export const PT_MM = 25.4 / 72;
/** Carta vertical, en mm. */
export const PAGE_LETTER = { w: 215.9, h: 279.4 };
export const SHEET_MARGIN_MM = 8;
export const SHEET_GAP_MM = 2;

/* ------------------------------------------------------------------ Paginación */

export interface Placement {
  /** Página (0 = primera). */
  page: number;
  x: number;
  y: number;
}

export interface SheetPlan {
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  perPage: number;
  pageCount: number;
  placements: Placement[];
}

/**
 * Reparte `count` etiquetas.
 *  - Rollo: una etiqueta por página, del tamaño exacto de la etiqueta (impresoras térmicas).
 *  - Hoja: carta vertical con márgenes y separación; se llenan filas de izquierda a derecha.
 */
export function planSheet(
  count: number,
  size: Pick<LabelSize, 'widthMm' | 'heightMm'>,
  roll: boolean,
  margin = SHEET_MARGIN_MM,
  gap = SHEET_GAP_MM,
): SheetPlan {
  const n = Math.max(0, Math.floor(count));
  if (roll) {
    return {
      pageW: size.widthMm,
      pageH: size.heightMm,
      cols: 1,
      rows: 1,
      perPage: 1,
      pageCount: n,
      placements: Array.from({ length: n }, (_, i) => ({ page: i, x: 0, y: 0 })),
    };
  }
  const usableW = PAGE_LETTER.w - 2 * margin;
  const usableH = PAGE_LETTER.h - 2 * margin;
  const cols = Math.max(1, Math.floor((usableW + gap) / (size.widthMm + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (size.heightMm + gap)));
  const perPage = cols * rows;
  const placements: Placement[] = [];
  for (let i = 0; i < n; i++) {
    const page = Math.floor(i / perPage);
    const slot = i % perPage;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    placements.push({ page, x: margin + col * (size.widthMm + gap), y: margin + row * (size.heightMm + gap) });
  }
  return { pageW: PAGE_LETTER.w, pageH: PAGE_LETTER.h, cols, rows, perPage, pageCount: n === 0 ? 0 : Math.ceil(n / perPage), placements };
}

/* ------------------------------------------------------------------- Texto seguro */

/**
 * jsPDF con las fuentes estándar solo dibuja Latin-1: se cambian los signos fuera de ese rango
 * (la elipsis y las comillas tipográficas) y se descarta el resto para no imprimir basura.
 */
export function pdfSafeText(input: string): string {
  return input
    .replace(/…/g, '...')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .normalize('NFC')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corta el texto a un máximo de caracteres agregando "..." (sin salirse de Latin-1). */
export function clipText(text: string, max: number): string {
  const t = pdfSafeText(text);
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

/* ------------------------------------------------------------------ Código de barras */

/** Tramos continuos de barras negras de una cadena binaria "1011001...". */
export function barcodeRuns(binary: string): { start: number; len: number }[] {
  const runs: { start: number; len: number }[] = [];
  let start = -1;
  for (let i = 0; i <= binary.length; i++) {
    const on = i < binary.length && binary[i] === '1';
    if (on && start === -1) start = i;
    if (!on && start !== -1) {
      runs.push({ start, len: i - start });
      start = -1;
    }
  }
  return runs;
}

/** Zona de silencio a cada lado, en módulos. */
export const QUIET_MODULES = 4;

/* ----------------------------------------------------------------- Diseño de etiqueta */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelLayout {
  padMm: number;
  title: (Box & { pt: number; maxLines: number; lineH: number }) | null;
  sub: Box & { pt: number };
  price: (Box & { pt: number }) | null;
  barcode: Box | null;
  codeText: (Box & { pt: number }) | null;
  qr: { x: number; y: number; size: number } | null;
  missingCode: { x: number; y: number; pt: number } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const printable = (v: string) => v.length > 0 && /^[\x20-\x7e]+$/.test(v);

/**
 * Calcula dónde va cada elemento DENTRO de una etiqueta (coordenadas relativas a su esquina).
 * Texto a la izquierda, QR a la derecha (si se pidió) y el código de barras al pie del texto.
 */
export function layoutLabel(size: Pick<LabelSize, 'widthMm' | 'heightMm'>, spec: Pick<LabelSpec, 'title' | 'subtitle' | 'priceText' | 'barcodeValue' | 'qrValue'>): LabelLayout {
  const { widthMm: W, heightMm: H } = size;
  const pad = 1.2;
  const k = clamp(Math.min(H / 30, W / 50), 0.8, 1.4);
  const gap = 1;

  const qrSize = spec.qrValue ? Math.max(0, Math.min(H - 2 * pad, W * 0.38)) : 0;
  const textW = Math.max(8, W - 2 * pad - (qrSize > 0 ? qrSize + gap : 0));
  const qr = qrSize > 0 ? { x: W - pad - qrSize, y: (H - qrSize) / 2, size: qrSize } : null;

  let cursor = pad;

  // Título: hasta 2 renglones (según una estimación de ancho medio de carácter).
  let title: LabelLayout['title'] = null;
  if (spec.title) {
    const pt = 6.5 * k;
    const charW = pt * PT_MM * 0.52;
    const maxLines = Math.ceil(pdfSafeText(spec.title).length * charW) > textW ? 2 : 1;
    const lineH = pt * PT_MM * 1.15;
    title = { x: pad, y: cursor, w: textW, h: lineH * maxLines, pt, maxLines, lineH };
    cursor += lineH * maxLines;
  }

  // Variante a la izquierda y precio a la derecha de la misma fila.
  const subPt = 5.5 * k;
  const pricePt = 7 * k;
  const priceW = spec.priceText ? pdfSafeText(spec.priceText).length * pricePt * PT_MM * 0.6 : 0;
  const rowH = Math.max(subPt, spec.priceText ? pricePt : 0) * PT_MM * 1.15;
  const sub = { x: pad, y: cursor, w: Math.max(4, textW - priceW - (priceW > 0 ? 1 : 0)), h: rowH, pt: subPt };
  const price = spec.priceText ? { x: pad + textW - priceW, y: cursor, w: priceW, h: rowH, pt: pricePt } : null;
  cursor += rowH + 0.4;

  // Código de barras con su texto debajo.
  const hasCode = printable(spec.barcodeValue);
  if (!hasCode) {
    return { padMm: pad, title, sub, price, barcode: null, codeText: null, qr, missingCode: { x: pad, y: cursor, pt: 6 * k } };
  }
  const codePt = 4.8 * k;
  const codeH = codePt * PT_MM * 1.15;
  const barH = Math.max(3, H - pad - codeH - cursor);
  const barcode: Box = { x: pad, y: cursor, w: textW, h: barH };
  const codeText = { x: pad, y: cursor + barH + 0.2, w: textW, h: codeH, pt: codePt };
  return { padMm: pad, title, sub, price, barcode, codeText, qr, missingCode: null };
}

/* -------------------------------------------------------------------- Armado del PDF */

export interface PdfDeps {
  /** Crea el documento con su PRIMERA página ya agregada (formato en mm). */
  createDoc: (format: [number, number], orientation: 'p' | 'l') => PdfDoc;
  /** Cadena binaria "1011..." del Code 128, o null si no se puede codificar. */
  barcode: (value: string) => string | null;
  /** PNG en data URL del QR, o null si falla. */
  qr: (value: string) => Promise<string | null>;
}

export interface LabelsPdfResult {
  doc: PdfDoc;
  pageCount: number;
  labelCount: number;
}

const orientationOf = (w: number, h: number): 'p' | 'l' => (w > h ? 'l' : 'p');

/** Dibuja una etiqueta en (ox, oy). */
function drawLabel(doc: PdfDoc, spec: LabelSpec, size: LabelSize, ox: number, oy: number, roll: boolean, barcodeBits: string | null, qrData: string | null): void {
  const lay = layoutLabel(size, spec);

  // Contorno tenue para recortar (en rollo la propia página es la etiqueta).
  if (!roll) {
    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(0.15);
    doc.rect(ox, oy, size.widthMm, size.heightMm, 'S');
  }

  doc.setTextColor(0, 0, 0);
  if (lay.title && spec.title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(lay.title.pt);
    const lines = doc.splitTextToSize(pdfSafeText(spec.title), lay.title.w).slice(0, lay.title.maxLines);
    lines.forEach((ln, i) => doc.text(ln, ox + lay.title!.x, oy + lay.title!.y + i * lay.title!.lineH, { baseline: 'top' }));
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(lay.sub.pt);
  const subLine = doc.splitTextToSize(pdfSafeText(spec.subtitle), lay.sub.w)[0] ?? '';
  doc.text(subLine, ox + lay.sub.x, oy + lay.sub.y, { baseline: 'top' });

  if (lay.price && spec.priceText) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(lay.price.pt);
    doc.text(pdfSafeText(spec.priceText), ox + lay.price.x + lay.price.w, oy + lay.price.y, { baseline: 'top', align: 'right' });
  }

  if (lay.barcode && lay.codeText && barcodeBits) {
    const modules = barcodeBits.length + 2 * QUIET_MODULES;
    const moduleW = lay.barcode.w / modules;
    doc.setFillColor(0, 0, 0);
    for (const r of barcodeRuns(barcodeBits)) {
      doc.rect(ox + lay.barcode.x + (QUIET_MODULES + r.start) * moduleW, oy + lay.barcode.y, r.len * moduleW, lay.barcode.h, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(lay.codeText.pt);
    doc.text(pdfSafeText(spec.barcodeValue), ox + lay.codeText.x + lay.codeText.w / 2, oy + lay.codeText.y, { baseline: 'top', align: 'center' });
  } else if (lay.missingCode || (lay.barcode && !barcodeBits)) {
    const at = lay.missingCode ?? { x: lay.barcode!.x, y: lay.barcode!.y, pt: 6 };
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(at.pt);
    doc.setTextColor(163, 38, 34);
    doc.text(spec.barcodeValue ? 'Codigo no valido' : 'SIN CODIGO', ox + at.x, oy + at.y, { baseline: 'top' });
    doc.setTextColor(0, 0, 0);
  }

  if (lay.qr && qrData) doc.addImage(qrData, 'PNG', ox + lay.qr.x, oy + lay.qr.y, lay.qr.size, lay.qr.size);
}

/**
 * Arma el PDF de la hoja de etiquetas respetando tamaño, copias (cada `LabelSpec` ya es una copia)
 * y las opciones de nombre/precio/QR (ya aplicadas en `specs` por buildLabelSpecs).
 */
export async function buildLabelsPdf(specs: LabelSpec[], size: LabelSize, roll: boolean, deps: PdfDeps): Promise<LabelsPdfResult> {
  if (specs.length === 0) throw new Error('No hay etiquetas para generar.');
  const plan = planSheet(specs.length, size, roll);

  // Cada código y cada QR distintos se codifican una sola vez.
  const bits = new Map<string, string | null>();
  const qrs = new Map<string, string | null>();
  for (const s of specs) {
    if (s.barcodeValue && !bits.has(s.barcodeValue)) bits.set(s.barcodeValue, printable(s.barcodeValue) ? deps.barcode(s.barcodeValue) : null);
    if (s.qrValue && !qrs.has(s.qrValue)) qrs.set(s.qrValue, await deps.qr(s.qrValue));
  }

  const format: [number, number] = [plan.pageW, plan.pageH];
  const orientation = orientationOf(plan.pageW, plan.pageH);
  const doc = deps.createDoc(format, orientation);
  let currentPage = 0;
  specs.forEach((spec, i) => {
    const at = plan.placements[i]!;
    while (currentPage < at.page) {
      doc.addPage(format, orientation);
      currentPage++;
    }
    drawLabel(doc, spec, size, at.x, at.y, roll, spec.barcodeValue ? bits.get(spec.barcodeValue) ?? null : null, spec.qrValue ? qrs.get(spec.qrValue) ?? null : null);
  });
  return { doc, pageCount: plan.pageCount, labelCount: specs.length };
}

/** Nombre de archivo: etiquetas-AAAAMMDD-HHMM.pdf (hora de México). */
export function labelsFileName(nowIso: string): string {
  const d = new Date(new Date(nowIso).getTime() - 6 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `etiquetas-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.pdf`;
}
