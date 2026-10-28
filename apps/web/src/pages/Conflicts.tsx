import { useState, type FormEvent } from 'react';
import { formatMxDateTime } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import type { ConflictRow } from '../lib/types.ts';
import { Alert, Badge, Card, ConfirmDialog, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, CloseButton } from '../components/ui.tsx';
import { useBranches, useToast } from '../context.tsx';

export function Conflicts() {
  const { notify } = useToast();
  const { branchName } = useBranches();
  const [status, setStatus] = useState<'abierto' | 'resuelto' | ''>('abierto');
  const [open, setOpen] = useState<ConflictRow | null>(null);
  const [reconcile, setReconcile] = useState(false);
  const [busy, setBusy] = useState(false);

  const res = useAsync(
    (signal) => api.get<unknown>('/admin/conflicts', { status }, signal).then((d) => asList<ConflictRow>(d)),
    [status],
  );
  // Por si el servidor ignora el filtro, también se filtra aquí.
  const rows = (res.data ?? []).filter((c) => !status || (status === 'abierto' ? !c.resolvedAt && c.status !== 'resuelto' : !!c.resolvedAt || c.status === 'resuelto'));

  const doReconcile = async () => {
    setBusy(true);
    try {
      await api.post('/inventory/reconcile', {});
      notify('Existencias recalculadas desde los movimientos.');
      setReconcile(false);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Conflictos de sincronización"
        subtitle="Un conflicto significa que la operación SÍ se aplicó, pero quedó una diferencia que requiere tu revisión (por ejemplo, existencia negativa por ventas sin conexión)."
        actions={<button type="button" className="btn" onClick={() => setReconcile(true)}>Recalcular existencias</button>}
      />
      <div className="filters">
        <label className="inline-field">
          <span>Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="abierto">Abiertos</option>
            <option value="resuelto">Resueltos</option>
            <option value="">Todos</option>
          </select>
        </label>
      </div>
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          {rows.length === 0 ? <Empty>No hay conflictos {status === 'abierto' ? 'abiertos' : 'con ese filtro'}.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Sucursal</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {rows.map((c) => {
                    const resolved = !!c.resolvedAt || c.status === 'resuelto';
                    return (
                      <tr key={c.id}>
                        <td>{formatMxDateTime(c.createdAt)}</td>
                        <td><strong>{c.kind}</strong></td>
                        <td>{c.detail ?? <span className="muted">-</span>}</td>
                        <td>{c.branchId ? branchName(c.branchId) : '-'}</td>
                        <td>{resolved ? <Badge tone="ok">Resuelto</Badge> : <Badge tone="warn">Abierto</Badge>}</td>
                        <td className="row-actions"><button type="button" className="btn btn-sm" onClick={() => setOpen(c)}>{resolved ? 'Ver' : 'Revisar'}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
      {open && <ConflictModal c={open} onClose={() => setOpen(null)} onResolved={() => { setOpen(null); res.reload(); }} />}
      {reconcile && (
        <ConfirmDialog
          title="Recalcular existencias"
          message="Se recalculará la existencia de todas las variantes sumando sus movimientos registrados. Úsalo si sospechas que una existencia no coincide con su historial."
          confirmLabel="Recalcular"
          busy={busy}
          onCancel={() => setReconcile(false)}
          onConfirm={doReconcile}
        />
      )}
    </>
  );
}

function ConflictModal({ c, onClose, onResolved }: { c: ConflictRow; onClose: () => void; onResolved: () => void }) {
  const { notify } = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolved = !!c.resolvedAt || c.status === 'resuelto';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) {
      setError('Describe qué decidiste o corregiste (mínimo 3 caracteres).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/admin/conflicts/${c.id}/resolve`, { note: note.trim() });
      notify('Conflicto marcado como resuelto.');
      onResolved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Conflicto: ${c.kind}`}
      size="lg"
      dirty={!resolved && note.trim() !== ''}
      onClose={onClose}
      footer={
        resolved ? (
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
        ) : (
          <>
            <CloseButton label="Cancelar" disabled={busy} />
            <button type="submit" form="conflict-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Marcar como resuelto'}</button>
          </>
        )
      }
    >
      <form id="conflict-form" className="form" onSubmit={submit} noValidate>
        <div className="detail-grid">
          <div><span className="muted small">Registrado</span><div>{formatMxDateTime(c.createdAt)}</div></div>
          <div><span className="muted small">Operación</span><div className="small">{c.opId ?? '-'}</div></div>
          <div><span className="muted small">Estado</span><div>{resolved ? 'Resuelto' : 'Abierto'}</div></div>
        </div>
        {c.detail && <Alert tone="warn">{c.detail}</Alert>}
        {c.payload != null && (
          <details>
            <summary>Datos de la operación</summary>
            <pre className="code-block">{JSON.stringify(c.payload, null, 2)}</pre>
          </details>
        )}
        {resolved ? (
          <Alert tone="ok" title="Resolución">{c.resolutionNote ?? 'Sin nota.'}{c.resolvedAt ? ` (${formatMxDateTime(c.resolvedAt)})` : ''}</Alert>
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Resolución" required hint="Qué revisaste o corregiste (queda en la auditoría)">
              <textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <p className="muted small">Si hay que corregir existencias, hazlo primero con un ajuste o conteo en Entradas, salidas y conteos; después marca el conflicto como resuelto.</p>
          </>
        )}
      </form>
    </Modal>
  );
}
