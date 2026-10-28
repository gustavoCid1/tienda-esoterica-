/**
 * Carrito de la venta de emergencia. Se guarda un BORRADOR en la base local (meta) para que un cierre
 * inesperado de la app no pierda el carrito; el saleId del borrador se conserva, así que reintentar el
 * cobro nunca duplica la venta (registerSale es idempotente por saleId).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogHit } from '@amara/database';
import { addToCart, cartTotalCents, cartUnits, newCart, parseDraft, removeLine, setQty, toDraft } from '../lib/cart';
import type { Cart } from '../lib/cart';
import { useApp } from './AppContext';

interface CartValue {
  cart: Cart;
  totalCents: number;
  units: number;
  add: (hit: Pick<CatalogHit, 'variantId' | 'productName' | 'label' | 'priceCents'>, qty?: number) => void;
  changeQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
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
  const [cart, setCart] = useState<Cart>(() => newCart());
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
        if (hit) restored = addToCart(restored, hit, l.qty);
      }
      if (!cancelled) setCart(restored);
    })().catch(() => {
      if (!cancelled) setCart(newCart());
    });
    return () => {
      cancelled = true;
    };
  }, [phase, store, userId, branchId]);

  // Al cerrar sesión se olvida el carrito en memoria (el borrador queda guardado para ese usuario).
  useEffect(() => {
    if (!session) {
      loadedFor.current = null;
      setCart(newCart());
    }
  }, [session]);

  // Guardado del borrador (con pequeño retraso para no escribir en cada toque).
  useEffect(() => {
    if (phase !== 'listo' || !store || !userId || loadedFor.current !== userId) return;
    const t = setTimeout(() => {
      store.setMeta(draftKey(userId), JSON.stringify(toDraft(cart))).catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [cart, phase, store, userId]);

  const add = useCallback<CartValue['add']>((hit, qty = 1) => {
    setCart((c) => addToCart(c, { variantId: hit.variantId, productName: hit.productName, label: hit.label, priceCents: hit.priceCents }, qty));
  }, []);
  const changeQty = useCallback((variantId: string, qty: number) => setCart((c) => setQty(c, variantId, qty)), []);
  const remove = useCallback((variantId: string) => setCart((c) => removeLine(c, variantId)), []);
  const reset = useCallback(() => setCart(newCart()), []);

  const value = useMemo<CartValue>(
    () => ({ cart, totalCents: cartTotalCents(cart), units: cartUnits(cart), add, changeQty, remove, reset }),
    [cart, add, changeQty, remove, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
