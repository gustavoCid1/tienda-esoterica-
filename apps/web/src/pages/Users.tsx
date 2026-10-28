import { useState, type FormEvent } from 'react';
import type { Role } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync, useDirty } from '../lib/hooks.ts';
import { buildUserCreatePayload, buildUserUpdatePayload, firstError, type FieldErrors, type UserForm } from '../lib/forms.ts';
import { ALL_PERMISSIONS, PERMISSION_LABEL, ROLE_NAME, roleHas } from '../lib/permLabels.ts';
import type { AdminUser } from '../lib/types.ts';
import { Alert, Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, Tabs, CloseButton } from '../components/ui.tsx';
import { useAuth, useBranches, useToast } from '../context.tsx';

export function Users() {
  const { user: me, permissions } = useAuth();
  const { branchName } = useBranches();
  const [tab, setTab] = useState<'usuarios' | 'permisos'>('usuarios');
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const res = useAsync((s) => api.get<unknown>('/admin/users', undefined, s).then((d) => asList<AdminUser>(d)), []);

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        subtitle="Crear usuarios, cambiar roles o contraseñas y desactivar accesos pide confirmar tu contraseña."
        actions={tab === 'usuarios' && <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Nuevo usuario</button>}
      />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'usuarios', label: 'Usuarios' }, { id: 'permisos', label: 'Permisos por rol' }]} />
      {tab === 'usuarios' ? (
        <>
          {res.loading && !res.data && <Spinner />}
          {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
          {res.data && (
            <Card>
              {res.data.length === 0 ? <Empty>No hay usuarios.</Empty> : (
                <TableWrap>
                  <table className="table">
                    <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Sucursales</th><th>Estado</th><th /></tr></thead>
                    <tbody>
                      {res.data.map((u) => (
                        <tr key={u.id} className={u.active ? '' : 'row-archived'}>
                          <td><strong>{u.username}</strong>{u.id === me?.id && <span className="muted"> (tú)</span>}</td>
                          <td>{u.name}</td>
                          <td><Badge tone={u.role === 'gerente' ? 'gold' : 'muted'}>{ROLE_NAME[u.role]}</Badge></td>
                          <td>{u.branchIds.map(branchName).join(', ')}</td>
                          <td>{u.active ? <Badge tone="ok">Activo</Badge> : <Badge tone="muted">Inactivo</Badge>}</td>
                          <td className="row-actions"><button type="button" className="btn btn-sm" onClick={() => setEditing(u)}>Editar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          )}
        </>
      ) : (
        <Card title="Qué puede hacer cada rol">
          <Alert tone="info">
            Esta matriz es de consulta. El servidor decide en cada petición con el rol guardado en la base; ocultar una opción en pantalla no
            sustituye esa validación. Los permisos temporales solo habilitan entradas de inventario a un vendedor, en una sucursal y por un tiempo.
          </Alert>
          <TableWrap>
            <table className="table">
              <thead><tr><th>Permiso</th>{(['gerente', 'vendedor', 'desarrollador'] as Role[]).map((r) => <th key={r} className="center">{ROLE_NAME[r]}</th>)}<th className="center">Tu sesión</th></tr></thead>
              <tbody>
                {ALL_PERMISSIONS.map((p) => (
                  <tr key={p}>
                    <td>{PERMISSION_LABEL[p]}<div className="muted small">{p}</div></td>
                    {(['gerente', 'vendedor', 'desarrollador'] as Role[]).map((r) => <td key={r} className="center">{roleHas(r, p) ? 'Sí' : '-'}</td>)}
                    <td className="center">{permissions.has(p) ? <Badge tone="ok">Sí</Badge> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      {editing && <UserModal user={editing === 'new' ? null : editing} isSelf={editing !== 'new' && editing.id === me?.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload(); }} />}
    </>
  );
}

function UserModal({ user, isSelf, onClose, onSaved }: { user: AdminUser | null; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const { branches } = useBranches();
  const [form, setForm] = useState<UserForm>({
    username: user?.username ?? '',
    name: user?.name ?? '',
    role: user?.role ?? 'vendedor',
    password: '',
    password2: '',
    branchIds: user?.branchIds ?? [],
    active: user?.active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useDirty(form);
  const set = (patch: Partial<UserForm>) => setForm((f) => ({ ...f, ...patch }));

  // Un gerente no puede crear desarrolladores desde el POS: la opción solo aparece si ya lo es.
  const roles: Role[] = user?.role === 'desarrollador' ? ['desarrollador'] : ['gerente', 'vendedor'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    try {
      if (!user) {
        const r = buildUserCreatePayload(form);
        setErrors(r.errors);
        if (!r.payload) {
          setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
          return;
        }
        setBusy(true);
        await api.post('/admin/users', r.payload, { reauth: true });
        notify('Usuario creado.');
      } else {
        const r = buildUserUpdatePayload(form, user);
        setErrors(r.errors);
        if (!r.payload) {
          setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
          return;
        }
        if (!r.changed) {
          onClose();
          return;
        }
        setBusy(true);
        await api.patch(`/admin/users/${user.id}`, r.payload, { reauth: r.sensitive || r.payload.active === false });
        notify('Usuario actualizado.');
      }
      onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={user ? `Editar ${user.username}` : 'Nuevo usuario'}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button>
        </>
      }
    >
      <form id="user-form" className="form" onSubmit={submit} noValidate autoComplete="off">
        {serverError && <Alert tone="error">{serverError}</Alert>}
        {isSelf && <Alert tone="warn">Estás editando tu propio usuario: no cambies tu rol ni te desactives, o perderás acceso.</Alert>}
        <div className="grid-2">
          <Field label="Usuario" required hint="Letras, números, punto, guion" error={errors.username}>
            <input value={form.username} disabled={!!user} maxLength={40} autoComplete="off" onChange={(e) => set({ username: e.target.value })} />
          </Field>
          <Field label="Nombre completo" required error={errors.name}>
            <input value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Rol" required error={errors.role}>
            <select value={form.role} onChange={(e) => set({ role: e.target.value as Role })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
            </select>
          </Field>
          {user && (
            <label className="check align-end">
              <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
              <span>Usuario activo</span>
            </label>
          )}
        </div>
        <div className="grid-2">
          <Field label={user ? 'Nueva contraseña (opcional)' : 'Contraseña'} required={!user} hint="Mínimo 8 caracteres" error={errors.password}>
            <input type="password" value={form.password} autoComplete="new-password" onChange={(e) => set({ password: e.target.value })} />
          </Field>
          <Field label="Repite la contraseña" required={!user} error={errors.password2}>
            <input type="password" value={form.password2} autoComplete="new-password" onChange={(e) => set({ password2: e.target.value })} />
          </Field>
        </div>
        <fieldset className="fieldset">
          <legend>Sucursales con acceso</legend>
          {branches.map((b) => (
            <label className="check" key={b.id}>
              <input
                type="checkbox"
                checked={form.branchIds.includes(b.id)}
                onChange={(e) => set({ branchIds: e.target.checked ? [...form.branchIds, b.id] : form.branchIds.filter((x) => x !== b.id) })}
              />
              <span>{b.name}</span>
            </label>
          ))}
          {errors.branchIds && <span className="field-error">{errors.branchIds}</span>}
        </fieldset>
        <p className="muted small">Cambiar rol o contraseña, crear usuarios y desactivar cuentas pedirá tu contraseña al guardar.</p>
      </form>
    </Modal>
  );
}
