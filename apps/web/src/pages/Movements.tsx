import { useState, type FormEvent } from 'react';
import { newId } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import { MOVEMENT_HELP, buildMovementPayload, firstError, type FieldErrors, type MovementForm, type MovementKind } from '../lib/forms.ts';
import { formatQty } from '../lib/format.ts';
import { MOVEMENT_LABEL } from '../lib/inventory.ts';
import { mxTodayKey, addDays } from '../lib/dates.ts';
import type { InventoryRow, StockMovementRow } from '../lib/types.ts';
import { Alert, Card, ErrorBox, Field, PageHeader, Spinner, Tabs } from '../components/ui.tsx';
import { BranchSelect, DateRangeBar, VariantPicker } from '../components/common.tsx';
import { MovementsTable } from '../components/MovementsTable.tsx';
import { useBranches, useToast } from '../context.tsx';

type Tab = MovementKind | 'historial';

const TABS: { id: Tab; label: string }[] = [
  { id: 'entrada', label: 'Entradas' },
  { id: 'salida', label: 'Salidas' },
  { id: 'ajuste', label: 'Ajustes' },
  { id: 'conteo', label: 'Conteos' },
  { id: 'historial', label: 'Historial' },
];

export function Movements() {
  const [tab, setTab] = useState<Tab>('entrada');
  return (
    <>
      <PageHeader
        title="Entradas, salidas, ajustes y conteos"
        subtitle="La existencia nunca se modifica directamente: cada cambio crea un movimiento con motivo, usuario y fecha."
      />
      <Tabs value={tab} onChange={setTab} items={TABS} />
      {tab === 'historial' ? <History /> : <MovementForm key={tab} kind={tab} />}
    </>
  );
}

function MovementForm({ kind }: { kind: MovementKind }) {
  const { notify } = useToast();
  const { branches } = useBranches();
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.id : '');
  const [row, setRow] = useState<InventoryRow | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState('');
  const locs = branches.find((b) => b.id === branchId)?.locations ?? [];

  const parsed = Number(qty);
  const preview =
    row && qty.trim() !== '' && Number.isInteger(parsed)
      ? kind === 'entrada'
        ? row.qty + parsed
        : kind === 'salida'
          ? row.qty - parsed
          : kind === 'ajuste'
            ? row.qty + parsed
            : parsed
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    setLast('');
    const form: MovementForm = { type: kind, variantId: row?.variantId ?? '', branchId, qty, reason, location };
    const r = buildMovementPayload(form, newId(), row?.qty);
    const errs = { ...r.errors };
    if (!row) errs.variantId = 'Elige un producto';
    setErrors(errs);
    if (!r.payload || Object.keys(errs).length > 0) {
      setServerError(`Revisa el formulario: ${firstError(errs) ?? 'hay datos por corregir'}`);
      return;
    }
    setBusy(true);
    try {
      await api.post('/inventory/movements', r.payload);
      notify(`${MOVEMENT_LABEL[kind]} registrada.`);
      setLast(`${row!.productName} ${row!.variantLabel}: existencia esperada ${formatQty(preview ?? 0)}.`);
      setRow(null);
      setQty('');
      setReason('');
      setLocation('');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const qtyLabel = kind === 'ajuste' ? 'Cantidad (con signo: + suma, - resta)' : kind === 'conteo' ? 'Cantidad contada' : 'Cantidad';

  return (
    <Card title={`Registrar ${MOVEMENT_LABEL[kind].toLowerCase()}`}>
      <p className="muted">{MOVEMENT_HELP[kind]}</p>
      <form className="form narrow" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        {last && <Alert tone="ok">{last}</Alert>}
        <Field label="Sucursal" required error={errors.branchId}>
          <BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setRow(null); }} />
        </Field>
        <Field label="Producto" required error={errors.variantId}>
          {row ? (
            <div className="selected-box">
              <div>
                <strong>{row.productName}</strong> <span className="muted">{row.variantLabel}</span>
                <div className="small muted">Existencia actual: {formatQty(row.qty)} &middot; {row.sku || row.code || row.barcode}</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setRow(null)}>Cambiar</button>
            </div>
          ) : branchId ? (
            <VariantPicker branchId={branchId} onPick={(r) => { setRow(r); setLocation(r.location ?? ''); }} />
          ) : (
            <span className="muted">Primero elige la sucursal.</span>
          )}
        </Field>
        <div className="grid-2">
          <Field label={qtyLabel} required error={errors.qty}>
            <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Lugar (opcional)" error={errors.location}>
            <input value={location} list="dl-mov-loc" maxLength={60} onChange={(e) => setLocation(e.target.value)} />
            <datalist id="dl-mov-loc">{locs.map((l) => <option key={l} value={l} />)}</datalist>
          </Field>
        </div>
        <Field label="Motivo" required hint="Obligatorio para auditoría (mínimo 3 caracteres)" error={errors.reason}>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {row && preview !== null && (
          <p className="small">
            Existencia actual <strong>{formatQty(row.qty)}</strong> &rarr; después del movimiento <strong>{formatQty(preview)}</strong>
            {kind === 'conteo' && <> (diferencia {preview - row.qty > 0 ? '+' : ''}{preview - row.qty})</>}
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Registrando...' : `Registrar ${MOVEMENT_LABEL[kind].toLowerCase()}`}
          </button>
        </div>
      </form>
    </Card>
  );
}

function History() {
  const today = mxTodayKey();
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [branchId, setBranchId] = useState('');
  const [type, setType] = useState('');
  const [onlyTransfers, setOnlyTransfers] = useState(false);

  const res = useAsync(
    // Fechas como día de México "AAAA-MM-DD" (mismo criterio que dateRangeSchema).
    (signal) => api.get<unknown>('/inventory/movements', { branchId, from: range.from, to: range.to }, signal).then((d) => asList<StockMovementRow>(d)),
    [range.from, range.to, branchId],
    range.from !== '' && range.to !== '' && range.from <= range.to,
  );
  const rows = (res.data ?? []).filter((m) => (!type || m.type === type) && (!onlyTransfers || m.type.startsWith('transferencia')));

  return (
    <Card title="Historial de movimientos">
      <div className="filters">
        <DateRangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="inline-field">
          <span>Sucursal</span>
          <BranchSelect value={branchId} onChange={setBranchId} allLabel="Todas" />
        </label>
        <label className="inline-field">
          <span>Tipo</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(MOVEMENT_LABEL).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyTransfers} onChange={(e) => setOnlyTransfers(e.target.checked)} />
          <span>Solo transferencias</span>
        </label>
      </div>
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && <MovementsTable rows={rows.slice(0, 500)} />}
      {rows.length > 500 && <p className="muted small">Se muestran 500 de {rows.length}; acota las fechas para ver el resto.</p>}
    </Card>
  );
}
