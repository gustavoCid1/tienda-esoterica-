/**
 * Armado de etiquetas (Code 128 + QR). Solo lógica pura: el dibujo del código de barras y
 * del QR se hace en components/LabelCard.tsx con jsbarcode y qrcode.
 *
 * Contenido:
 *  - Code 128: código de barras del fabricante si existe; si no, el código interno AMA########.
 *  - QR: buildQrValue(variantId) => "amara:v1:<uuid>" (identifica, no contiene credenciales).
 */
import { buildQrValue, formatMXN } from '@amara/shared';

export interface LabelSource {
  variantId: string;
  productName: string;
  variantLabel: string;
  barcode?: string | null;
  code?: string | null;
  priceCents: number;
}

export interface LabelBatchItem extends LabelSource {
  copies: number;
}

export interface LabelOptions {
  showName: boolean;
  showPrice: boolean;
  showQr: boolean;
}

export interface LabelSpec {
  key: string;
  variantId: string;
  title: string;
  subtitle: string;
  priceText: string | null;
  /** Texto que se codifica en el Code 128 ('' si la variante no tiene código). */
  barcodeValue: string;
  qrValue: string | null;
  warnings: string[];
  duplicate: boolean;
}

export interface LabelSize {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const LABEL_SIZES: LabelSize[] = [
  { id: '50x30', label: '50 x 30 mm', widthMm: 50, heightMm: 30 },
  { id: '40x25', label: '40 x 25 mm', widthMm: 40, heightMm: 25 },
  { id: '60x40', label: '60 x 40 mm', widthMm: 60, heightMm: 40 },
  { id: '70x40', label: '70 x 40 mm', widthMm: 70, heightMm: 40 },
];

export const MAX_COPIES = 200;

export function clampCopies(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_COPIES, Math.max(1, Math.floor(n)));
}

/** Valor del Code 128: código de barras propio, o el interno si no tiene. */
export function barcodeValueOf(src: Pick<LabelSource, 'barcode' | 'code'>): string {
  return (src.barcode ?? '').trim() || (src.code ?? '').trim();
}

/** Code 128 (juego B) admite ASCII imprimible 32-126. */
export function isCode128Printable(value: string): boolean {
  return value.length > 0 && /^[\x20-\x7e]+$/.test(value);
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Códigos usados por MÁS DE UNA variante distinta dentro del lote.
 * Devuelve el conjunto de códigos duplicados (comparación exacta, sin distinguir mayúsculas).
 */
export function findDuplicateCodes(sources: Pick<LabelSource, 'variantId' | 'barcode' | 'code'>[]): Set<string> {
  const byCode = new Map<string, Set<string>>();
  for (const s of sources) {
    const v = barcodeValueOf(s).toUpperCase();
    if (!v) continue;
    const set = byCode.get(v) ?? new Set<string>();
    set.add(s.variantId);
    byCode.set(v, set);
  }
  const dups = new Set<string>();
  for (const [code, ids] of byCode) if (ids.size > 1) dups.add(code);
  return dups;
}

/** Expande el lote (con copias por variante) en etiquetas individuales con sus advertencias. */
export function buildLabelSpecs(batch: LabelBatchItem[], opts: LabelOptions): LabelSpec[] {
  const dups = findDuplicateCodes(batch);
  const out: LabelSpec[] = [];
  for (const item of batch) {
    const value = barcodeValueOf(item);
    const warnings: string[] = [];
    if (!value) warnings.push('Sin código de barras ni código interno');
    else if (!isCode128Printable(value)) warnings.push('El código tiene caracteres que Code 128 no admite');
    const duplicate = value !== '' && dups.has(value.toUpperCase());
    if (duplicate) warnings.push(`Código duplicado en el lote: ${value}`);
    const copies = clampCopies(item.copies);
    for (let n = 1; n <= copies; n++) {
      out.push({
        key: `${item.variantId}-${n}`,
        variantId: item.variantId,
        title: opts.showName ? truncate(item.productName, 34) : '',
        subtitle: truncate(item.variantLabel, 28),
        priceText: opts.showPrice ? formatMXN(item.priceCents) : null,
        barcodeValue: value,
        qrValue: opts.showQr ? buildQrValue(item.variantId) : null,
        warnings,
        duplicate,
      });
    }
  }
  return out;
}

/** ¿Se puede imprimir sin confirmación? (todas con código válido y sin duplicados). */
export function labelsBlockingProblems(specs: LabelSpec[]): string[] {
  const set = new Set<string>();
  for (const s of specs) for (const w of s.warnings) set.add(w);
  return [...set];
}

/** Agrega una variante al lote; si ya está, suma copias. No muta el original. */
export function addToBatch(batch: LabelBatchItem[], src: LabelSource, copies = 1): LabelBatchItem[] {
  const i = batch.findIndex((b) => b.variantId === src.variantId);
  if (i === -1) return [...batch, { ...src, copies: clampCopies(copies) }];
  return batch.map((b, idx) => (idx === i ? { ...b, copies: clampCopies(b.copies + copies) } : b));
}

/** Convierte una fila de inventario o de catálogo (posiblemente parcial) en origen de etiqueta. */
export function rowToLabelSource(r: {
  variantId?: string;
  productName?: string;
  variantLabel?: string;
  barcode?: string | null;
  code?: string | null;
  priceCents?: number;
}): LabelSource | null {
  if (!r.variantId) return null;
  return {
    variantId: r.variantId,
    productName: r.productName ?? '',
    variantLabel: r.variantLabel ?? '',
    barcode: r.barcode ?? null,
    code: r.code ?? null,
    priceCents: r.priceCents ?? 0,
  };
}
