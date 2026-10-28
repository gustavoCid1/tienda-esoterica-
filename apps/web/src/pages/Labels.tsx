import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, asList } from '../lib/api.ts';
import { errorMessage } from '../lib/hooks.ts';
import { readLocal, writeLocal } from '../lib/session.ts';
import { dedupeVariants } from '../lib/inventory.ts';
import {
  LABEL_SIZES, MAX_COPIES, addToBatch, barcodeValueOf, buildLabelSpecs, clampCopies, findDuplicateCodes,
  labelsBlockingProblems, rowToLabelSource, type LabelBatchItem, type LabelOptions,
} from '../lib/labels.ts';
import { formatMxDateTime } from '@amara/shared';
import type { InventoryRow } from '../lib/types.ts';
import { Alert, Badge, Card, Empty, PageHeader, TableWrap } from '../components/ui.tsx';
import { VariantPicker } from '../components/common.tsx';
import { LabelCard } from '../components/LabelCard.tsx';
import { useToast } from '../context.tsx';

const HISTORY_KEY = 'amara.web.labels.history';

interface HistoryEntry {
  at: string;
  items: LabelBatchItem[];
}

export function Labels() {
  const { notify } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<LabelBatchItem[]>([]);
  const [sizeId, setSizeId] = useState(LABEL_SIZES[0]!.id);
  const [opts, setOpts] = useState<LabelOptions>({ showName: true, showPrice: true, showQr: true });
  const [roll, setRoll] = useState(false);
  const [force, setForce] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readLocal<HistoryEntry[]>(HISTORY_KEY, []));
  const [dupReport, setDupReport] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);

  // Llegada desde Inventario o Catálogo con filas preseleccionadas.
  useEffect(() => {
    const rows = (location.state as { rows?: Parameters<typeof rowToLabelSource>[0][] } | null)?.rows;
    if (!rows?.length) return;
    setBatch((b) => rows.reduce((acc, r) => {
      const src = rowToLabelSource(r);
      return src ? addToBatch(acc, src, 1) : acc;
    }, b));
    // Se limpia el estado de navegación para que recargar no vuelva a agregarlas.
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0]!;
  const specs = useMemo(() => buildLabelSpecs(batch, opts), [batch, opts]);
  const problems = useMemo(() => labelsBlockingProblems(specs), [specs]);
  const printable = specs.length > 0 && (problems.length === 0 || force);

  const add = (r: InventoryRow) => {
    const src = rowToLabelSource(r);
    if (src) setBatch((b) => addToBatch(b, src, 1));
  };

  const print = () => {
    const entry: HistoryEntry = { at: new Date().toISOString(), items: batch };
    const next = [entry, ...history].slice(0, 15);
    setHistory(next);
    writeLocal(HISTORY_KEY, next);
    // Deja que React pinte antes de abrir el diálogo de impresión.
    setTimeout(() => window.print(), 50);
  };

  // Compara el lote contra TODO el inventario: ¿algún código lo usa otra variante?
  const checkAgainstInventory = async () => {
    setChecking(true);
    try {
      const all = dedupeVariants(asList<InventoryRow>(await api.get<unknown>('/inventory')));
      const batchIds = new Set(batch.map((b) => b.variantId));
      const batchCodes = new Set(batch.map((b) => barcodeValueOf(b).toUpperCase()).filter(Boolean));
      const merged = [...all.filter((r) => !batchIds.has(r.variantId) && batchCodes.has(barcodeValueOf(r).toUpperCase())), ...batch];
      setDupReport([...findDuplicateCodes(merged)]);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <PageHeader title="Etiquetas" subtitle="Genera etiquetas con código de barras Code 128 y QR para una o varias variantes." />
      <div className="two-col no-print">
        <Card title="1. Elegir productos">
          <VariantPicker onPick={add} placeholder="Buscar producto o variante para agregar al lote" />
          {batch.length === 0 ? (
            <Empty>El lote está vacío. Busca un producto o abre esta pantalla desde Inventario o Catálogo.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Producto</th><th>Código</th><th className="num">Copias</th><th /></tr>
                </thead>
                <tbody>
                  {batch.map((b) => {
                    const value = barcodeValueOf(b);
                    return (
                      <tr key={b.variantId}>
                        <td>{b.productName} <span className="muted">{b.variantLabel}</span></td>
                        <td className="small">{value || <Badge tone="danger">Sin código</Badge>}</td>
                        <td className="num">
                          <input
                            className="qty-input"
                            inputMode="numeric"
                            aria-label={`Copias de ${b.productName}`}
                            value={b.copies}
                            onChange={(e) => setBatch((l) => l.map((x) => (x.variantId === b.variantId ? { ...x, copies: clampCopies(Number(e.target.value) || 1) } : x)))}
                          />
                        </td>
                        <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setBatch((l) => l.filter((x) => x.variantId !== b.variantId))}>Quitar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="muted small">Máximo {MAX_COPIES} copias por variante. Total de etiquetas: <strong>{specs.length}</strong>.</p>
        </Card>

        <Card title="2. Formato">
          <div className="form">
            <label className="field">
              <span className="field-label">Tamaño de etiqueta</span>
              <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
                {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={opts.showName} onChange={(e) => setOpts({ ...opts, showName: e.target.checked })} /><span>Mostrar nombre</span></label>
            <label className="check"><input type="checkbox" checked={opts.showPrice} onChange={(e) => setOpts({ ...opts, showPrice: e.target.checked })} /><span>Mostrar precio</span></label>
            <label className="check"><input type="checkbox" checked={opts.showQr} onChange={(e) => setOpts({ ...opts, showQr: e.target.checked })} /><span>Incluir código QR</span></label>
            <label className="check"><input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} /><span>Impresora de rollo (una etiqueta por página)</span></label>
            <button type="button" className="btn" disabled={batch.length === 0 || checking} onClick={checkAgainstInventory}>
              {checking ? 'Verificando...' : 'Verificar duplicados en todo el inventario'}
            </button>
            {dupReport && (dupReport.length === 0
              ? <Alert tone="ok">No hay códigos repetidos entre variantes.</Alert>
              : <Alert tone="warn" title="Códigos duplicados">Estos códigos los usa más de una variante: {dupReport.join(', ')}. Corrígelos en el catálogo antes de imprimir.</Alert>)}
          </div>
        </Card>
      </div>

      <Card
        title="3. Vista previa e impresión"
        className="no-print-head"
        actions={
          <button type="button" className="btn btn-primary" disabled={!printable} onClick={print}>
            Imprimir etiquetas
          </button>
        }
      >
        {problems.length > 0 && (
          <Alert tone="warn" title="Revisa antes de imprimir">
            <ul className="plain-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            <label className="check">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>Entiendo los avisos y quiero imprimir de todos modos</span>
            </label>
          </Alert>
        )}
        {specs.length === 0 ? (
          <Empty>Agrega productos al lote para ver las etiquetas.</Empty>
        ) : (
          <div className={`print-area label-sheet ${roll ? 'roll' : ''}`}>
            {roll && <style>{`@media print { @page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; } }`}</style>}
            {specs.map((s) => <LabelCard key={s.key} spec={s} size={size} />)}
          </div>
        )}
      </Card>

      <Card title="Reimpresión (lotes impresos desde este navegador)" className="no-print">
        {history.length === 0 ? (
          <Empty>Aún no has impreso lotes desde este navegador.</Empty>
        ) : (
          <ul className="plain-list">
            {history.map((h, i) => (
              <li key={h.at + i}>
                <span>
                  {formatMxDateTime(h.at)} &middot; {h.items.length} variante(s), {h.items.reduce((a, x) => a + x.copies, 0)} etiqueta(s)
                  <span className="muted small"> &mdash; {h.items.slice(0, 3).map((x) => x.productName).join(', ')}{h.items.length > 3 ? '...' : ''}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => { setBatch(h.items); setForce(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  Cargar en el lote
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
