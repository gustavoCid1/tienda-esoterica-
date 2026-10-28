/**
 * Piezas del navegador para los PDF (jsPDF, jsbarcode, qrcode, descarga e impresión).
 * La lógica de armado vive en labelPdf.ts y permitTicket.ts; aquí solo se conectan las bibliotecas.
 * No se prueba con vitest (necesita navegador y dependencias instaladas).
 */
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { PdfDeps, PdfDoc } from './labelPdf.ts';
import {
  PERMIT_WIDTH_MM, buildPermitTicketModel, renderPermitTicket, ticketHeightMm, type PermitTicketData,
} from './permitTicket.ts';

/** Carga jsPDF bajo demanda (el módulo es grande y solo se usa al generar un PDF). */
export async function loadJsPdf(): Promise<(format: [number, number], orientation: 'p' | 'l') => PdfDoc> {
  const { jsPDF } = await import('jspdf');
  return (format, orientation) => new jsPDF({ orientation, unit: 'mm', format, compress: true }) as unknown as PdfDoc;
}

/**
 * Code 128 como cadena binaria ("1" = barra) usando el modo "objeto" de jsbarcode, que no necesita
 * DOM. Devuelve null si el valor no se puede codificar.
 */
export function code128Bits(value: string): string | null {
  try {
    const holder: { encodings?: { data: string }[] } = {};
    (JsBarcode as unknown as (target: object, text: string, options: object) => void)(holder, value, { format: 'CODE128' });
    const enc = holder.encodings;
    if (!enc || enc.length === 0) return null;
    const bits = enc.map((e) => e.data).join('');
    return bits.length > 0 ? bits : null;
  } catch {
    return null;
  }
}

/** QR como PNG en data URL; null si falla. */
export async function qrPng(value: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(value, { margin: 0, width: 256, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}

/** Dependencias completas para buildLabelsPdf. */
export async function loadPdfDeps(): Promise<PdfDeps> {
  const createDoc = await loadJsPdf();
  return { createDoc, barcode: code128Bits, qr: qrPng };
}

/** Descarga un Blob como archivo. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Imprime el PDF que muestra el iframe de la vista previa (no la página de la aplicación).
 * Si el navegador no permite imprimir desde el iframe, abre el PDF en una pestaña nueva para que
 * se imprima desde su visor. Devuelve false si tampoco se pudo abrir la pestaña.
 */
export function printPdfFrame(frame: HTMLIFrameElement | null, blobUrl: string): boolean {
  try {
    const win = frame?.contentWindow;
    if (win) {
      win.focus();
      win.print();
      return true;
    }
  } catch {
    /* se intenta la pestaña nueva */
  }
  const w = window.open(blobUrl, '_blank');
  return !!w;
}

/** Genera el PDF del "Ticket de permiso" (80 mm de ancho, violeta) y lo devuelve como Blob. */
export async function makePermitTicketPdf(data: PermitTicketData): Promise<Blob> {
  const lines = buildPermitTicketModel(data);
  const createDoc = await loadJsPdf();
  const doc = createDoc([PERMIT_WIDTH_MM, ticketHeightMm(lines)], 'p');
  renderPermitTicket(doc, lines);
  return doc.output('blob');
}
