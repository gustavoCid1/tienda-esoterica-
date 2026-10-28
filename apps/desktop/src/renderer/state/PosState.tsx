/**
 * Estado de la venta en curso (carrito, descuento, modo VENTA/INVENTARIO y última venta).
 * Vive fuera de la pantalla para no perderse al cambiar de pestaña. Se vacía al cerrar sesión.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CatalogHit } from '@amara/database';
import { newId } from '@amara/shared';
import type { Sale } from '@amara/shared';
import * as cart from '../lib/cart.ts';
import type { AddResult, CartLine, ExtraResult } from '../lib/cart.ts';

export type { CartLine } from '../lib/cart.ts';

export type PosMode = 'venta' | 'inventario';

/** Última venta guardada. El ticket se ve e imprime en el modal de vista previa (no hay impresión oculta). */
export interface LastSale {
  sale: Sale;
  warnings: string[];
}

interface PosApi {
  mode: PosMode;
  setMode: (m: PosMode) => void;
  lines: CartLine[];
  discountCents: number;
  setDiscountCents: (c: number) => void;
  subtotalCents: number;
  totalCents: number;
  /** Agrega una pieza. Si no hay existencia (o ya se agregó todo) NO agrega y explica por qué. */
  addHit: (h: CatalogHit) => AddResult;
  /** Agrega una línea Extra ligada a un producto del carrito. */
  addExtra: (parentKey: string, amountCents: number, note: string) => ExtraResult;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clearCart: () => void;
  lastSale: LastSale | null;
  setLastSale: (l: LastSale | null) => void;
  /** Etiquetas que se mandan desde Inventario a la pantalla de etiquetas. */
  labelQueue: CatalogHit[];
  setLabelQueue: (h: CatalogHit[]) => void;
}

const Ctx = createContext<PosApi | null>(null);

export function usePos(): PosApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('PosProvider ausente');
  return v;
}

export function PosProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PosMode>('venta');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discountCents, setDiscount] = useState(0);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [labelQueue, setLabelQueue] = useState<CatalogHit[]>([]);

  const subtotalCents = useMemo(() => cart.subtotalOf(lines), [lines]);
  const safeDiscount = Math.min(discountCents, subtotalCents);
  const totalCents = subtotalCents - safeDiscount;

  // El carrito se calcula sobre la lista más reciente (ref) para que dos lecturas seguidas del escáner nunca pisen la existencia.
  const linesRef = useRef<CartLine[]>([]);
  linesRef.current = lines;

  const addHit = useCallback((h: CatalogHit): AddResult => {
    const r = cart.addProduct(linesRef.current, h);
    if (r.ok) {
      linesRef.current = r.lines;
      setLines(r.lines);
    }
    return r;
  }, []);

  const addExtra = useCallback((parentKey: string, amountCents: number, note: string): ExtraResult => {
    const r = cart.addExtra(linesRef.current, parentKey, amountCents, note, newId());
    if (r.ok) {
      linesRef.current = r.lines;
      setLines(r.lines);
    }
    return r;
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setLines((prev) => {
      const next = cart.setQty(prev, key, qty);
      linesRef.current = next;
      return next;
    });
  }, []);
  const remove = useCallback((key: string) => {
    setLines((prev) => {
      const next = cart.removeLine(prev, key);
      linesRef.current = next;
      return next;
    });
  }, []);
  const clearCart = useCallback(() => {
    linesRef.current = [];
    setLines([]);
    setDiscount(0);
  }, []);

  const value = useMemo<PosApi>(
    () => ({
      mode, setMode, lines, discountCents: safeDiscount, setDiscountCents: setDiscount, subtotalCents, totalCents,
      addHit, addExtra, setQty, remove, clearCart, lastSale, setLastSale,
      labelQueue, setLabelQueue,
    }),
    [mode, lines, safeDiscount, subtotalCents, totalCents, addHit, addExtra, setQty, remove, clearCart, lastSale, labelQueue],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
