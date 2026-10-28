/**
 * Tokens de seguridad (v2, SOLO gerente y EN LÍNEA): se crean en el servidor (que guarda solo sal + hash).
 * El código se muestra UNA sola vez al crearlo; desde esa ventana se puede imprimir el "ticket de permiso"
 * (violeta, con el rótulo TICKET DE PERMISO). Aquí se listan y se revocan.
 */
import { useCallback, useEffect, useState } from 'react';
import { TOKEN_CODE_MAX_LENGTH } from '@amara/shared';
import type { TokenPurpose } from '@amara/shared';
import type { BranchRow, SellerRow, TokenRowView } from '../../shared/ipc.ts';
import {
  ALL_PURPOSES, PURPOSE_LABEL, STATUS_LABEL, TOKEN_LENGTH_DEFAULT_UI, TOKEN_LENGTH_MIN_UI, buildTokenBody, formatDuration,
} from '../../shared/token-form.ts';
import type { DurationUnit } from '../../shared/token-form.ts';
import { DocPreviewModal } from '../components/DocPreviewModal.tsx';
import { Banner, Field } from '../components/Field.tsx';
import { Modal } from '../components/Modal.tsx';
import { call, errorText } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

interface Created {
  id: string;
  code: string;
  expiresAt: string;
  createdAt: string;
  label: string;
  purposes: TokenPurpose[];
  branchId: string | null;
  forUserId: string | null;
  maxUses: number | null;
}

export function TokensScreen() {
  const { user } = useApp();
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState<TokenRowView[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  useScanHandler(() => toast('info', 'En esta pantalla no se usa el escáner.'));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await call('tokens:list'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    call('catalog:branches').then(setBranches).catch(() => undefined);
    call('sellers:list').then(setSellers).catch(() => undefined);
  }, [load]);

  const branchName = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.name ?? 'Otra sucursal') : 'Todas');
  const userNameOf = (id: string | null) => (id ? (sellers.find((s) => s.id === id)?.name ?? 'Un usuario') : 'Cualquiera');

  const revoke = async (t: TokenRowView) => {
    const ok = await confirm({
      title: 'Revocar token',
      message: `El token "${t.label}" dejará de funcionar de inmediato. Los equipos sin conexión lo dejarán de aceptar cuando sincronicen.`,
      confirmText: 'Revocar',
      danger: true,
    });
    if (!ok) return;
    try {
      await call('tokens:revoke', { id: t.id });
      toast('ok', 'Token revocado.');
      void load();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  return (
    <div className="page">
      <div className="row-between">
        <h1>Tokens de seguridad</h1>
        <button className="btn btn-gold btn-lg" onClick={() => setCreating(true)}>Nuevo token</button>
      </div>
      <p className="muted">Un token permite que un vendedor cierre la caja, haga devoluciones o cancelaciones, o entre a Limpias sin que estés presente. Dura el tiempo que tú elijas.</p>
      {user && !user.onlineLogin && <Banner kind="warn">Para crear, ver o revocar tokens hay que iniciar sesión con internet. Cierra sesión y entra de nuevo con conexión.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <table className="table">
        <thead><tr><th>Nombre</th><th>Sirve para</th><th>Sucursal</th><th>Para</th><th>Vence</th><th>Usos</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="cell-main">{t.label}</td>
              <td>{t.purposes.map((p) => PURPOSE_LABEL[p] ?? p).join(', ')}</td>
              <td>{branchName(t.branchId)}</td>
              <td>{userNameOf(t.forUserId)}</td>
              <td>{dateTime(t.expiresAt)}</td>
              <td>{t.usedCount}{t.maxUses !== null ? ` / ${t.maxUses}` : ''}</td>
              <td><span className={`chip ${t.status === 'vigente' ? 'chip-ok' : t.status === 'pendiente' ? 'chip-info' : 'chip-warn'}`}>{STATUS_LABEL[t.status] ?? t.status}</span></td>
              <td className="num">{(t.status === 'vigente' || t.status === 'pendiente') && <button className="btn btn-sm btn-danger" onClick={() => void revoke(t)}>Revocar</button>}</td>
            </tr>
          ))}
          {rows.length === 0 && !loading && <tr><td colSpan={8} className="center muted">{error ? 'No se pudo cargar la lista.' : 'Todavía no hay tokens.'}</td></tr>}
        </tbody>
      </table>

      {creating && (
        <CreateModal
          branches={branches}
          sellers={sellers}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setCreated(c);
            void load();
          }}
        />
      )}
      {created && <CreatedModal c={created} branchLabel={branchName(created.branchId)} onClose={() => setCreated(null)} />}
    </div>
  );
}

function CreateModal({ branches, sellers, onClose, onCreated }: { branches: BranchRow[]; sellers: SellerRow[]; onClose: () => void; onCreated: (c: Created) => void }) {
  const [label, setLabel] = useState('');
  const [purposes, setPurposes] = useState<TokenPurpose[]>(['cierre_caja']);
  const [durationText, setDurationText] = useState('30');
  const [unit, setUnit] = useState<DurationUnit>('minutos');
  const [branchId, setBranchId] = useState<string>('');
  const [maxUsesText, setMaxUsesText] = useState('');
  const [length, setLength] = useState(TOKEN_LENGTH_DEFAULT_UI);
  const [forUserId, setForUserId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: TokenPurpose) => setPurposes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const form = buildTokenBody({ label, purposes, durationText, unit, branchId: branchId || null, maxUsesText, length, forUserId: forUserId || null });
  const ready = form.ok && password.length > 0;

  const submit = async () => {
    if (busy || !form.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('tokens:create', { ...form.body, password });
      onCreated({
        id: r.id, code: r.code, expiresAt: r.expiresAt, createdAt: new Date().toISOString(), label: form.body.label,
        purposes: form.body.purposes, branchId: form.body.branchId, forUserId: form.body.forUserId, maxUses: form.body.maxUses,
      });
    } catch (e) {
      setError(errorText(e));
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nuevo token de seguridad"
      size="lg"
      onClose={onClose}
      dirty={label !== '' || password !== ''}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-gold btn-lg" onClick={() => void submit()} disabled={busy || !ready}>{busy ? 'Creando...' : 'Crear token'}</button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nombre del token" hint="Para reconocerlo después. Ejemplo: Cierre de Ana">
          <input className="inp" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <div>
          <div className="field-label">Sirve para</div>
          <div className="row-gap">
            {ALL_PURPOSES.map((p) => (
              <label key={p} className="check"><input type="checkbox" checked={purposes.includes(p)} onChange={() => toggle(p)} /> {PURPOSE_LABEL[p]}</label>
            ))}
          </div>
        </div>
        <div className="grid3">
          <Field label="Duración" error={!form.ok && durationText.trim() !== '' && form.error.includes('duración') ? form.error : null}>
            <input className="inp" inputMode="decimal" value={durationText} onChange={(e) => setDurationText(e.target.value)} />
          </Field>
          <Field label="Unidad">
            <select className="inp" value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)}>
              <option value="minutos">Minutos</option>
              <option value="horas">Horas</option>
            </select>
          </Field>
          <Field label="Sucursal">
            <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Todas mis sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid3">
          <Field label="Usos máximos" hint="Vacío = ilimitado mientras dure">
            <input className="inp" inputMode="numeric" value={maxUsesText} onChange={(e) => setMaxUsesText(e.target.value)} placeholder="Sin límite" />
          </Field>
          <Field label={`Largo del código (${TOKEN_LENGTH_MIN_UI} a ${TOKEN_CODE_MAX_LENGTH})`}>
            <select className="inp" value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {Array.from({ length: TOKEN_CODE_MAX_LENGTH - TOKEN_LENGTH_MIN_UI + 1 }, (_, i) => TOKEN_LENGTH_MIN_UI + i).map((n) => <option key={n} value={n}>{n} caracteres</option>)}
            </select>
          </Field>
          <Field label="Solo para (opcional)">
            <select className="inp" value={forUserId} onChange={(e) => setForUserId(e.target.value)}>
              <option value="">Cualquier usuario</option>
              {sellers.filter((s) => s.role === 'vendedor').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        {!form.ok && label.trim() !== '' && <Banner kind="warn">{form.error}</Banner>}
        {form.ok && <div className="preview">Dura <strong>{formatDuration(form.body.durationMinutes)}</strong> desde que lo crees.</div>}
        <Field label="Tu contraseña (confirmación)">
          <input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}

function CreatedModal({ c, branchLabel, onClose }: { c: Created; branchLabel: string; onClose: () => void }) {
  const { toast } = useFeedback();
  const [ticket, setTicket] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.code);
      toast('ok', 'Código copiado.');
    } catch {
      toast('warn', 'No se pudo copiar. Anótalo o imprime el ticket.');
    }
  };

  return (
    <Modal
      title="Token creado"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-permit btn-lg" onClick={() => setTicket(true)}>Ticket de permiso</button>
          <button className="btn btn-gold" onClick={onClose}>Listo</button>
        </>
      }
    >
      <div className="stack">
        <Banner kind="warn">Este código se muestra UNA sola vez. Anótalo o imprime el ticket de permiso ahora: después ya no se puede consultar.</Banner>
        <div className="token-code" aria-label="Código del token">{c.code}</div>
        <div className="row-gap">
          <button className="btn" onClick={() => void copy()}>Copiar código</button>
        </div>
        <div className="muted">
          <strong>{c.label}</strong> - sirve para: {c.purposes.map((p) => PURPOSE_LABEL[p]).join(', ')}.<br />
          Vence el {dateTime(c.expiresAt)} - Sucursal: {branchLabel}.
        </div>
      </div>
      {ticket && (
        <DocPreviewModal
          doc={{ kind: 'permit', permit: { code: c.code, label: c.label, purposes: c.purposes, createdAt: c.createdAt, expiresAt: c.expiresAt, branchId: c.branchId, forUserId: c.forUserId, maxUses: c.maxUses } }}
          title="Ticket de permiso"
          onClose={() => setTicket(false)}
        />
      )}
    </Modal>
  );
}
