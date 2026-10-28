/**
 * Estado de la venta en curso (carrito, descuento, modo VENTA/INVENTARIO y última venta).
 * Vive fuera de la pantalla para no perderse al cambiar de pestaña. Se vacía al cerrar sesión.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CatalogHit } from '@amara/database';
import type { Sale } from '@amara/shared';
import type { PrintResult } from '../../shared/ipc.ts';

export interface CartLine {
  variantId: string;
  productName: string;
  label: string;
  code: string;
  unitPriceCents: number;
  qty: number;
  /** Existencia local al agregar (para avisar si no hay). */
  stockQty: number;
}

export type PosMode = 'venta' | 'inventario';

export interface LastSale {
  sale: Sale;
  warnings: string[];
  /** null = aún no se intenta imprimir. */
  print: 'imprimiendo' | 'ok' | 'error' | 'omitida';
  printResult: PrintResult | null;
}

interface PosApi {
  mode: PosMode;
  setMode: (m: PosMode) => void;
  lines: CartLine[];
  discountCents: number;
  setDiscountCents: (c: number) => void;
  subtotalCents: number;
  totalCents: number;
  addHit: (h: CatalogHit) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clearCart: () => void;
  lastSale: LastSale | null;
  setLastSale: (l: LastSale | null) => void;
  /** Actualiza la última venta SOLO si sigue siendo la misma (evita pisar una venta más nueva). */
  patchLastSale: (saleId: string, p: Partial<LastSale>) => void;
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

  const subtotalCents = useMemo(() => lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0), [lines]);
  const safeDiscount = Math.min(discountCents, subtotalCents);
  const totalCents = subtotalCents - safeDiscount;

  const addHit = useCallback((h: CatalogHit) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === h.variantId);
      if (i >= 0) return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...prev,
        { variantId: h.variantId, productName: h.productName, label: h.label, code: h.barcode ?? h.internalCode, unitPriceCents: h.priceCents, qty: 1, stockQty: h.qty },
      ];
    });
  }, []);

  const setQty = useCallback((variantId: string, qty: number) => {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, qty: Math.max(1, Math.min(9999, Math.floor(qty) || 1)) } : l)));
  }, []);
  const remove = useCallback((variantId: string) => setLines((prev) => prev.filter((l) => l.variantId !== variantId)), []);
  const clearCart = useCallback(() => {
    setLines([]);
    setDiscount(0);
  }, []);

  const value = useMemo<PosApi>(
    () => ({
      mode, setMode, lines, discountCents: safeDiscount, setDiscountCents: setDiscount, subtotalCents, totalCents,
      addHit, setQty, remove, clearCart, lastSale, setLastSale,
      patchLastSale: (saleId, p) => setLastSale((cur) => (cur && cur.sale.id === saleId ? { ...cur, ...p } : cur)),
      labelQueue, setLabelQueue,
    }),
    [mode, lines, safeDiscount, subtotalCents, totalCents, addHit, setQty, remove, clearCart, lastSale, labelQueue],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
