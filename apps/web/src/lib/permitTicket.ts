/**
 * "Ticket de permiso": comprobante imprimible de un token de seguridad (código, propósitos,
 * vigencia, sucursal y quién autoriza). Se dibuja con un color DISTINTO al del ticket normal de
 * venta (violeta en lugar de negro/dorado) para que nunca se confunda con un comprobante de compra.
 *
 * La disposición se calcula en una función pura (`buildPermitTicketModel`) y se dibuja sobre la
 * interfaz mínima `PdfDoc` (permitTicket.test.ts). El ancho es de 80 mm (rollo térmico).
 */
import type { PdfDoc } from './labelPdf.ts';
import { pdfSafeText } from './labelPdf.ts';
import { formatTokenDuration, minutesBetween, purposeLabel } from './tokens.ts';
import type { TokenPurpose } from './types-v2.ts';

/** Violeta del ticket de permiso (RGB). El ticket de venta no usa este color. */
export const PERMIT_COLOR: [number, number, number] = [91, 58, 140];
export const PERMIT_TINT: [number, number, number] = [241, 236, 248];
export const PERMIT_WIDTH_MM = 80;

export interface PermitTicketData {
  code: string;
  label: string;
  purposes: TokenPurpose[];
  issuedAtIso: string;
  expiresAtIso: string;
  /** Nombre de la sucursal; null/'' = cualquier sucursal. */
  branchName: string | null;
  /** Nombre del usuario al que va dirigido; null/'' = cualquiera. */
  forUserName: string | null;
  maxUses: number | null;
  /** Quién autoriza (gerente que creó el token). */
  authorizedBy: string;
  businessName?: string;
}

export interface TicketLine {
  kind: 'band' | 'title' | 'text' | 'bold' | 'code' | 'rule' | 'gap' | 'small';
  text: string;
}

/** "22/10/2026 14:05" en hora de México (UTC-6 fijo, igual que @amara/shared). */
export function formatMx(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '-';
  const d = new Date(t - 6 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Parte un texto en renglones de a lo más `maxChars` caracteres, sin cortar palabras cortas. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = pdfSafeText(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    let word = w;
    while (word.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= maxChars) cur = `${cur} ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const WRAP = 36;

/** Renglones del ticket, en orden. */
export function buildPermitTicketModel(d: PermitTicketData): TicketLine[] {
  const lines: TicketLine[] = [];
  const add = (kind: TicketLine['kind'], text = '') => lines.push({ kind, text });
  const addWrapped = (kind: TicketLine['kind'], text: string) => wrapText(text, WRAP).forEach((l) => add(kind, l));

  add('band', 'TICKET DE PERMISO');
  add('title', d.businessName ?? 'Esotérica Amara');
  add('small', 'Comprobante de autorización. No es un ticket de venta.');
  add('rule');
  if (d.label) addWrapped('bold', d.label);
  add('small', 'CÓDIGO DE AUTORIZACIÓN');
  add('code', d.code);
  add('gap');
  add('bold', 'Sirve para:');
  if (d.purposes.length === 0) add('text', '- (sin propósito)');
  for (const p of d.purposes) addWrapped('text', `- ${purposeLabel(p)}`);
  add('gap');
  add('bold', 'Vigencia');
  addWrapped('text', `Emitido: ${formatMx(d.issuedAtIso)}`);
  addWrapped('text', `Vence: ${formatMx(d.expiresAtIso)}`);
  const minutes = minutesBetween(d.issuedAtIso, d.expiresAtIso);
  if (minutes > 0) addWrapped('text', `Duración: ${formatTokenDuration(minutes)}`);
  add('gap');
  addWrapped('text', `Sucursal: ${d.branchName || 'Cualquier sucursal'}`);
  addWrapped('text', `Para: ${d.forUserName || 'Cualquier usuario'}`);
  addWrapped('text', `Usos: ${d.maxUses === null ? 'Sin límite dentro de su vigencia' : d.maxUses}`);
  add('rule');
  add('bold', 'Autoriza:');
  addWrapped('text', d.authorizedBy || '-');
  add('gap');
  addWrapped('small', 'Entrega este ticket solo a quien debe usar el permiso. El código deja de servir al vencer o al ser revocado.');
  return lines;
}

/** Alto de cada tipo de renglón en mm. */
export const LINE_HEIGHT_MM: Record<TicketLine['kind'], number> = {
  band: 9,
  title: 6,
  text: 4.4,
  bold: 4.8,
  code: 13,
  rule: 3,
  gap: 2.5,
  small: 3.6,
};

const MARGIN = 5;
const BOTTOM = 6;

/** Alto total de la página según el contenido. */
export function ticketHeightMm(lines: TicketLine[]): number {
  return Math.ceil(MARGIN + lines.reduce((a, l) => a + LINE_HEIGHT_MM[l.kind], 0) + BOTTOM);
}

/** Dibuja el ticket. `doc` debe haberse creado con `[PERMIT_WIDTH_MM, ticketHeightMm(lines)]`. */
export function renderPermitTicket(doc: PdfDoc, lines: TicketLine[]): void {
  const W = PERMIT_WIDTH_MM;
  const H = ticketHeightMm(lines);
  const [r, g, b] = PERMIT_COLOR;

  // Marco violeta alrededor de todo el ticket.
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.8);
  doc.rect(1.5, 1.5, W - 3, H - 3, 'S');

  let y = MARGIN;
  for (const l of lines) {
    const h = LINE_HEIGHT_MM[l.kind];
    switch (l.kind) {
      case 'band':
        doc.setFillColor(r, g, b);
        doc.rect(1.5, 1.5, W - 3, h + MARGIN - 1.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(pdfSafeText(l.text), W / 2, y + 1, { baseline: 'top', align: 'center' });
        break;
      case 'title':
        doc.setTextColor(r, g, b);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(pdfSafeText(l.text), W / 2, y + 1, { baseline: 'top', align: 'center' });
        break;
      case 'text':
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.text(pdfSafeText(l.text), MARGIN, y, { baseline: 'top' });
        break;
      case 'bold':
        doc.setTextColor(r, g, b);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(pdfSafeText(l.text), MARGIN, y, { baseline: 'top' });
        break;
      case 'small':
        doc.setTextColor(90, 90, 90);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(pdfSafeText(l.text), W / 2, y, { baseline: 'top', align: 'center' });
        break;
      case 'code':
        doc.setFillColor(PERMIT_TINT[0], PERMIT_TINT[1], PERMIT_TINT[2]);
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(0.5);
        doc.rect(MARGIN, y, W - 2 * MARGIN, h - 1, 'FD');
        doc.setTextColor(r, g, b);
        doc.setFont('courier', 'bold');
        doc.setFontSize(22);
        doc.text(pdfSafeText(l.text), W / 2, y + (h - 1) / 2, { baseline: 'middle', align: 'center' });
        break;
      case 'rule':
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(0.3);
        doc.rect(MARGIN, y + h / 2, W - 2 * MARGIN, 0.01, 'S');
        break;
      case 'gap':
        break;
    }
    y += h;
  }
}

export function permitFileName(nowIso: string): string {
  const d = new Date(new Date(nowIso).getTime() - 6 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `ticket-permiso-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.pdf`;
}
