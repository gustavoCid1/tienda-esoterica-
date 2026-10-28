/**
 * Lectura de códigos. La compatibilidad REAL depende del dispositivo (cámara, enfoque, ML Kit /
 * AVFoundation), de la iluminación y de la calidad de la etiqueta; esta lógica solo normaliza lo leído.
 */

/**
 * Variantes de búsqueda para un código leído. UPC-A (12 dígitos) puede llegar como EAN-13 con un 0
 * delante (iOS y algunos dispositivos lo hacen) y viceversa; se prueban ambas formas.
 * El primer elemento es SIEMPRE el código tal cual se leyó (sin espacios).
 */
export function candidateCodes(raw: string): string[] {
  const code = raw.trim();
  if (!code) return [];
  const out = [code];
  if (/^\d{13}$/.test(code) && code.startsWith('0')) out.push(code.slice(1));
  if (/^\d{12}$/.test(code)) out.push(`0${code}`);
  return out;
}

/** Evita procesar 20 veces el mismo código mientras la cámara lo sigue viendo. */
export class ScanDebouncer {
  private last: string | null = null;
  private lastAt = 0;
  private windowMs: number;
  constructor(windowMs = 1500) {
    this.windowMs = windowMs;
  }

  /** true si la lectura debe procesarse. */
  accept(code: string, nowMs: number): boolean {
    if (code === this.last && nowMs - this.lastAt < this.windowMs) return false;
    this.last = code;
    this.lastAt = nowMs;
    return true;
  }

  reset(): void {
    this.last = null;
    this.lastAt = 0;
  }
}

/** Tipos de código que se piden a la cámara (en expo-camera: barcodeTypes). */
export const SCAN_BARCODE_TYPES = ['code128', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] as const;
export type ScanBarcodeType = (typeof SCAN_BARCODE_TYPES)[number];
