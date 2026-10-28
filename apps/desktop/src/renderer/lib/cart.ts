/**
 * Carrito (lógica PURA y probada): líneas de producto y líneas "Extra", reglas de existencias.
 *
 * REGLAS (contrato v2):
 *  - No se agrega más de lo disponible ni se vende en 0. Nunca se muestran cantidades negativas.
 *  - Una línea 'extra' es un cargo adicional sobre un producto: qty = 1, sin inventario, con nota.
 *  - El proceso principal y el almacén local VUELVEN a validar todo; esto solo evita errores en pantalla.
 */
import type { CatalogHit } from '@amara/database';

export type CartKind = 'producto' | 'extra';

export interface CartLine {
  /** Identificador único de la línea: `p:<variantId>` para productos; `x:<id>` para extras. */
  key: string;
  kind: CartKind;
  variantId: string;
  productName: string;
  label: string;
  code: string;
  category: string;
  unitPriceCents: number;
  qty: number;
  /** Existencia local al agregar (ya sin negativos). Los extras no la usan. */
  stockQty: number;
  /** Solo extras: qué se cobró. */
  extraNote?: string;
  /** Solo extras: línea de producto a la que acompañan. */
  parentKey?: string;
}

export const MAX_LINE_QTY = 9999;
export const MAX_EXTRA_CENTS = 10_000_000; // $100,000.00 como tope de cordura
export const MAX_NOTE_LEN = 120;

export const productKey = (variantId: string) => `p:${variantId}`;

// ───────────── Existencias ─────────────

export interface StockView {
  /** Cantidad a mostrar: nunca negativa. */
  shown: number;
  soldOut: boolean;
  /** true = la existencia registrada es NEGATIVA (dato heredado): hay que corregirla en inventario. */
  inherited: boolean;
  /** Texto corto para listas. */
  text: string;
  /** Aviso largo, o null. */
  notice: string | null;
}

export function stockView(qty: number): StockView {
  const q = Number.isFinite(qty) ? Math.trunc(qty) : 0;
  const shown = Math.max(0, q);
  const inherited = q < 0;
  const soldOut = shown === 0;
  return {
    shown,
    soldOut,
    inherited,
    text: soldOut ? 'Sin existencia' : `Existencia ${shown}`,
    notice: inherited ? 'Existencia por corregir: el sistema tenía un saldo negativo. Pide al gerente que haga un conteo.' : null,
  };
}

export type AddResult =
  | { ok: true; lines: CartLine[] }
  | { ok: false; reason: 'sin_existencia' | 'tope'; message: string };

const fullName = (name: string, label: string) => (label && label !== 'Única' ? `${name} - ${label}` : name);

/** Agrega una pieza del producto. Rechaza si no hay existencia o ya se agregó todo lo disponible. */
export function addProduct(lines: CartLine[], h: Pick<CatalogHit, 'variantId' | 'productName' | 'label' | 'barcode' | 'internalCode' | 'category' | 'priceCents' | 'qty'>): AddResult {
  const avail = stockView(h.qty).shown;
  const name = fullName(h.productName, h.label);
  if (avail <= 0) return { ok: false, reason: 'sin_existencia', message: `${name}: Sin existencia. No se puede vender.` };
  const key = productKey(h.variantId);
  const i = lines.findIndex((l) => l.key === key);
  if (i >= 0) {
    const cur = lines[i]!;
    const max = Math.min(MAX_LINE_QTY, Math.min(cur.stockQty, avail));
    if (cur.qty + 1 > max) return { ok: false, reason: 'tope', message: `${name}: solo hay ${max} en existencia y ya los agregaste.` };
    return { ok: true, lines: lines.map((l, k) => (k === i ? { ...l, qty: l.qty + 1, stockQty: avail } : l)) };
  }
  return {
    ok: true,
    lines: [
      ...lines,
      {
        key, kind: 'producto', variantId: h.variantId, productName: h.productName, label: h.label, code: h.barcode ?? h.internalCode,
        category: h.category ?? '', unitPriceCents: h.priceCents, qty: 1, stockQty: avail,
      },
    ],
  };
}

/** Máximo que se puede vender de una línea (extras: siempre 1). */
export function maxQty(l: CartLine): number {
  return l.kind === 'extra' ? 1 : Math.max(0, Math.min(MAX_LINE_QTY, l.stockQty));
}

/** Cambia la cantidad dentro de 1..existencia. Los extras no cambian de cantidad. */
export function setQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  return lines.map((l) => {
    if (l.key !== key || l.kind === 'extra') return l;
    const max = Math.max(1, maxQty(l));
    return { ...l, qty: Math.max(1, Math.min(max, Math.floor(qty) || 1)) };
  });
}

/** Quita la línea y, si era un producto, también sus extras. */
export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key && l.parentKey !== key);
}

export type ExtraResult = { ok: true; lines: CartLine[] } | { ok: false; message: string };

/** Agrega una línea Extra (cargo adicional) ligada a una línea de producto. `id` debe ser único (newId). */
export function addExtra(lines: CartLine[], parentKey: string, amountCents: number, note: string, id: string): ExtraResult {
  const parent = lines.find((l) => l.key === parentKey && l.kind === 'producto');
  if (!parent) return { ok: false, message: 'Ese producto ya no está en la venta.' };
  if (!Number.isInteger(amountCents) || amountCents < 0) return { ok: false, message: 'Escribe el monto del extra (0 o más).' };
  if (amountCents > MAX_EXTRA_CENTS) return { ok: false, message: 'El monto del extra es demasiado grande.' };
  const clean = note.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return { ok: false, message: 'Escribe una nota que diga qué se cobra (por ejemplo "bordado").' };
  if (clean.length > MAX_NOTE_LEN) return { ok: false, message: `La nota es demasiado larga (máximo ${MAX_NOTE_LEN} letras).` };
  const extra: CartLine = {
    key: `x:${id}`, kind: 'extra', variantId: parent.variantId, productName: parent.productName, label: parent.label, code: parent.code,
    category: parent.category, unitPriceCents: amountCents, qty: 1, stockQty: 0, extraNote: clean, parentKey,
  };
  // El extra se coloca justo después de su producto (y de los extras que ya tenía).
  let idx = lines.findIndex((l) => l.key === parentKey) + 1;
  while (idx < lines.length && lines[idx]!.parentKey === parentKey) idx++;
  return { ok: true, lines: [...lines.slice(0, idx), extra, ...lines.slice(idx)] };
}

/** Importe de una línea (los extras cuentan como ingreso, no como piezas). */
export const lineTotal = (l: CartLine) => l.qty * l.unitPriceCents;
export const subtotalOf = (lines: CartLine[]) => lines.reduce((a, l) => a + lineTotal(l), 0);
/** Piezas vendidas (sin contar extras). */
export const pieceCount = (lines: CartLine[]) => lines.reduce((a, l) => a + (l.kind === 'extra' ? 0 : l.qty), 0);

/** Texto de la línea para pantalla: "Extra: bordado" o el nombre del producto. */
export function lineTitle(l: CartLine): string {
  return l.kind === 'extra' ? `Extra: ${l.extraNote ?? ''}` : l.productName;
}

export interface SaleItemReq {
  variantId: string;
  qty: number;
  kind?: CartKind;
  unitPriceCents?: number;
  extraNote?: string;
}

/** Líneas en el formato que espera el proceso principal. */
export function toSaleItems(lines: CartLine[]): SaleItemReq[] {
  return lines.map((l) =>
    l.kind === 'extra'
      ? { variantId: l.variantId, qty: 1, kind: 'extra' as const, unitPriceCents: l.unitPriceCents, extraNote: l.extraNote ?? '' }
      : { variantId: l.variantId, qty: l.qty },
  );
}

/**
 * Para una Limpia: el "cargo por el servicio" es un extra sin producto propio; se liga a la primera línea de producto.
 * Devuelve null si no hay productos (una limpia necesita al menos un artículo).
 */
export function withServiceCharge(lines: CartLine[], serviceCents: number, id: string): CartLine[] | null {
  const first = lines.find((l) => l.kind === 'producto');
  if (!first) return null;
  if (serviceCents <= 0) return lines;
  const r = addExtra(lines, first.key, serviceCents, 'Servicio de limpia', id);
  return r.ok ? r.lines : null;
}
