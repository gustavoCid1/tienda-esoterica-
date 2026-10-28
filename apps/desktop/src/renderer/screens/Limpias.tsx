/**
 * Limpias (v2): servicio en el que se arma una lista de artículos (por ejemplo veladoras) con cantidades y un cargo
 * opcional por el servicio. Se registra como venta de tipo 'limpia' con su ticket, su pago y el inventario descontado,
 * con las mismas reglas de existencias que una venta normal.
 *  - GERENTE: entra libremente.
 *  - VENDEDOR: SOLO entra con la contraseña de un administrador o un token con propósito 'limpias'; esa autorización
 *    queda guardada en la venta (el proceso principal la exige otra vez al cobrar).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogHit } from '@amara/database';
import { can, newId } from '@amara/shared';
import type { SellerRow, SensitiveAuth } from '../../shared/ipc.ts';
import { AuthPrompt } from '../components/AuthPrompt.tsx';
import { DocPreviewModal } from '../components/DocPreviewModal.tsx';
import { Banner, Field } from '../components/Field.tsx';
import { SellerPickModal } from '../components/SellerPickModal.tsx';
import { PaymentModal } from '../components/SaleModals.tsx';
import type { PaidResult } from '../components/SaleModals.tsx';
import { call, errorText } from '../lib/api.ts';
import { addProduct, maxQty, removeLine, setQty, stockView, subtotalOf, withServiceCharge } from '../lib/cart.ts';
import type { CartLine } from '../lib/cart.ts';
import { money, parsePesos } from '../lib/format.ts';
import { beepError, beepOk } from '../lib/sound.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

export function LimpiasScreen() {
  const { user } = useApp();
  const manager = !!user && can(user.role, 'caja.corte');
  const [ticket, setTicket] = useState<string | null>(null); // boleto de autorización (solo vendedor)
  const [lines, setLines] = useState<CartLine[]>([]);

  if (!manager && !ticket) return <Gate onAuthorized={setTicket} />;
  return <Builder lines={lines} setLines={setLines} ticket={manager ? undefined : (ticket ?? undefined)} onReauthorize={() => setTicket(null)} />;
}

function Gate({ onAuthorized }: { onAuthorized: (ticket: string) => void }) {
  const { toast } = useFeedback();
  const [auth, setAuth] = useState<SensitiveAuth | null>(null);
  useScanHandler(() => toast('info', 'Primero autoriza la entrada a Limpias.'));
  return (
    <div className="page">
      <h1>Limpias</h1>
      <div className="card stack">
        <h3>Se necesita autorización</h3>
        <p className="muted">Las Limpias solo las registra el gerente. Para continuar, un administrador debe escribir su contraseña o puedes usar un token de seguridad para Limpias.</p>
        <AuthPrompt purpose="limpias" onChange={setAuth} />
        <div className="row-gap">
          <button className="btn btn-gold btn-lg" disabled={!auth?.ticket} onClick={() => auth?.ticket && onAuthorized(auth.ticket)}>Entrar a Limpias</button>
        </div>
      </div>
    </div>
  );
}

function Builder({
  lines, setLines, ticket, onReauthorize,
}: {
  lines: CartLine[]; setLines: (l: CartLine[]) => void; ticket?: string; onReauthorize: () => void;
}) {
  const { toast } = useFeedback();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [serviceText, setServiceText] = useState('');
  const [pickSeller, setPickSeller] = useState(false);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const serviceId = useRef(newId());

  const add = useCallback(
    (hit: CatalogHit) => {
      const r = addProduct(linesRef.current, hit);
      if (!r.ok) {
        beepError();
        setError(r.message);
        return;
      }
      beepOk();
      setError(null);
      linesRef.current = r.lines;
      setLines(r.lines);
    },
    [setLines],
  );

  useScanHandler((code) => {
    call('catalog:lookup', { code })
      .then((hits) => {
        if (hits.length === 0) {
          beepError();
          setError(`Código no encontrado: ${code}`);
        } else add(hits[0]!);
      })
      .catch((e) => setError(errorText(e)));
  });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults([]);
    const t = window.setTimeout(() => call('catalog:search', { text: q }).then(setResults).catch(() => setResults([])), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const service = parsePesos(serviceText);
  const serviceOk = service === null || (!Number.isNaN(service) && service >= 0);
  const serviceCents = service === null || Number.isNaN(service) ? 0 : service;
  const articles = subtotalOf(lines);
  const total = articles + serviceCents;
  const canCharge = lines.length > 0 && serviceOk && total > 0;

  // El cargo por el servicio es una línea 'extra' ligada al primer artículo (no mueve inventario).
  const finalLines = withServiceCharge(lines, serviceCents, serviceId.current);

  const onPaid = (r: PaidResult) => {
    setSeller(null);
    setLines([]);
    setServiceText('');
    serviceId.current = newId();
    if (r.duplicate) toast('info', `Esa limpia ya estaba guardada (folio ${r.sale.folio}). No se duplicó.`);
    else setPreviewId(r.sale.id);
  };

  return (
    <div className="page">
      <div className="row-between">
        <h1>Limpias</h1>
        {ticket && <button className="btn btn-quiet" onClick={onReauthorize}>Volver a pedir autorización</button>}
      </div>
      <p className="muted">Arma la limpia con los artículos que se usan (por ejemplo veladoras), agrega el cargo del servicio si lo hay y cobra. Se guarda como Limpia, con su ticket y el inventario descontado.</p>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}

      <div className="searchbox">
        <input className="inp inp-lg" placeholder="Busca un artículo o escanéalo para agregarlo" value={query} onChange={(e) => setQuery(e.target.value)} />
        {results.length > 0 && (
          <div className="results">
            {results.map((h) => (
              <button key={h.variantId} className="result" onClick={() => { add(h); setQuery(''); setResults([]); }}>
                <span><strong>{h.productName}</strong> - {h.label}</span>
                <span className={stockView(h.qty).soldOut ? 'neg' : 'muted'}>{money(h.priceCents)} - {stockView(h.qty).text}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Artículos de la limpia</h3>
        {lines.length === 0 ? (
          <p className="muted">Todavía no hay artículos.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Artículo</th><th className="num">Precio</th><th className="center">Cantidad</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td><div className="cell-main">{l.productName}</div><div className="muted small">{l.label}</div>{l.qty >= maxQty(l) && <div className="warn-text small">Es todo lo que hay en existencia ({maxQty(l)}).</div>}</td>
                  <td className="num">{money(l.unitPriceCents)}</td>
                  <td className="center">
                    <div className="qty">
                      <button className="btn btn-sm" onClick={() => setLines(setQty(lines, l.key, l.qty - 1))} disabled={l.qty <= 1} aria-label="Quitar uno">-</button>
                      <span className="qty-n">{l.qty}</span>
                      <button className="btn btn-sm" onClick={() => setLines(setQty(lines, l.key, l.qty + 1))} disabled={l.qty >= maxQty(l)} aria-label="Agregar uno">+</button>
                    </div>
                  </td>
                  <td className="num strong">{money(l.qty * l.unitPriceCents)}</td>
                  <td className="num"><button className="btn btn-quiet btn-sm" onClick={() => setLines(removeLine(lines, l.key))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid2">
          <Field label="Cargo por el servicio ($, opcional)" error={!serviceOk ? 'Escribe un importe válido' : null} hint="Se cobra aparte de los artículos">
            <input className="inp" inputMode="decimal" value={serviceText} onChange={(e) => setServiceText(e.target.value)} placeholder="0.00" disabled={lines.length === 0} />
          </Field>
          <div className="totals-inline">
            <div className="row-between"><span>Artículos</span><span>{money(articles)}</span></div>
            <div className="row-between"><span>Servicio</span><span>{money(serviceCents)}</span></div>
            <div className="total-big"><span>TOTAL</span><strong>{money(total)}</strong></div>
          </div>
        </div>
        <div className="row-gap">
          <button className="btn btn-gold btn-xl" disabled={!canCharge || !finalLines} onClick={() => setPickSeller(true)}>Cobrar limpia</button>
          <button className="btn" disabled={lines.length === 0} onClick={() => { setLines([]); setServiceText(''); }}>Vaciar</button>
        </div>
      </div>

      {pickSeller && <SellerPickModal onClose={() => setPickSeller(false)} onPick={(s) => { setPickSeller(false); setSeller(s); }} />}
      {seller && finalLines && (
        <PaymentModal totalCents={total} discountCents={0} lines={finalLines} seller={seller} saleType="limpia" ticket={ticket} onClose={() => setSeller(null)} onPaid={onPaid} />
      )}
      {previewId && (
        <DocPreviewModal doc={{ kind: 'ticket', saleId: previewId }} title="Ticket de la limpia" intro="Limpia guardada. Revisa el ticket y pulsa Imprimir." onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}
