/**
 * Carrito de la venta de emergencia. Se guarda un BORRADOR en la base local (meta) para que un cierre
 * inesperado de la app no pierda el carrito; el saleId del borrador se conserva, así que reintentar el
 * cobro nunca duplica la venta (registerSale es idempotente por saleId).
 */
import { newId } from '@amara/shared';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogHit } from '@amara/database';
import { addExtra, addToCart, addToCartChecked, cartTotalCents, cartUnits, newCart, parseDraft, removeExtra, removeLine, setQtyChecked, toDraft } from '../lib/cart';
import type { Cart, CartExtra } from '../lib/cart';
import { useApp } from './AppContext';

interface CartValue {
  cart: Cart;
  totalCents: number;
  units: number;
  /** Devuelve el motivo en español si NO se pudo agregar (sin existencia o más de lo disponible); null si se agregó. */
  add: (hit: Pick<CatalogHit, 'variantId' | 'productName' | 'label' | 'priceCents'> & Partial<Pick<CatalogHit, 'category' | 'qty'>>, qty?: number) => string | null;
  /** Devuelve el motivo si el aumento se rechazó (bajar o quitar siempre se permite). */
  changeQty: (variantId: string, qty: number) => string | null;
  remove: (variantId: string) => void;
  addExtraLine: (extra: Omit<CartExtra, 'id'>) => void;
  removeExtraLine: (id: string) => void;
  /** Vacía el carrito y genera un saleId nuevo (después de una venta registrada o al cancelar). */
  reset: () => void;
}

const Ctx = createContext<CartValue | null>(null);

export function useCart(): CartValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart debe usarse dentro de <CartProvider>');
  return v;
}

const draftKey = (userId: string) => `mobile_cart_draft:${userId}`;

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { store, phase, session, device } = useApp();
  const [cart, setCartState] = useState<Cart>(() => newCart());
  // Copia síncrona del carrito: permite validar existencias y devolver el motivo al instante.
  const cartRef = useRef<Cart>(cart);
  const setCart = useCallback((next: Cart) => {
    cartRef.current = next;
    setCartState(next);
  }, []);
  const loadedFor = useRef<string | null>(null);
  const userId = session?.user.id ?? null;
  const branchId = device?.branchId ?? null;

  // Carga del borrador al entrar un usuario.
  useEffect(() => {
    if (phase !== 'listo' || !store || !userId || !branchId) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    let cancelled = false;
    (async () => {
      const draft = parseDraft(await store.getMeta(draftKey(userId)));
      if (!draft) {
        if (!cancelled) setCart(newCart());
        return;
      }
      let restored = newCart(draft.saleId);
      for (const l of draft.lines) {
        // 'amara:v1:<id>' hace que findByCode busque por id de variante.
        const hit = (await store.findByCode(`amara:v1:${l.variantId}`, branchId))[0];
        if (hit) {
          // Existencia de hoy: si bajó desde que se guardó el borrador, la cantidad se recorta (nunca se vende lo que no hay).
          const avail = Math.max(0, hit.qty);
          const qty = Math.min(l.qty, avail);
          if (qty > 0) restored = addToCart(restored, hit, qty);
        }
      }
      for (const e of draft.extras ?? []) restored = addExtra(restored, e);
      if (!cancelled) setCart(restored);
    })().catch(() => {
      if (!cancelled) setCart(newCart());
    });
    return () => {
      cancelled = true;
    };
  }, [phase, store, userId, branchId, setCart]);

  // Al cerrar sesión se olvida el carrito en memoria (el borrador queda guardado para ese usuario).
  useEffect(() => {
    if (!session) {
      loadedFor.current = null;
      setCart(newCart());
    }
  }, [session, setCart]);

  // Guardado del borrador (con pequeño retraso para no escribir en cada toque).
  useEffect(() => {
    if (phase !== 'listo' || !store || !userId || loadedFor.current !== userId) return;
    const t = setTimeout(() => {
      store.setMeta(draftKey(userId), JSON.stringify(toDraft(cart))).catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [cart, phase, store, userId]);

  const add = useCallback<CartValue['add']>(
    (hit, qty = 1) => {
      const r = addToCartChecked(cartRef.current, { variantId: hit.variantId, productName: hit.productName, label: hit.label, priceCents: hit.priceCents, category: hit.category, qty: hit.qty }, qty);
      if (r.error) return r.error;
      setCart(r.cart);
      return null;
    },
    [setCart],
  );
  const changeQty = useCallback<CartValue['changeQty']>(
    (variantId, qty) => {
      const r = setQtyChecked(cartRef.current, variantId, qty);
      if (r.error) return r.error;
      setCart(r.cart);
      return null;
    },
    [setCart],
  );
  const remove = useCallback((variantId: string) => setCart(removeLine(cartRef.current, variantId)), [setCart]);
  const addExtraLine = useCallback((extra: Omit<CartExtra, 'id'>) => setCart(addExtra(cartRef.current, { ...extra, id: newId() })), [setCart]);
  const removeExtraLine = useCallback((id: string) => setCart(removeExtra(cartRef.current, id)), [setCart]);
  const reset = useCallback(() => setCart(newCart()), [setCart]);

  const value = useMemo<CartValue>(
    () => ({ cart, totalCents: cartTotalCents(cart), units: cartUnits(cart), add, changeQty, remove, addExtraLine, removeExtraLine, reset }),
    [cart, add, changeQty, remove, addExtraLine, removeExtraLine, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
