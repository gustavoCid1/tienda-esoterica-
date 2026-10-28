/**
 * Autorización de una acción sensible (v2), dentro de una ventana:
 *  - GERENTE: confirma SU contraseña (ya es de administrador).
 *  - VENDEDOR: contraseña de un administrador O un token de seguridad (hasta 10 caracteres). Se valida en el proceso
 *    principal (en línea con el servidor si hay conexión; si no, con la caché local). Si no se puede comprobar, se NIEGA.
 * La contraseña o el código jamás se guardan: el proceso principal entrega un "boleto" de un solo uso que la acción devuelve.
 */
import { useEffect, useRef, useState } from 'react';
import { can } from '@amara/shared';
import type { TokenPurpose } from '@amara/shared';
import { TOKEN_CODE_MAX_LENGTH } from '@amara/shared';
import type { AuthTicket, SensitiveAuth } from '../../shared/ipc.ts';
import { PURPOSE_LABEL } from '../../shared/token-form.ts';
import { call, errorText } from '../lib/api.ts';
import { useApp } from '../state/AppState.tsx';
import { Banner, Field } from './Field.tsx';

interface Props {
  purpose: TokenPurpose;
  /** Se llama con la autorización lista para mandar a la acción, o null si aún no está completa. */
  onChange: (auth: SensitiveAuth | null) => void;
  /** Cambia este número para borrar lo escrito (p. ej. tras un intento rechazado). */
  resetSignal?: number;
  /** Texto de la contraseña del gerente (por omisión "Tu contraseña (confirmación)"). */
  managerLabel?: string;
  disabled?: boolean;
  /** El gerente no necesita confirmar (p. ej. entrar a Limpias): no se muestra nada. */
  managerFree?: boolean;
}

export function AuthPrompt({ purpose, onChange, resetSignal = 0, managerLabel, disabled, managerFree }: Props) {
  const { user } = useApp();
  const isManager = !!user && can(user.role, 'caja.corte');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'admin' | 'token'>('admin');
  const [secret, setSecret] = useState('');
  const [ticket, setTicket] = useState<AuthTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    setPassword('');
    setSecret('');
    setTicket(null);
    setError(null);
  }, [resetSignal]);

  // El gerente manda su contraseña; el vendedor, el boleto ya validado.
  useEffect(() => {
    if (isManager) cb.current(managerFree ? {} : password ? { password } : null);
    else cb.current(ticket ? { ticket: ticket.ticket } : null);
  }, [isManager, managerFree, password, ticket]);

  if (isManager) {
    if (managerFree) return null;
    return (
      <Field label={managerLabel ?? 'Tu contraseña (confirmación)'}>
        <input className="inp" type="password" value={password} disabled={disabled} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
    );
  }

  const verify = async () => {
    if (busy || !secret) return;
    setBusy(true);
    setError(null);
    try {
      const t = await call('security:verify', mode === 'token' ? { purpose, code: secret } : { purpose, adminPassword: secret });
      setTicket(t);
      setSecret('');
    } catch (e) {
      setTicket(null);
      setError(errorText(e));
      setSecret('');
    } finally {
      setBusy(false);
    }
  };

  if (ticket) {
    return (
      <Banner kind="ok">
        <strong>Autorizado</strong>
        {ticket.via === 'admin_password' ? ' con contraseña de administrador' : ' con token de seguridad'}
        {ticket.byName ? ` (${ticket.byName})` : ''}
        {ticket.online ? ' - verificado con el servidor.' : ' - verificado en este equipo.'}{' '}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setTicket(null)} disabled={disabled}>Cambiar</button>
      </Banner>
    );
  }

  return (
    <div className="authbox">
      <div className="authbox-title">Autorización: {PURPOSE_LABEL[purpose].toLowerCase()}</div>
      <div className="muted small">Pide a un administrador que escriba su contraseña, o usa un token de seguridad.</div>
      <div className="segmented">
        <button type="button" className={mode === 'admin' ? 'seg seg-on' : 'seg'} onClick={() => { setMode('admin'); setSecret(''); setError(null); }}>Contraseña de administrador</button>
        <button type="button" className={mode === 'token' ? 'seg seg-on' : 'seg'} onClick={() => { setMode('token'); setSecret(''); setError(null); }}>Token de seguridad</button>
      </div>
      <div className="authbox-row">
        {mode === 'admin' ? (
          <input className="inp" type="password" placeholder="Contraseña del administrador" value={secret} disabled={disabled || busy} autoComplete="off"
            onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void verify(); } }} />
        ) : (
          <input className="inp mono" placeholder="Código del token" value={secret} maxLength={TOKEN_CODE_MAX_LENGTH + 2} disabled={disabled || busy} autoComplete="off" spellCheck={false}
            onChange={(e) => setSecret(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void verify(); } }} />
        )}
        <button type="button" className="btn btn-gold" onClick={() => void verify()} disabled={disabled || busy || !secret}>{busy ? 'Validando...' : 'Validar'}</button>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
    </div>
  );
}
