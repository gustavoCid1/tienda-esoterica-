/** Componentes compartidos por varias pantallas: selectores, fotos, buscador de variantes y filtros de fecha. */
import { useRef, useState } from 'react';
import { api, asList } from '../lib/api.ts';
import { useAsync, useDebounced, errorMessage } from '../lib/hooks.ts';
import { fileToResizedDataUrl } from '../lib/image.ts';
import { formatMXN } from '../lib/format.ts';
import { STOCK_STATUS_LABEL, stockStatus } from '../lib/inventory.ts';
import { presetRange, mxTodayKey, type RangePreset } from '../lib/dates.ts';
import type { InventoryRow } from '../lib/types.ts';
import { useBranches } from '../context.tsx';
import { Badge, type Tone } from './ui.tsx';

export function BranchSelect(props: {
  value: string;
  onChange: (id: string) => void;
  /** Texto de la opción vacía; si no se da, no hay opción vacía. */
  allLabel?: string;
  ids?: string[];
  disabled?: boolean;
  id?: string;
}) {
  const { branches } = useBranches();
  const list = props.ids ? branches.filter((b) => props.ids!.includes(b.id)) : branches;
  return (
    <select id={props.id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
      {props.allLabel !== undefined && <option value="">{props.allLabel}</option>}
      {!props.allLabel && props.value === '' && <option value="">Elige una sucursal</option>}
      {list.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'ultimos_30', label: '30 días' },
];

/** Selector de fechas (desde/hasta, días de México) con atajos. */
export function DateRangeBar(props: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="filter-group">
      <label className="inline-field">
        <span>Desde</span>
        <input type="date" value={props.from} max={props.to || undefined} onChange={(e) => props.onChange(e.target.value, props.to)} />
      </label>
      <label className="inline-field">
        <span>Hasta</span>
        <input type="date" value={props.to} min={props.from || undefined} onChange={(e) => props.onChange(props.from, e.target.value)} />
      </label>
      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            onClick={() => {
              const r = presetRange(p.id, mxTodayKey());
              props.onChange(r.from, r.to);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  return src ? <img className="thumb" src={src} alt={alt} loading="lazy" /> : <span className="thumb thumb-empty" aria-label="Sin foto">Sin foto</span>;
}

export function StockBadge({ qty, minStock }: { qty: number; minStock: number }) {
  const s = stockStatus(qty, minStock);
  const tone: Tone = s === 'agotado' ? 'danger' : s === 'bajo' ? 'warn' : 'ok';
  return <Badge tone={tone}>{STOCK_STATUS_LABEL[s]}</Badge>;
}

/** Foto opcional del producto, reducida en el navegador antes de guardarse. */
export function PhotoInput(props: { value: string; onChange: (dataUrl: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      props.onChange(await fileToResizedDataUrl(file));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="photo-input">
      <Thumb src={props.value || null} alt="Foto del producto" />
      <div className="photo-actions">
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {props.value ? 'Cambiar foto' : 'Agregar foto (opcional)'}
        </button>
        {props.value && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => props.onChange('')}>
            Quitar
          </button>
        )}
        {err && <span className="field-error">{err}</span>}
      </div>
    </div>
  );
}

/**
 * Buscador de variantes sobre GET /inventory. Devuelve la fila elegida (variante + sucursal),
 * útil para movimientos, transferencias y etiquetas.
 */
export function VariantPicker(props: {
  branchId?: string;
  onPick: (row: InventoryRow) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const res = useAsync(
    (signal) => api.get<unknown>('/inventory', { q: dq, branchId: props.branchId }, signal).then((d) => asList<InventoryRow>(d).slice(0, 12)),
    [dq, props.branchId],
    dq.length >= 2,
  );
  return (
    <div className="picker">
      <input
        type="search"
        value={q}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? 'Buscar por nombre, variante, SKU o código (mín. 2 letras)'}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Buscar producto"
      />
      {dq.length >= 2 && (
        <div className="picker-results">
          {res.loading && <div className="picker-note">Buscando...</div>}
          {res.error && <div className="picker-note field-error">{res.error}</div>}
          {!res.loading && !res.error && (res.data?.length ?? 0) === 0 && <div className="picker-note">Sin resultados.</div>}
          {(res.data ?? []).map((r) => (
            <button
              type="button"
              key={`${r.variantId}-${r.branchId}`}
              className="picker-item"
              onClick={() => {
                props.onPick(r);
                setQ('');
              }}
            >
              <Thumb src={r.photo} alt="" />
              <span className="picker-text">
                <strong>{r.productName}</strong> <span className="muted">{r.variantLabel}</span>
                <small>
                  {r.sku || r.code || r.barcode || 'Sin código'} &middot; {r.branchName ?? ''} &middot; Existencia: {r.qty} &middot; {formatMXN(r.priceCents)}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
