import { useState, type FormEvent } from 'react';
import { newId } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import { buildTransferPayload, firstError, type FieldErrors } from '../lib/forms.ts';
import { addDays, mxTodayKey } from '../lib/dates.ts';
import type { InventoryRow, StockMovementRow } from '../lib/types.ts';
import { Alert, Card, ConfirmDialog, ErrorBox, Field, PageHeader, Spinner } from '../components/ui.tsx';
import { BranchSelect, VariantPicker } from '../components/common.tsx';
import { MovementsTable } from '../components/MovementsTable.tsx';
import { useBranches, useToast } from '../context.tsx';

interface Line {
  row: InventoryRow;
  qty: string;
}

export function Transfers() {
  const { notify } = useToast();
  const { branchName } = useBranches();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [confirm, setConfirm] = useState<ReturnType<typeof buildTransferPayload> | null>(null);
  const [busy, setBusy] = useState(false);

  const today = mxTodayKey();
  const history = useAsync(
    (signal) =>
      api
        .get<unknown>('/inventory/movements', { from: addDays(today, -29), to: today }, signal)
        .then((d) => asList<StockMovementRow>(d).filter((m) => m.type.startsWith('transferencia'))),
    [today],
  );

  const addLine = (row: InventoryRow) => {
    if (lines.some((l) => l.row.variantId === row.variantId)) {
      notify('Ese producto ya está en la lista.', 'info');
      return;
    }
    setLines((l) => [...l, { row, qty: '1' }]);
  };

  const review = (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = buildTransferPayload(
      {
        fromBranchId: from,
        toBranchId: to,
        note,
        items: lines.map((l) => ({ variantId: l.row.variantId, qty: l.qty, available: l.row.qty })),
      },
      newId(),
    );
    setErrors(r.errors);
    if (!r.payload) {
      setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
      return;
    }
    setConfirm(r);
  };

  const send = async () => {
    if (!confirm?.payload) return;
    setBusy(true);
    try {
      await api.post('/inventory/transfers', confirm.payload);
      notify('Transferencia registrada.');
      setConfirm(null);
      setLines([]);
      setNote('');
      history.reload();
    } catch (err) {
      setConfirm(null);
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Transferencias entre sucursales" />
      <Alert tone="info" title="Una transferencia no es una venta">
        Mueve piezas de una sucursal a otra: genera una salida en el origen y una entrada en el destino. No crea ticket, no suma a ventas
        ni a ingresos, y no afecta el corte de caja.
      </Alert>

      <Card title="Nueva transferencia">
        <form className="form" onSubmit={review} noValidate>
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <div className="grid-2">
            <Field label="Sucursal de origen" required error={errors.fromBranchId}>
              <BranchSelect value={from} onChange={(v) => { setFrom(v); setLines([]); }} />
            </Field>
            <Field label="Sucursal de destino" required error={errors.toBranchId}>
              <BranchSelect value={to} onChange={setTo} />
            </Field>
          </div>
          <Field label="Agregar producto (de la sucursal de origen)" error={errors.items}>
            {from ? <VariantPicker branchId={from} onPick={addLine} /> : <span className="muted">Primero elige el origen.</span>}
          </Field>
          {lines.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Producto</th><th className="num">Disponible en origen</th><th className="num">Cantidad a enviar</th><th /></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.row.variantId}>
                      <td>{l.row.productName} <span className="muted">{l.row.variantLabel}</span></td>
                      <td className="num">{l.row.qty}</td>
                      <td className="num">
                        <input
                          className="qty-input"
                          inputMode="numeric"
                          aria-label="Cantidad a enviar"
                          value={l.qty}
                          onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                        />
                        {errors[`items.${i}.qty`] && <div className="field-error">{errors[`items.${i}.qty`]}</div>}
                        {errors[`items.${i}.variantId`] && <div className="field-error">{errors[`items.${i}.variantId`]}</div>}
                      </td>
                      <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Field label="Nota (opcional)" error={errors.note}>
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy || lines.length === 0}>Revisar y transferir</button>
          </div>
        </form>
      </Card>

      <Card title="Transferencias de los últimos 30 días">
        {history.loading && !history.data && <Spinner />}
        {history.error && <ErrorBox error={history.error} onRetry={history.reload} />}
        {history.data && <MovementsTable rows={history.data} />}
      </Card>

      {confirm && (
        <ConfirmDialog
          title="Confirmar transferencia"
          message={`Se moverán ${lines.length} producto(s) de ${branchName(from)} a ${branchName(to)}. Esto no es una venta.`}
          confirmLabel="Transferir"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={send}
        />
      )}
    </>
  );
}
