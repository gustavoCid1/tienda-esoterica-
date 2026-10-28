/**
 * Punto de venta. Dos modos VISIBLES en todo momento:
 *  - VENTA: cada lectura agrega el producto al carrito.
 *  - INVENTARIO: cada lectura abre la ventana de movimiento (cantidad, sucursal, lugar, variante,
 *    motivo) o el alta si el código no existe. NUNCA vende.
 * El escáner (USB o teléfono) funciona con la ventana en cualquier parte: no hay que enfocar un campo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogHit } from '@amara/database';
import { DEFAULT_EXTRA_CATEGORIES, can, isExtraCategory } from '@amara/shared';
import type { BranchRow, CashStatus, SellerRow } from '../../shared/ipc.ts';
import { DocPreviewModal } from '../components/DocPreviewModal.tsx';
import { ExtraModal } from '../components/ExtraModal.tsx';
import { Banner } from '../components/Field.tsx';
import { MovementModal, NewProductModal } from '../components/InventoryModals.tsx';
import type { InvPerms } from '../components/InventoryModals.tsx';
import { SellerPickModal } from '../components/SellerPickModal.tsx';
import { DiscountModal, PaymentModal, VariantChoiceModal } from '../components/SaleModals.tsx';
import type { PaidResult } from '../components/SaleModals.tsx';
import { call, errorText } from '../lib/api.ts';
import { lineTitle, maxQty, stockView } from '../lib/cart.ts';
import { dateTime, money } from '../lib/format.ts';
import { beepError, beepOk } from '../lib/sound.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { usePos } from '../state/PosState.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

interface Flash {
  kind: 'ok' | 'error' | 'warn';
  text: string;
}

export function PosScreen() {
  const { user, settings } = useApp();
  const pos = usePos();
  const { toast, confirm } = useFeedback();

  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [unknown, setUnknown] = useState<{ code: string; at: string }[]>([]);
  const [choices, setChoices] = useState<CatalogHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [pickSeller, setPickSeller] = useState(false);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [extraCategories, setExtraCategories] = useState<string[]>([...DEFAULT_EXTRA_CATEGORIES]);
  const [extraFor, setExtraFor] = useState<string | null>(null);
  const [previewSaleId, setPreviewSaleId] = useState<{ id: string; auto: boolean; fresh: boolean } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [cash, setCash] = useState<CashStatus | null>(null);
  const [perms, setPerms] = useState<InvPerms | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState('');
  const [movement, setMovement] = useState<CatalogHit | null>(null);
  const [newProduct, setNewProduct] = useState<string | null>(null);

  const canDiscount = !!user && can(user.role, 'ventas.descuento');

  const showFlash = useCallback((f: Flash) => {
    setFlash(f);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 8000);
  }, []);

  const loadCash = useCallback(() => {
    call('cash:status').then(setCash).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadCash();
    call('inventory:permissions').then(setPerms).catch(() => undefined);
    call('extras:get').then((r) => setExtraCategories(r.categories)).catch(() => undefined);
    Promise.all([call('catalog:branches'), call('device:get')])
      .then(([b, d]) => {
        setBranches(b);
        setDefaultBranchId(d.branch?.id ?? b[0]?.id ?? '');
      })
      .catch(() => undefined);
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [loadCash]);

  // ───────────── Lecturas del escáner ─────────────
  const openInventoryFor = useCallback(
    (hit: CatalogHit) => {
      setMovement(hit);
    },
    [],
  );

  /** Agrega al carrito SOLO si hay existencia; si no, lo dice claro (nunca se vende en 0 ni de más). */
  const addToCart = useCallback(
    (hit: CatalogHit) => {
      const r = pos.addHit(hit);
      if (!r.ok) {
        beepError();
        showFlash({ kind: 'error', text: r.message });
        return;
      }
      const sv = stockView(hit.qty);
      showFlash(sv.inherited ? { kind: 'warn', text: `${hit.productName} - ${hit.label} agregado. ${sv.notice}` } : { kind: 'ok', text: `${hit.productName} - ${hit.label} agregado.` });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos.addHit, showFlash],
  );

  const handleCode = useCallback(
    async (code: string) => {
      let hits: CatalogHit[];
      try {
        hits = await call('catalog:lookup', { code });
      } catch (e) {
        beepError();
        showFlash({ kind: 'error', text: errorText(e) });
        return;
      }
      if (hits.length === 0) {
        beepError();
        setUnknown((u) => [{ code, at: new Date().toISOString() }, ...u].slice(0, 10));
        if (pos.mode === 'inventario' && perms?.canCreateProduct) {
          showFlash({ kind: 'warn', text: `El código ${code} no existe. Completa los datos para darlo de alta.` });
          setNewProduct(code);
        } else if (pos.mode === 'inventario') {
          showFlash({ kind: 'error', text: `El código ${code} no existe en el catálogo. Avisa al gerente para que lo dé de alta.` });
        } else {
          showFlash({ kind: 'error', text: `Código no encontrado: ${code}. No se agregó nada a la venta.` });
        }
        return;
      }
      if (hits.length > 1) {
        beepOk();
        setChoices(hits);
        return;
      }
      const hit = hits[0]!;
      beepOk();
      if (pos.mode === 'inventario') return openInventoryFor(hit);
      addToCart(hit);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos.mode, addToCart, perms, showFlash, openInventoryFor],
  );

  useScanHandler((code) => void handleCode(code));

  // ───────────── Búsqueda manual ─────────────
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      call('catalog:search', { text: q }).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const pickResult = (h: CatalogHit) => {
    setQuery('');
    setResults([]);
    if (pos.mode === 'inventario') openInventoryFor(h);
    else addToCart(h);
  };

  // ───────────── Cobro ─────────────
  const onPaid = (r: PaidResult) => {
    setPayOpen(false);
    setSeller(null);
    pos.clearCart();
    loadCash();
    pos.setLastSale({ sale: r.sale, warnings: r.warnings });
    if (r.duplicate) {
      toast('info', `Esa venta ya estaba guardada (folio ${r.sale.folio}). No se duplicó.`);
      return;
    }
    // La venta YA está guardada en SQLite. Se abre la vista previa del ticket; imprimir (o reimprimir) nunca crea otra venta.
    setPreviewSaleId({ id: r.sale.id, auto: settings?.autoPrint === true, fresh: true });
  };

  const clearCart = async () => {
    if (pos.lines.length === 0) return;
    const ok = await confirm({ title: 'Vaciar la venta', message: 'Se quitarán todos los productos del carrito.', confirmText: 'Vaciar', danger: true });
    if (ok) pos.clearCart();
  };

  const last = pos.lastSale;
  const inventoryMode = pos.mode === 'inventario';

  return (
    <div className="pos">
      <div className={inventoryMode ? 'modebar modebar-inv' : 'modebar'}>
        <div className="segmented segmented-lg" role="tablist" aria-label="Modo">
          <button className={!inventoryMode ? 'seg seg-on' : 'seg'} onClick={() => pos.setMode('venta')} role="tab" aria-selected={!inventoryMode}>VENTA</button>
          <button className={inventoryMode ? 'seg seg-on' : 'seg'} onClick={() => pos.setMode('inventario')} role="tab" aria-selected={inventoryMode}>INVENTARIO</button>
        </div>
        <div className="modebar-text">
          {inventoryMode
            ? 'MODO INVENTARIO: lo que escanees NO se vende. Se abrirá el movimiento de inventario.'
            : 'MODO VENTA: lo que escanees se agrega al carrito.'}
        </div>
      </div>

      {cash && !cash.open && <Banner kind="warn">La caja está cerrada. Para vender, un gerente debe abrir la caja en la pestaña Caja.</Banner>}
      {flash && <Banner kind={flash.kind} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      <div className="pos-grid">
        <section className="pos-left">
          <div className="searchbox">
            <input className="inp inp-lg" placeholder="Buscar por nombre, código o categoría (el escáner funciona sin hacer clic aquí)" value={query} onChange={(e) => setQuery(e.target.value)} />
            {results.length > 0 && (
              <div className="results">
                {results.map((h) => (
                  <button key={h.variantId} className="result" onClick={() => pickResult(h)}>
                    <span><strong>{h.productName}</strong> - {h.label}</span>
                    <span className={stockView(h.qty).soldOut && !inventoryMode ? 'neg' : 'muted'}>
                      {money(h.priceCents)} - {stockView(h.qty).text}{stockView(h.qty).inherited ? ' (por corregir)' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {inventoryMode ? (
            <div className="empty">
              <h3>Modo inventario</h3>
              <p>Escanea un producto para registrar una entrada, salida, ajuste o conteo. Si el código no existe podrás darlo de alta.</p>
              {perms && !perms.canEnter && !perms.canMove && <p className="muted">Tu usuario solo puede consultar existencias.</p>}
            </div>
          ) : (
            <div className="cart">
              {pos.lines.length === 0 ? (
                <div className="empty">
                  <h3>Venta nueva</h3>
                  <p>Escanea un producto o búscalo por nombre para empezar.</p>
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Producto</th><th className="num">Precio</th><th className="center">Cantidad</th><th className="num">Importe</th><th /></tr>
                  </thead>
                  <tbody>
                    {pos.lines.map((l) =>
                      l.kind === 'extra' ? (
                        <tr key={l.key} className="line-extra">
                          <td>
                            <div className="cell-main"><span className="chip chip-info">Extra</span> {lineTitle(l)}</div>
                            <div className="muted small">sobre {l.productName} - {l.label}</div>
                          </td>
                          <td className="num">{money(l.unitPriceCents)}</td>
                          <td className="center muted">1</td>
                          <td className="num strong">{money(l.unitPriceCents)}</td>
                          <td className="num"><button className="btn btn-quiet btn-sm" onClick={() => pos.remove(l.key)}>Quitar</button></td>
                        </tr>
                      ) : (
                        <tr key={l.key}>
                          <td>
                            <div className="cell-main">{l.productName}</div>
                            <div className="muted small">{l.label} - {l.code}</div>
                            {l.qty >= maxQty(l) && <div className="warn-text small">Es todo lo que hay en existencia ({maxQty(l)}).</div>}
                          </td>
                          <td className="num">{money(l.unitPriceCents)}</td>
                          <td className="center">
                            <div className="qty">
                              <button className="btn btn-sm" onClick={() => pos.setQty(l.key, l.qty - 1)} disabled={l.qty <= 1} aria-label="Quitar uno">-</button>
                              <span className="qty-n">{l.qty}</span>
                              <button className="btn btn-sm" onClick={() => pos.setQty(l.key, l.qty + 1)} disabled={l.qty >= maxQty(l)} aria-label="Agregar uno">+</button>
                            </div>
                          </td>
                          <td className="num strong">{money(l.qty * l.unitPriceCents)}</td>
                          <td className="num">
                            <div className="row-gap row-end">
                              {isExtraCategory(l.category, extraCategories) && <button className="btn btn-sm" onClick={() => setExtraFor(l.key)}>Extra</button>}
                              <button className="btn btn-quiet btn-sm" onClick={() => pos.remove(l.key)}>Quitar</button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {unknown.length > 0 && (
            <div className="unknown">
              <div className="row-between">
                <strong>Códigos no reconocidos en esta sesión ({unknown.length})</strong>
                <button className="btn btn-quiet btn-sm" onClick={() => setUnknown([])}>Limpiar</button>
              </div>
              <div className="muted small mono">{unknown.map((u) => u.code).join('   ')}</div>
            </div>
          )}
        </section>

        <aside className="pos-right">
          <div className="card totals">
            <div className="row-between"><span>Subtotal</span><span>{money(pos.subtotalCents)}</span></div>
            {pos.discountCents > 0 && <div className="row-between"><span>Descuento</span><span>-{money(pos.discountCents)}</span></div>}
            <div className="total-big"><span>TOTAL</span><strong>{money(pos.totalCents)}</strong></div>
            <button className="btn btn-gold btn-xl btn-block" disabled={inventoryMode || pos.lines.length === 0} onClick={() => setPickSeller(true)}>
              Cobrar
            </button>
            <div className="row-gap">
              {canDiscount && <button className="btn" disabled={inventoryMode || pos.lines.length === 0} onClick={() => setDiscountOpen(true)}>Descuento</button>}
              <button className="btn" disabled={pos.lines.length === 0} onClick={() => void clearCart()}>Vaciar</button>
            </div>
            {!canDiscount && <div className="muted small">Los descuentos los autoriza el gerente.</div>}
          </div>

          {last && (
            <div className="card lastsale">
              <div className="row-between">
                <strong>Última venta guardada</strong>
                <button className="btn btn-quiet btn-sm" onClick={() => pos.setLastSale(null)}>Ocultar</button>
              </div>
              <div className="mono">{last.sale.folio}</div>
              <div className="muted small">{dateTime(last.sale.createdAt)}</div>
              <div className="row-between"><span>Total</span><strong>{money(last.sale.totalCents)}</strong></div>
              {last.sale.changeCents > 0 && (
                <div className="change change-sm"><span>Cambio entregado</span><strong>{money(last.sale.changeCents)}</strong></div>
              )}
              {last.warnings.map((w) => <div key={w} className="warn-text small">{w}</div>)}
              <div className="row-gap">
                <button className="btn btn-gold" onClick={() => setPreviewSaleId({ id: last.sale.id, auto: false, fresh: false })}>Ver ticket / Imprimir</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {pickSeller && (
        <SellerPickModal
          onClose={() => setPickSeller(false)}
          onPick={(sel) => {
            setPickSeller(false);
            setSeller(sel);
            setPayOpen(true);
          }}
        />
      )}
      {payOpen && seller && (
        <PaymentModal
          totalCents={pos.totalCents}
          discountCents={pos.discountCents}
          lines={pos.lines}
          seller={seller}
          onClose={() => { setPayOpen(false); setSeller(null); }}
          onPaid={onPaid}
        />
      )}
      {extraFor && (
        <ExtraModal
          productName={pos.lines.find((l) => l.key === extraFor)?.productName ?? ''}
          onClose={() => setExtraFor(null)}
          onAdd={(cents, note) => {
            const r = pos.addExtra(extraFor, cents, note);
            if (!r.ok) return r.message;
            setExtraFor(null);
            return null;
          }}
        />
      )}
      {previewSaleId && (
        <DocPreviewModal
          doc={{ kind: 'ticket', saleId: previewSaleId.id }}
          title="Ticket de la venta"
          autoPrint={previewSaleId.auto}
          intro={previewSaleId.fresh ? 'Venta guardada. Revisa el ticket y pulsa Imprimir.' : undefined}
          onClose={() => setPreviewSaleId(null)}
        />
      )}
      {discountOpen && (
        <DiscountModal
          subtotalCents={pos.subtotalCents}
          currentCents={pos.discountCents}
          onClose={() => setDiscountOpen(false)}
          onApply={(c) => { pos.setDiscountCents(c); setDiscountOpen(false); }}
        />
      )}
      {choices && (
        <VariantChoiceModal
          hits={choices}
          onClose={() => setChoices(null)}
          onPick={(h) => {
            setChoices(null);
            if (pos.mode === 'inventario') openInventoryFor(h);
            else addToCart(h);
          }}
        />
      )}
      {movement && perms && (
        <MovementModal
          initial={movement}
          perms={perms}
          branches={branches}
          defaultBranchId={defaultBranchId}
          onClose={() => setMovement(null)}
          onDone={() => setMovement(null)}
        />
      )}
      {newProduct !== null && (
        <NewProductModal
          initialCode={newProduct}
          branches={branches}
          defaultBranchId={defaultBranchId}
          onClose={() => setNewProduct(null)}
          onCreated={() => setNewProduct(null)}
        />
      )}
    </div>
  );
}
