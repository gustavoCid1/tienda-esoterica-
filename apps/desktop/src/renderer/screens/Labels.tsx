/**
 * Etiquetas: Code128 (código interno) + QR (buildQrValue). Se arma un lote, se ve la vista previa
 * a tamaño real, se imprime en la impresora de etiquetas y queda en el historial para reimprimir.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogHit } from '@amara/database';
import type { LabelBatch, LabelItem } from '../../shared/ipc.ts';
import { buildLabelSheetHtml, labelInnerHtml, labelRules } from '../../shared/label-html.ts';
import type { LabelRender } from '../../shared/label-html.ts';
import { Banner, Field } from '../components/Field.tsx';
import { call, errorText } from '../lib/api.ts';
import { dateTime, money } from '../lib/format.ts';
import { expandLabels, makeLabel } from '../lib/labels.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { usePos } from '../state/PosState.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

const toItem = (h: CatalogHit): LabelItem => ({ variantId: h.variantId, code: h.internalCode, productName: h.productName, label: h.label, priceCents: h.priceCents, copies: 1 });

export function LabelsScreen() {
  const { settings } = useApp();
  const { toast } = useFeedback();
  const { labelQueue, setLabelQueue } = usePos();
  const [items, setItems] = useState<LabelItem[]>([]);
  const [showPrice, setShowPrice] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [previews, setPreviews] = useState<LabelRender[]>([]);
  const [history, setHistory] = useState<LabelBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const w = settings?.labelWidthMm ?? 50;
  const h = settings?.labelHeightMm ?? 30;

  const add = useCallback((hit: CatalogHit) => {
    setItems((prev) => (prev.some((i) => i.variantId === hit.variantId) ? prev.map((i) => (i.variantId === hit.variantId ? { ...i, copies: i.copies + 1 } : i)) : [...prev, toItem(hit)]));
  }, []);

  // Productos enviados desde Inventario.
  useEffect(() => {
    if (labelQueue.length > 0) {
      labelQueue.forEach(add);
      setLabelQueue([]);
    }
  }, [labelQueue, add, setLabelQueue]);

  useEffect(() => {
    call('labels:history').then(setHistory).catch(() => undefined);
  }, []);

  // El escáner agrega el producto escaneado al lote.
  useScanHandler((code) => {
    call('catalog:lookup', { code })
      .then((hits) => {
        if (hits.length === 0) toast('error', `Código no encontrado: ${code}`);
        else add(hits[0]!);
      })
      .catch((e) => toast('error', errorText(e)));
  });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults([]);
    const t = window.setTimeout(() => call('catalog:search', { text: q }).then(setResults).catch(() => setResults([])), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  // Vista previa (una por renglón).
  useEffect(() => {
    let alive = true;
    Promise.all(items.map((i) => makeLabel(i)))
      .then((p) => alive && setPreviews(p))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [items]);

  const total = useMemo(() => items.reduce((a, i) => a + i.copies, 0), [items]);
  const setCopies = (id: string, v: string) => setItems((prev) => prev.map((i) => (i.variantId === id ? { ...i, copies: Math.max(1, Math.min(500, Math.floor(Number(v)) || 1)) } : i)));

  const printItems = async (list: LabelItem[]) => {
    if (busy || list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const labels = await expandLabels(list);
      const html = buildLabelSheetHtml(labels, { widthMm: w, heightMm: h, showPrice });
      const r = await call('print:labels', { html, widthMm: w, heightMm: h });
      if (!r.ok) {
        setError(r.error ?? 'No se pudo imprimir.');
        return;
      }
      toast('ok', `${labels.length} etiqueta(s) enviadas a la impresora.`);
      setHistory(await call('labels:saveBatch', { items: list }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const css = labelRules({ widthMm: w, heightMm: h, showPrice }, '.label-preview');

  return (
    <div className="page">
      <h1>Etiquetas</h1>
      <p className="muted">Tamaño de etiqueta: {w} x {h} mm (se cambia en Ajustes). Cada etiqueta lleva código de barras Code128 y código QR.</p>
      <div className="searchbox">
        <input className="inp inp-lg" placeholder="Busca un producto o escanéalo para agregarlo al lote" value={query} onChange={(e) => setQuery(e.target.value)} />
        {results.length > 0 && (
          <div className="results">
            {results.map((r) => (
              <button key={r.variantId} className="result" onClick={() => { add(r); setQuery(''); setResults([]); }}>
                <span><strong>{r.productName}</strong> - {r.label}</span>
                <span className="muted">{r.internalCode}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}

      <div className="card">
        <div className="row-between">
          <h3>Lote actual ({total} etiqueta{total === 1 ? '' : 's'})</h3>
          <label className="check"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Mostrar precio</label>
        </div>
        {items.length === 0 ? (
          <p className="muted">Agrega productos para armar el lote.</p>
        ) : (
          <>
            <style>{css}</style>
            <div className="label-list">
              {items.map((i, k) => (
                <div key={i.variantId} className="label-row">
                  <div className="label-preview" style={{ width: `${w}mm`, height: `${h}mm` }}>
                    {previews[k] && <div className="label" style={{ width: `${w}mm`, height: `${h}mm` }} dangerouslySetInnerHTML={{ __html: labelInnerHtml(previews[k]!, { widthMm: w, heightMm: h, showPrice }) }} />}
                  </div>
                  <div className="stack">
                    <div><strong>{i.productName}</strong> - {i.label}</div>
                    <div className="muted small mono">{i.code} - {money(i.priceCents)}</div>
                    <div className="row-gap">
                      <label className="field-inline">Copias <input className="inp inp-qty" inputMode="numeric" value={i.copies} onChange={(e) => setCopies(i.variantId, e.target.value)} /></label>
                      <button className="btn btn-quiet btn-sm" onClick={() => setItems((prev) => prev.filter((x) => x.variantId !== i.variantId))}>Quitar</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="row-gap">
              <button className="btn btn-gold btn-lg" onClick={() => void printItems(items)} disabled={busy}>{busy ? 'Enviando...' : `Imprimir ${total} etiqueta${total === 1 ? '' : 's'}`}</button>
              <button className="btn" onClick={() => setItems([])} disabled={busy}>Vaciar lote</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>Lotes impresos recientemente</h3>
        {history.length === 0 && <p className="muted">Todavía no hay lotes.</p>}
        {history.slice(0, 10).map((b) => (
          <div key={b.id} className="row-between hist">
            <div>
              <div>{dateTime(b.at)} - {b.items.reduce((a, i) => a + i.copies, 0)} etiqueta(s)</div>
              <div className="muted small">{b.items.map((i) => `${i.productName} ${i.label} x${i.copies}`).join(', ').slice(0, 140)}</div>
            </div>
            <div className="row-gap">
              <button className="btn btn-sm" onClick={() => setItems(b.items)} disabled={busy}>Cargar al lote</button>
              <button className="btn btn-sm" onClick={() => void printItems(b.items)} disabled={busy}>Reimprimir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
