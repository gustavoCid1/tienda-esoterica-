/**
 * Carrito de la venta de emergencia. Lógica PURA e inmutable.
 * `saleId` se genera al crear el carrito (ANTES de cobrar): reintentar el cobro con el mismo id
 * nunca duplica la venta (registerSale es idempotente por saleId).
 */
import { newId } from '@amara/shared';

export interface CartLine {
  variantId: string;
  productName: string;
  label: string;
  unitPriceCents: number;
  qty: number;
  /** v2. Categoría del producto (decide si admite el botón "Extra"). */
  category?: string;
  /** v2. Existencia disponible conocida al agregar (nunca negativa). Sin dato = no se valida en pantalla (el almacén igual valida). */
  available?: number;
}

/** v2. Cargo extra sobre un producto (monto y nota). Se vende como línea kind 'extra': 1 pieza, sin inventario. */
export interface CartExtra {
  id: string;
  variantId: string;
  productName: string;
  label: string;
  amountCents: number;
  note: string;
}

export interface Cart {
  saleId: string;
  lines: CartLine[];
  extras?: CartExtra[];
}

export function newCart(id: string = newId()): Cart {
  return { saleId: id, lines: [] };
}

export interface CartItemInfo {
  variantId: string;
  productName: string;
  label: string;
  priceCents: number;
  category?: string;
  /** Existencia del catálogo local (CatalogHit.qty). Puede venir negativa (heredada): se trata como 0. */
  qty?: number;
}

/** Existencia vendible: nunca negativa. */
export function sellableQty(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : Math.max(0, raw);
}

/**
 * ¿Se puede agregar `add` unidades más de esta línea? Devuelve el motivo en español o null.
 * Con existencia 0 no se vende; tampoco más de lo disponible.
 */
export function addBlockedReason(available: number | undefined, inCart: number, add: number, name: string): string | null {
  const avail = sellableQty(available);
  if (avail === undefined) return null;
  if (avail <= 0) return `"${name}" no tiene existencia y no se puede vender.`;
  if (inCart + add > avail) return inCart > 0 ? `Solo hay ${avail} de "${name}" y ya tienes ${inCart} en la venta.` : `Solo hay ${avail} de "${name}" en existencia.`;
  return null;
}

export function qtyInCart(cart: Cart, variantId: string): number {
  return cart.lines.find((l) => l.variantId === variantId)?.qty ?? 0;
}

/** Agrega validando existencias. `error` != null = no se agregó nada. */
export function addToCartChecked(cart: Cart, item: CartItemInfo, qty = 1): { cart: Cart; error: string | null } {
  const error = addBlockedReason(item.qty, qtyInCart(cart, item.variantId), qty, item.productName);
  if (error) return { cart, error };
  return { cart: addToCart(cart, item, qty), error: null };
}

/** Cambia la cantidad validando existencias (subir más de lo disponible se rechaza; bajar o quitar siempre se permite). */
export function setQtyChecked(cart: Cart, variantId: string, qty: number): { cart: Cart; error: string | null } {
  const line = cart.lines.find((l) => l.variantId === variantId);
  if (line && qty > line.qty) {
    const error = addBlockedReason(line.available, line.qty, qty - line.qty, line.productName);
    if (error) return { cart, error };
  }
  return { cart: setQty(cart, variantId, qty), error: null };
}

export function addToCart(cart: Cart, item: CartItemInfo, qty = 1): Cart {
  if (!Number.isInteger(qty) || qty <= 0) return cart;
  const i = cart.lines.findIndex((l) => l.variantId === item.variantId);
  if (i >= 0) {
    const lines = cart.lines.slice();
    lines[i] = { ...lines[i]!, qty: lines[i]!.qty + qty, unitPriceCents: item.priceCents, ...(item.qty !== undefined ? { available: sellableQty(item.qty) } : {}) };
    return { ...cart, lines };
  }
  const line: CartLine = { variantId: item.variantId, productName: item.productName, label: item.label, unitPriceCents: item.priceCents, qty };
  if (item.category !== undefined) line.category = item.category;
  if (item.qty !== undefined) line.available = sellableQty(item.qty);
  return { ...cart, lines: [...cart.lines, line] };
}

/** qty <= 0 elimina la línea. */
export function setQty(cart: Cart, variantId: string, qty: number): Cart {
  if (!Number.isInteger(qty)) return cart;
  if (qty <= 0) return removeLine(cart, variantId);
  return { ...cart, lines: cart.lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)) };
}

export function removeLine(cart: Cart, variantId: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.variantId !== variantId) };
}

export function cartTotalCents(cart: Cart): number {
  return cart.lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0) + (cart.extras ?? []).reduce((a, e) => a + e.amountCents, 0);
}

export function addExtra(cart: Cart, extra: CartExtra): Cart {
  return { ...cart, extras: [...(cart.extras ?? []), extra] };
}

export function removeExtra(cart: Cart, id: string): Cart {
  return { ...cart, extras: (cart.extras ?? []).filter((e) => e.id !== id) };
}

export function cartIsEmpty(cart: Cart): boolean {
  return cart.lines.length === 0 && (cart.extras ?? []).length === 0;
}

/** Líneas para LocalStore.registerSale: productos normales y extras (kind 'extra', qty 1, monto en unitPriceCents). */
export function toSaleItems(cart: Cart): { variantId: string; qty: number; kind?: 'extra'; unitPriceCents?: number; extraNote?: string }[] {
  return [
    ...cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
    ...(cart.extras ?? []).map((e) => ({ variantId: e.variantId, qty: 1, kind: 'extra' as const, unitPriceCents: e.amountCents, extraNote: e.note })),
  ];
}

export function cartUnits(cart: Cart): number {
  return cart.lines.reduce((a, l) => a + l.qty, 0);
}

/** Borrador persistible (solo ids y cantidades; los precios se vuelven a leer del catálogo local). */
export interface CartDraft {
  saleId: string;
  lines: { variantId: string; qty: number }[];
  /** v2. Los extras guardan su monto y nota (los escribió la persona, no vienen del catálogo). */
  extras?: CartExtra[];
}

export function toDraft(cart: Cart): CartDraft {
  const draft: CartDraft = { saleId: cart.saleId, lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) };
  if ((cart.extras ?? []).length > 0) draft.extras = cart.extras;
  return draft;
}

export function parseDraft(raw: string | null | undefined): CartDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CartDraft>;
    if (typeof v.saleId !== 'string' || !Array.isArray(v.lines)) return null;
    const lines = v.lines.filter((l): l is { variantId: string; qty: number } => !!l && typeof l.variantId === 'string' && Number.isInteger(l.qty) && l.qty > 0);
    const extras = Array.isArray(v.extras)
      ? v.extras.filter(
          (e): e is CartExtra =>
            !!e && typeof e.id === 'string' && typeof e.variantId === 'string' && typeof e.productName === 'string' && typeof e.label === 'string' && Number.isInteger(e.amountCents) && e.amountCents > 0 && typeof e.note === 'string',
        )
      : [];
    return extras.length > 0 ? { saleId: v.saleId, lines, extras } : { saleId: v.saleId, lines };
  } catch {
    return null;
  }
}
