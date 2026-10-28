/**
 * Tokens de seguridad (gerente). Un token autoriza una acción sensible (cerrar caja, devolver,
 * cancelar, Limpias) a un vendedor sin que el gerente comparta su contraseña.
 *  - Crear exige reautenticación (x-reauth, como pide el contrato).
 *  - El código se muestra UNA sola vez: solo vive en el estado del modal mientras está abierto.
 *  - "Ticket de permiso": comprobante imprimible en color distinto al ticket de venta.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatMxDateTime } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import {
  EMPTY_TOKEN_FORM, MAX_CODE_LENGTH, MIN_CODE_LENGTH, STATUS_LABEL, TOKEN_PURPOSES, buildTokenPayload, durationToMinutes, expiryText,
  formatTokenDuration, normalizeCreateResponse, normalizeTokenRows, purposesText, tokenStatus, togglePurpose,
  type DurationUnit, type TokenForm, type TokenFormErrors,
} from '../lib/tokens.ts';
import { permitFileName, type PermitTicketData } from '../lib/permitTicket.ts';
import { makePermitTicketPdf } from '../lib/pdf.ts';
import type { SecurityTokenRow, TokenStatus } from '../lib/types-v2.ts';
import type { AdminUser } from '../lib/types.ts';
import { Alert, Badge, Card, CloseButton, ConfirmDialog, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, type Tone } from '../components/ui.tsx';
import { CopyButton } from '../components/CopyButton.tsx';
import { PdfPreviewModal } from '../components/PdfPreviewModal.tsx';
import { useAuth, useBranches, useToast } from '../context.tsx';

const STATUS_TONE: Record<TokenStatus, Tone> = { vigente: 'ok', vencido: 'muted', revocado: 'danger', agotado: 'warn' };

/** Datos del token recién creado: viven solo mientras el modal del código está abierto. */
interface CreatedToken {
  code: string;
  expiresAt: string;
  issuedAt: string;
  label: string;
  purposes: PermitTicketData['purposes'];
  branchName: string | null;
  forUserName: string | null;
  maxUses: number | null;
}

export function SecurityTokens() {
  const { notify } = useToast();
  const { branchName } = useBranches();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [revoke, setRevoke] = useState<SecurityTokenRow | null>(null);
  const [busy, setBusy] = useState(false);
  // Reloj para que "vigente/vencido" se actualice sin recargar.
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNowIso(new Date().toISOString()), 30_000);
    return () => clearInterval(t);
  }, []);

  const tokens = useAsync((s) => api.get<unknown>('/security/tokens', undefined, s).then(normalizeTokenRows), []);
  const users = useAsync((s) => api.get<unknown>('/admin/users', undefined, s).then((d) => asList<AdminUser>(d)), []);
  const userName = (id: string | null, row?: SecurityTokenRow) => (id ? row?.forUserName || users.data?.find((u) => u.id === id)?.name || id.slice(0, 8) : null);

  const rows = tokens.data ?? [];
  const active = rows.filter((r) => tokenStatus(r, nowIso) === 'vigente').length;

  const doRevoke = async () => {
    if (!revoke) return;
    setBusy(true);
    try {
      await api.post(`/security/tokens/${revoke.id}/revoke`, {});
      notify('Token revocado: ya no sirve para autorizar nada.');
      setRevoke(null);
      tokens.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Tokens de seguridad"
        subtitle="Códigos temporales para que un vendedor cierre caja, devuelva, cancele o entre a Limpias sin conocer tu contraseña."
        actions={
          <>
            <button type="button" className="btn" onClick={tokens.reload} disabled={tokens.loading}>{tokens.loading ? 'Actualizando...' : 'Actualizar'}</button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Crear token</button>
          </>
        }
      />
      {tokens.loading && !tokens.data && <Spinner />}
      {tokens.error && <ErrorBox error={tokens.error} onRetry={tokens.reload} />}
      {tokens.data && (
        <Card title={`Tokens (${active} vigente${active === 1 ? '' : 's'} de ${rows.length})`}>
          {rows.length === 0 ? (
            <Empty>Aún no hay tokens. Usa "Crear token" para generar uno.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Etiqueta</th><th>Sirve para</th><th>Sucursal</th><th>Para</th><th>Vigencia</th><th className="num">Usos</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const st = tokenStatus(t, nowIso);
                    return (
                      <tr key={t.id} className={st === 'vigente' ? '' : 'row-archived'}>
                        <td><strong>{t.label}</strong><div className="muted small">Creado {t.createdAt ? formatMxDateTime(t.createdAt) : '-'}{t.createdByName ? ` por ${t.createdByName}` : ''}</div></td>
                        <td>{purposesText(t.purposes)}</td>
                        <td>{t.branchId ? branchName(t.branchId) : <span className="muted">Cualquiera</span>}</td>
                        <td>{userName(t.forUserId, t) ?? <span className="muted">Cualquiera</span>}</td>
                        <td>
                          {t.expiresAt ? formatMxDateTime(t.expiresAt) : '-'}
                          {st === 'vigente' && <div className="muted small">{expiryText(t.expiresAt, nowIso)}</div>}
                        </td>
                        <td className="num">{t.usedCount}{t.maxUses !== null ? ` / ${t.maxUses}` : ' / sin límite'}</td>
                        <td><Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge></td>
                        <td className="row-actions">{st === 'vigente' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRevoke(t)}>Revocar</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="muted small">Por seguridad el servidor no guarda el código: solo se ve al crearlo. Si se perdió, revoca el token y crea otro.</p>
        </Card>
      )}

      {creating && (
        <CreateTokenModal
          users={(users.data ?? []).filter((u) => u.role === 'vendedor' && u.active)}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setCreated(c);
            tokens.reload();
          }}
        />
      )}
      {created && <CodeModal token={created} onClose={() => setCreated(null)} />}
      {revoke && (
        <ConfirmDialog
          title="Revocar token"
          message={`El token "${revoke.label}" dejará de servir de inmediato. Las operaciones ya hechas con él se conservan en la auditoría.`}
          confirmLabel="Revocar"
          danger
          busy={busy}
          onCancel={() => setRevoke(null)}
          onConfirm={doRevoke}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------- Crear */

function CreateTokenModal(props: { users: AdminUser[]; onClose: () => void; onCreated: (c: CreatedToken) => void }) {
  const { branches, branchName } = useBranches();
  const [form, setForm] = useState<TokenForm>(EMPTY_TOKEN_FORM);
  const [errors, setErrors] = useState<TokenFormErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = form.label.trim() !== '' || form.purposes.length > 0;

  const minutes = durationToMinutes(form.amount, form.unit);
  const preview = minutes !== null ? `Durará ${formatTokenDuration(minutes)}.` : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = buildTokenPayload(form);
    setErrors(r.errors);
    if (!r.payload) return;
    setBusy(true);
    try {
      const issuedAt = new Date();
      const fallbackExpires = new Date(issuedAt.getTime() + r.payload.durationMinutes * 60000).toISOString();
      // Acción sensible: pide la contraseña (x-reauth) antes de enviar.
      const raw = await api.post<unknown>('/security/tokens', r.payload, { reauth: true });
      const res = normalizeCreateResponse(raw, fallbackExpires);
      if (!res) throw new Error('El servidor no devolvió el código del token. Revisa la lista y vuelve a intentarlo.');
      props.onCreated({
        code: res.code,
        expiresAt: res.expiresAt,
        issuedAt: issuedAt.toISOString(),
        label: r.payload.label,
        purposes: r.payload.purposes,
        branchName: r.payload.branchId ? branchName(r.payload.branchId) : null,
        forUserName: r.payload.forUserId ? props.users.find((u) => u.id === r.payload!.forUserId)?.name ?? null : null,
        maxUses: r.payload.maxUses ?? null,
      });
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Crear token de seguridad"
      size="md"
      dirty={dirty && !busy}
      onClose={props.onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="token-form" className="btn btn-primary" disabled={busy}>{busy ? 'Creando...' : 'Crear token'}</button>
        </>
      }
    >
      <form id="token-form" className="form" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <Field label="Etiqueta" required hint="Para reconocerlo después, ej. Cierre de caja de Ana" error={errors.label}>
          <input value={form.label} maxLength={60} autoFocus onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <fieldset className={`fieldset ${errors.purposes ? 'has-error' : ''}`}>
          <legend>Sirve para</legend>
          {TOKEN_PURPOSES.map((p) => (
            <label className="check" key={p.id} title={p.hint}>
              <input type="checkbox" checked={form.purposes.includes(p.id)} onChange={() => setForm((f) => ({ ...f, purposes: togglePurpose(f.purposes, p.id) }))} />
              <span>{p.label}</span>
            </label>
          ))}
          {errors.purposes && <span className="field-error" role="alert">{errors.purposes}</span>}
        </fieldset>
        <div className="grid-2">
          <Field label="Duración" required error={errors.amount} hint={preview || 'De 1 minuto a 7 días'}>
            <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Unidad">
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as DurationUnit })}>
              <option value="minutos">Minutos</option>
              <option value="horas">Horas</option>
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Sucursal" hint="Vacío = cualquier sucursal">
            <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              <option value="">Cualquier sucursal</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Para el usuario (opcional)" hint="Vacío = cualquier vendedor">
            <select value={form.forUserId} onChange={(e) => setForm({ ...form, forUserId: e.target.value })}>
              <option value="">Cualquier usuario</option>
              {props.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Usos máximos (opcional)" hint="Vacío = ilimitado dentro de su vigencia" error={errors.maxUses}>
            <input inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          </Field>
          <Field label="Longitud del código" hint={`De ${MIN_CODE_LENGTH} a ${MAX_CODE_LENGTH} caracteres`} error={errors.length}>
            <input inputMode="numeric" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} />
          </Field>
        </div>
        <p className="muted small">Pedirá tu contraseña. El código se mostrará una sola vez al terminar.</p>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ Código (una vez) */

function CodeModal(props: { token: CreatedToken; onClose: () => void }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const t = props.token;
  const [ticket, setTicket] = useState<{ blob: Blob; filename: string } | null>(null);
  const [making, setMaking] = useState(false);

  const ticketData = useMemo<PermitTicketData>(
    () => ({
      code: t.code,
      label: t.label,
      purposes: t.purposes,
      issuedAtIso: t.issuedAt,
      expiresAtIso: t.expiresAt,
      branchName: t.branchName,
      forUserName: t.forUserName,
      maxUses: t.maxUses,
      authorizedBy: user?.name ?? '',
    }),
    [t, user?.name],
  );

  const openTicket = async () => {
    setMaking(true);
    try {
      setTicket({ blob: await makePermitTicketPdf(ticketData), filename: permitFileName(new Date().toISOString()) });
    } catch (e) {
      notify(`No se pudo generar el ticket de permiso: ${errorMessage(e)}`, 'error');
    } finally {
      setMaking(false);
    }
  };

  return (
    <>
      <Modal
        title="Token creado"
        size="sm"
        onClose={props.onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={openTicket} disabled={making}>{making ? 'Generando...' : 'Ticket de permiso'}</button>
            <button type="button" className="btn btn-primary" onClick={props.onClose}>Listo</button>
          </>
        }
      >
        <Alert tone="warn" title="Cópialo ahora">
          Este código solo se muestra una vez. Entrégalo a quien debe usarlo; no se puede consultar después.
        </Alert>
        <div className="token-code" aria-label="Código del token">{t.code}</div>
        <div className="btn-row">
          <CopyButton text={t.code} label="Copiar código" />
        </div>
        <dl className="dl">
          <dt>Etiqueta</dt><dd>{t.label}</dd>
          <dt>Sirve para</dt><dd>{purposesText(t.purposes)}</dd>
          <dt>Vence</dt><dd>{formatMxDateTime(t.expiresAt)}</dd>
          <dt>Sucursal</dt><dd>{t.branchName ?? 'Cualquiera'}</dd>
          <dt>Para</dt><dd>{t.forUserName ?? 'Cualquier usuario'}</dd>
        </dl>
      </Modal>
      {ticket && (
        <PdfPreviewModal
          title="Ticket de permiso"
          size="md"
          blob={ticket.blob}
          filename={ticket.filename}
          onClose={() => setTicket(null)}
          note={<p className="muted small">Este ticket es de color distinto al ticket de venta para no confundirlos. Contiene el código: entrégalo solo a quien lo necesite.</p>}
        />
      )}
    </>
  );
}
