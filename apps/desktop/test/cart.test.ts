import { describe, expect, it } from 'vitest';
import { addExtra, addProduct, lineTitle, maxQty, pieceCount, removeLine, setQty, stockView, subtotalOf, toSaleItems, withServiceCharge } from '../src/renderer/lib/cart.ts';
import type { CartLine } from '../src/renderer/lib/cart.ts';

const hit = (over: Partial<Parameters<typeof addProduct>[1]> = {}) => ({
  variantId: 'v1', productName: 'Veladora', label: 'Blanca', barcode: null, internalCode: 'AMA1', category: 'Veladoras', priceCents: 5000, qty: 3, ...over,
});

describe('existencias en el carrito', () => {
  it('nunca muestra negativos: un saldo heredado de -2 se ve como 0 con aviso', () => {
    const v = stockView(-2);
    expect(v.shown).toBe(0);
    expect(v.soldOut).toBe(true);
    expect(v.inherited).toBe(true);
    expect(v.text).toBe('Sin existencia');
    expect(v.notice).toMatch(/por corregir/);
    expect(stockView(0).inherited).toBe(false);
    expect(stockView(5)).toMatchObject({ shown: 5, soldOut: false, text: 'Existencia 5', notice: null });
  });

  it('no se vende en 0 ni con saldo negativo heredado', () => {
    for (const qty of [0, -2]) {
      const r = addProduct([], hit({ qty }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('sin_existencia');
        expect(r.message).toMatch(/Sin existencia/);
      }
    }
  });

  it('no se agrega más de lo disponible', () => {
    let lines: CartLine[] = [];
    for (let i = 0; i < 3; i++) {
      const r = addProduct(lines, hit({ qty: 3 }));
      expect(r.ok).toBe(true);
      if (r.ok) lines = r.lines;
    }
    expect(lines[0]!.qty).toBe(3);
    const over = addProduct(lines, hit({ qty: 3 }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe('tope');
    expect(maxQty(lines[0]!)).toBe(3);
  });

  it('la cantidad se limita a la existencia con setQty', () => {
    const r = addProduct([], hit({ qty: 4 }));
    if (!r.ok) throw new Error('debía agregar');
    expect(setQty(r.lines, 'p:v1', 99)[0]!.qty).toBe(4);
    expect(setQty(r.lines, 'p:v1', 0)[0]!.qty).toBe(1);
    expect(setQty(r.lines, 'p:v1', -3)[0]!.qty).toBe(1);
  });
});

describe('línea Extra', () => {
  const base = () => {
    const r = addProduct([], hit({ qty: 5 }));
    if (!r.ok) throw new Error('debía agregar');
    return r.lines;
  };

  it('agrega un extra de 1 pieza, sin inventario, justo después de su producto', () => {
    const r = addExtra(base(), 'p:v1', 2500, '  bordado   a mano ', 'abc');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const extra = r.lines[1]!;
    expect(extra).toMatchObject({ kind: 'extra', qty: 1, unitPriceCents: 2500, extraNote: 'bordado a mano', parentKey: 'p:v1', variantId: 'v1' });
    expect(lineTitle(extra)).toBe('Extra: bordado a mano');
    expect(maxQty(extra)).toBe(1);
    expect(subtotalOf(r.lines)).toBe(5000 + 2500);
    expect(pieceCount(r.lines)).toBe(1); // el extra es ingreso, no pieza
    // No cambia de cantidad
    expect(setQty(r.lines, 'x:abc', 9)[1]!.qty).toBe(1);
  });

  it('valida monto y nota', () => {
    expect(addExtra(base(), 'p:v1', -1, 'nota', 'a').ok).toBe(false);
    expect(addExtra(base(), 'p:v1', 10.5, 'nota', 'a').ok).toBe(false);
    expect(addExtra(base(), 'p:v1', 100, ' ', 'a').ok).toBe(false);
    expect(addExtra(base(), 'p:v1', 100, 'x'.repeat(200), 'a').ok).toBe(false);
    expect(addExtra(base(), 'p:nope', 100, 'nota', 'a').ok).toBe(false);
    expect(addExtra(base(), 'p:v1', 0, 'cortesía', 'a').ok).toBe(true); // 0 es válido (precio ≥ 0)
  });

  it('al quitar el producto se quitan sus extras; los extras al final del producto se agrupan', () => {
    let lines = base();
    const a = addExtra(lines, 'p:v1', 100, 'uno', 'a');
    if (!a.ok) throw new Error();
    const b = addExtra(a.lines, 'p:v1', 200, 'dos', 'b');
    if (!b.ok) throw new Error();
    expect(b.lines.map((l) => l.key)).toEqual(['p:v1', 'x:a', 'x:b']);
    expect(removeLine(b.lines, 'x:a').map((l) => l.key)).toEqual(['p:v1', 'x:b']);
    expect(removeLine(b.lines, 'p:v1')).toEqual([]);
    lines = b.lines;
    expect(toSaleItems(lines)).toEqual([
      { variantId: 'v1', qty: 1 },
      { variantId: 'v1', qty: 1, kind: 'extra', unitPriceCents: 100, extraNote: 'uno' },
      { variantId: 'v1', qty: 1, kind: 'extra', unitPriceCents: 200, extraNote: 'dos' },
    ]);
  });
});

describe('Limpia: cargo por el servicio', () => {
  it('se liga como extra al primer artículo; sin artículos no hay limpia; sin cargo no agrega nada', () => {
    const r = addProduct([], hit({ qty: 5 }));
    if (!r.ok) throw new Error();
    const withFee = withServiceCharge(r.lines, 15000, 'svc');
    expect(withFee).not.toBeNull();
    expect(withFee![1]).toMatchObject({ kind: 'extra', extraNote: 'Servicio de limpia', unitPriceCents: 15000 });
    expect(withServiceCharge(r.lines, 0, 'svc')).toEqual(r.lines);
    expect(withServiceCharge([], 15000, 'svc')).toBeNull();
  });
});
