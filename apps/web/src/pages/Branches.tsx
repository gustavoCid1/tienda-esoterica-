import { useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { errorMessage, useDirty } from '../lib/hooks.ts';
import { buildBranchPayload, firstError, type BranchForm, type FieldErrors } from '../lib/forms.ts';
import type { Branch } from '../lib/types.ts';
import { Alert, Badge, Card, ConfirmDialog, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, CloseButton } from '../components/ui.tsx';
import { useBranches, useToast } from '../context.tsx';
import { TerminalsCard } from './TerminalsPanel.tsx';

export function Branches() {
  const { branches, loading, error, reload } = useBranches();
  const { notify } = useToast();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [toggle, setToggle] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmToggle = async () => {
    if (!toggle) return;
    setBusy(true);
    try {
      await api.patch(`/admin/branches/${toggle.id}`, { active: toggle.active === false });
      notify(toggle.active === false ? 'Sucursal activada.' : 'Sucursal desactivada.');
      setToggle(null);
      reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sucursales y ubicaciones"
        subtitle="Cada sucursal tiene lugares internos (vitrina, estante, bodega) y terminales vinculadas."
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Nueva sucursal</button>}
      />
      {loading && branches.length === 0 && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      <Card title="Sucursales">
        {branches.length === 0 ? <Empty>No hay sucursales registradas.</Empty> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Código</th><th>Nombre</th><th>Dirección</th><th>Ubicaciones</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className={b.active === false ? 'row-archived' : ''}>
                    <td><strong>{b.code}</strong></td>
                    <td>{b.name}</td>
                    <td>{b.address || <span className="muted">-</span>}</td>
                    <td>{b.locations.length ? b.locations.join(', ') : <span className="muted">Sin ubicaciones</span>}</td>
                    <td>{b.active === false ? <Badge tone="muted">Inactiva</Badge> : <Badge tone="ok">Activa</Badge>}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(b)}>Editar</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setToggle(b)}>{b.active === false ? 'Activar' : 'Desactivar'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <TerminalsCard />

      {editing && <BranchModal branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {toggle && (
        <ConfirmDialog
          title={toggle.active === false ? 'Activar sucursal' : 'Desactivar sucursal'}
          message={toggle.active === false ? `${toggle.name} volverá a operar.` : `${toggle.name} dejará de aparecer para operar. Sus ventas e inventario se conservan.`}
          busy={busy}
          onCancel={() => setToggle(null)}
          onConfirm={confirmToggle}
        />
      )}
    </>
  );
}

function BranchModal({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState<BranchForm>({
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    address: branch?.address ?? '',
    locations: branch?.locations ?? [],
  });
  const [loc, setLoc] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useDirty(form) || loc.trim() !== '';

  const addLoc = () => {
    const v = loc.trim();
    if (!v) return;
    if (form.locations.some((l) => l.toLowerCase() === v.toLowerCase())) {
      setErrors((e) => ({ ...e, locations: 'Esa ubicación ya existe' }));
      return;
    }
    setForm((f) => ({ ...f, locations: [...f.locations, v] }));
    setLoc('');
    setErrors((e) => ({ ...e, locations: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    // Una ubicación escrita pero no agregada se incluye al guardar.
    const f = loc.trim() ? { ...form, locations: [...form.locations, loc.trim()] } : form;
    const r = buildBranchPayload(f);
    setErrors(r.errors);
    if (!r.payload) {
      setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
      return;
    }
    setBusy(true);
    try {
      if (branch) {
        const p = r.payload as { name: string; address?: string; locations: string[] };
        await api.patch(`/admin/branches/${branch.id}`, { name: p.name, address: p.address ?? '', locations: p.locations });
      } else {
        await api.post('/admin/branches', r.payload);
      }
      notify(branch ? 'Sucursal actualizada.' : 'Sucursal creada.');
      onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={branch ? `Editar ${branch.name}` : 'Nueva sucursal'}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="branch-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button>
        </>
      }
    >
      <form id="branch-form" className="form" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <div className="grid-2">
          <Field label="Código" required hint="1 a 4 letras mayúsculas o números; forma parte del folio" error={errors.code}>
            <input value={form.code} maxLength={4} disabled={!!branch} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Nombre" required error={errors.name}>
            <input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Dirección" error={errors.address}>
          <input value={form.address} maxLength={200} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Ubicaciones internas" hint="Vitrina, Estante A, Bodega..." error={errors.locations}>
          <div className="input-action">
            <input value={loc} maxLength={60} onChange={(e) => setLoc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLoc(); } }} />
            <button type="button" className="btn btn-sm" onClick={addLoc}>Agregar</button>
          </div>
        </Field>
        <div className="chips">
          {form.locations.map((l) => (
            <span className="chip chip-tag" key={l}>
              {l}
              <button type="button" aria-label={`Quitar ${l}`} onClick={() => setForm((f) => ({ ...f, locations: f.locations.filter((x) => x !== l) }))}>&times;</button>
            </span>
          ))}
        </div>
      </form>
    </Modal>
  );
}
