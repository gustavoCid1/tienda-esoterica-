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
}

export interface Cart {
  saleId: string;
  lines: CartLine[];
}

export function newCart(id: string = newId()): Cart {
  return { saleId: id, lines: [] };
}

export interface CartItemInfo {
  variantId: string;
  productName: string;
  label: string;
  priceCents: number;
}

export function addToCart(cart: Cart, item: CartItemInfo, qty = 1): Cart {
  if (!Number.isInteger(qty) || qty <= 0) return cart;
  const i = cart.lines.findIndex((l) => l.variantId === item.variantId);
  if (i >= 0) {
    const lines = cart.lines.slice();
    lines[i] = { ...lines[i]!, qty: lines[i]!.qty + qty, unitPriceCents: item.priceCents };
    return { ...cart, lines };
  }
  return { ...cart, lines: [...cart.lines, { variantId: item.variantId, productName: item.productName, label: item.label, unitPriceCents: item.priceCents, qty }] };
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
  return cart.lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0);
}

export function cartUnits(cart: Cart): number {
  return cart.lines.reduce((a, l) => a + l.qty, 0);
}

/** Borrador persistible (solo ids y cantidades; los precios se vuelven a leer del catálogo local). */
export interface CartDraft {
  saleId: string;
  lines: { variantId: string; qty: number }[];
}

export function toDraft(cart: Cart): CartDraft {
  return { saleId: cart.saleId, lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) };
}

export function parseDraft(raw: string | null | undefined): CartDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CartDraft>;
    if (typeof v.saleId !== 'string' || !Array.isArray(v.lines)) return null;
    const lines = v.lines.filter((l): l is { variantId: string; qty: number } => !!l && typeof l.variantId === 'string' && Number.isInteger(l.qty) && l.qty > 0);
    return { saleId: v.saleId, lines };
  } catch {
    return null;
  }
}
