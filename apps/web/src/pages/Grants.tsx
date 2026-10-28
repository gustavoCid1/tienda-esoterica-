import { useEffect, useState, type FormEvent } from 'react';
import { GRANTABLE_FUNCTIONS, formatMxDateTime } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync, useDirty } from '../lib/hooks.ts';
import { buildGrantPayload, firstError, type FieldErrors, type GrantForm } from '../lib/forms.ts';
import { formatDuration } from '../lib/format.ts';
import { nowMxLocal } from '../lib/dates.ts';
import { grantState, minutesLeft, type GrantState } from '../lib/ops.ts';
import type { AdminUser, GrantRow } from '../lib/types.ts';
import { Alert, Badge, Card, ConfirmDialog, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, type Tone, CloseButton } from '../components/ui.tsx';
import { useBranches, useToast } from '../context.tsx';

const FUNCTION_LABEL: Record<string, string> = { 'inventario.entrada': 'Registrar entradas de inventario' };
const STATE_TONE: Record<GrantState, Tone> = { vigente: 'ok', programado: 'info', vencido: 'muted', revocado: 'danger' };
const STATE_LABEL: Record<GrantState, string> = { vigente: 'Vigente', programado: 'Programado', vencido: 'Vencido', revocado: 'Revocado' };
const DURATIONS = [15, 30, 60, 120, 240, 480];

export function Grants() {
  const { branchName } = useBranches();
  const { notify } = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<GrantRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());

  // El estado (vigente/vencido) se recalcula cada 30 s sin volver a pedir datos.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(t);
  }, []);

  const users = useAsync((s) => api.get<unknown>('/admin/users', undefined, s).then((d) => asList<AdminUser>(d)), []);
  const res = useAsync((s) => api.get<unknown>('/admin/grants', undefined, s).then((d) => asList<GrantRow>(d)), []);
  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id.slice(0, 6);

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.post(`/admin/grants/${revoking.id}/revoke`, {});
      notify('Permiso revocado.');
      setRevoking(null);
      res.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const rows = [...(res.data ?? [])].sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  return (
    <>
      <PageHeader
        title="Permisos temporales para vendedores"
        subtitle="Permiten a un vendedor registrar entradas de inventario en una sucursal durante un tiempo limitado. Nunca incluyen cortes de caja ni cambios de rol."
        actions={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Nuevo permiso</button>}
      />
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          {rows.length === 0 ? <Empty>No hay permisos temporales.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Vendedor</th><th>Sucursal</th><th>Función</th><th>Inicio</th><th>Vence</th><th>Estado</th><th>Otorgó</th><th /></tr></thead>
                <tbody>
                  {rows.map((g) => {
                    const st = grantState(g, now);
                    return (
                      <tr key={g.id}>
                        <td>{g.sellerName ?? nameOf(g.sellerId)}</td>
                        <td>{branchName(g.branchId)}</td>
                        <td>{g.functions.map((f) => FUNCTION_LABEL[f] ?? f).join(', ')}</td>
                        <td>{formatMxDateTime(g.startsAt)}</td>
                        <td>{formatMxDateTime(g.expiresAt)}{st === 'vigente' && <div className="muted small">Quedan {formatDuration(minutesLeft(g.expiresAt, now))}</div>}</td>
                        <td><Badge tone={STATE_TONE[st]}>{STATE_LABEL[st]}</Badge>{g.revokedAt && <div className="muted small">{formatMxDateTime(g.revokedAt)}</div>}</td>
                        <td>{g.grantedByName ?? nameOf(g.grantedBy)}</td>
                        <td className="row-actions">{(st === 'vigente' || st === 'programado') && <button type="button" className="btn btn-sm btn-danger" onClick={() => setRevoking(g)}>Revocar</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
      {creating && <GrantModal sellers={(users.data ?? []).filter((u) => u.role === 'vendedor' && u.active)} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); res.reload(); }} />}
      {revoking && (
        <ConfirmDialog
          title="Revocar permiso"
          message={`${revoking.sellerName ?? nameOf(revoking.sellerId)} dejará de poder registrar entradas de inmediato.`}
          confirmLabel="Revocar"
          danger
          busy={busy}
          onCancel={() => setRevoking(null)}
          onConfirm={revoke}
        />
      )}
    </>
  );
}

function GrantModal({ sellers, onClose, onSaved }: { sellers: AdminUser[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const { branches } = useBranches();
  const [form, setForm] = useState<GrantForm>({
    sellerId: '',
    branchId: '',
    functions: [...GRANTABLE_FUNCTIONS],
    startsLocal: nowMxLocal(),
    durationMinutes: '60',
  });
  const [custom, setCustom] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  // "Hora de inicio" cambia sola al abrir; se compara solo el resto del formulario.
  const dirty = useDirty({ ...form, startsLocal: '' });
  const seller = sellers.find((s) => s.id === form.sellerId);
  const allowedBranches = seller ? branches.filter((b) => seller.branchIds.includes(b.id)) : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = buildGrantPayload(form);
    setErrors(r.errors);
    if (!r.payload) {
      setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/grants', r.payload);
      notify('Permiso temporal otorgado.');
      onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nuevo permiso temporal"
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="grant-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Otorgar permiso'}</button>
        </>
      }
    >
      <form id="grant-form" className="form" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <Field label="Vendedor" required error={errors.sellerId}>
          <select value={form.sellerId} onChange={(e) => setForm({ ...form, sellerId: e.target.value, branchId: '' })}>
            <option value="">Elige un vendedor</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.username})</option>)}
          </select>
        </Field>
        <Field label="Sucursal" required error={errors.branchId}>
          <select value={form.branchId} disabled={!seller} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">{seller ? 'Elige una sucursal' : 'Primero elige al vendedor'}</option>
            {allowedBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <fieldset className="fieldset">
          <legend>Función permitida</legend>
          {GRANTABLE_FUNCTIONS.map((f) => (
            <label className="check" key={f}>
              <input
                type="checkbox"
                checked={form.functions.includes(f)}
                onChange={(e) => setForm({ ...form, functions: e.target.checked ? [...form.functions, f] : form.functions.filter((x) => x !== f) })}
              />
              <span>{FUNCTION_LABEL[f] ?? f}</span>
            </label>
          ))}
          {errors.functions && <span className="field-error">{errors.functions}</span>}
        </fieldset>
        <div className="grid-2">
          <Field label="Inicio (hora de México)" required error={errors.startsAt}>
            <input type="datetime-local" value={form.startsLocal} onChange={(e) => setForm({ ...form, startsLocal: e.target.value })} />
          </Field>
          <Field label="Duración" required error={errors.durationMinutes} hint="De 5 minutos a 24 horas">
            <select
              value={custom ? 'otro' : form.durationMinutes}
              onChange={(e) => {
                if (e.target.value === 'otro') setCustom(true);
                else {
                  setCustom(false);
                  setForm({ ...form, durationMinutes: e.target.value });
                }
              }}
            >
              {DURATIONS.map((d) => <option key={d} value={String(d)}>{formatDuration(d)}</option>)}
              <option value="otro">Otra (minutos)...</option>
            </select>
            {custom && <input inputMode="numeric" aria-label="Minutos" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />}
          </Field>
        </div>
        <p className="muted small">Pasada la duración el permiso se vuelve inválido solo; también puedes revocarlo antes.</p>
      </form>
    </Modal>
  );
}
