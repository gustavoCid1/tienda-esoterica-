/**
 * Selección de sucursal y terminal (activación). La hace un GERENTE con internet:
 * inicia sesión en el servidor, elige sucursal/terminal y el servidor entrega el token de la terminal.
 * Alternativa avanzada: pegar el token y los datos a mano.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import logoUrl from '../assets/logo-amara.png';
import type { ActivationOptions } from '../../shared/ipc.ts';
import { call, errorText } from '../lib/api.ts';
import { Banner, Field } from '../components/Field.tsx';
import { useApp } from '../state/AppState.tsx';

export function ActivationScreen({ onDone }: { onDone?: () => void }) {
  const { refreshDevice, settings } = useApp();
  const [apiUrl, setApiUrl] = useState(settings?.apiUrl ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [options, setOptions] = useState<ActivationOptions | null>(null);
  const [branchId, setBranchId] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ token: '', branchId: '', branchCode: '', branchName: '', terminalId: '', terminalCode: '' });

  const terminals = options?.terminals.filter((t) => !t.branchId || t.branchId === branchId) ?? [];

  const fetchOptions = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const o = await call('activation:options', { apiUrl, username, password });
      setOptions(o);
      setBranchId(o.branches[0]?.id ?? '');
      setPassword('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await call('activation:activate', { branchId, terminalId });
      await refreshDevice();
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const activateManual = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await call('activation:manual', { apiUrl, ...m });
      await refreshDevice();
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card welcome-wide">
        <img className="welcome-logo" src={logoUrl} alt="Esotérica Amara" />
        <h1>Activar esta terminal</h1>
        <p className="muted center">Un gerente debe vincular esta computadora con su sucursal y terminal. Requiere internet solo esta vez.</p>

        {!options && !manual && (
          <form onSubmit={fetchOptions} className="stack">
            <Field label="Dirección del servidor" hint="Ejemplo: https://amara.midominio.com">
              <input className="inp inp-lg" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} autoFocus spellCheck={false} />
            </Field>
            <Field label="Usuario del gerente">
              <input className="inp inp-lg" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="username" />
            </Field>
            <Field label="Contraseña del gerente">
              <input className="inp inp-lg" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {error && <Banner kind="error">{error}</Banner>}
            <button className="btn btn-gold btn-lg" disabled={busy || !apiUrl.trim() || !username.trim() || !password}>
              {busy ? 'Conectando...' : 'Continuar'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setManual(true)}>
              Avanzado: activar con un token
            </button>
          </form>
        )}

        {options && (
          <div className="stack">
            <Field label="Sucursal">
              <select className="inp inp-lg" value={branchId} onChange={(e) => { setBranchId(e.target.value); setTerminalId(''); }}>
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} - {b.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Terminal">
              <select className="inp inp-lg" value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
                <option value="">Elige una terminal</option>
                {terminals.map((t) => (
                  <option key={t.id} value={t.id}>{t.code} - {t.name}</option>
                ))}
              </select>
            </Field>
            {error && <Banner kind="error">{error}</Banner>}
            <button className="btn btn-gold btn-lg" onClick={() => void activate()} disabled={busy || !branchId || !terminalId}>
              {busy ? 'Activando...' : 'Activar terminal'}
            </button>
            <button className="btn btn-quiet" onClick={() => setOptions(null)} disabled={busy}>Volver</button>
          </div>
        )}

        {manual && (
          <form onSubmit={activateManual} className="stack">
            <Field label="Dirección del servidor">
              <input className="inp" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} spellCheck={false} />
            </Field>
            <Field label="Token de la terminal">
              <input className="inp" value={m.token} onChange={(e) => setM({ ...m, token: e.target.value })} spellCheck={false} />
            </Field>
            <div className="grid2">
              <Field label="Id de la sucursal"><input className="inp" value={m.branchId} onChange={(e) => setM({ ...m, branchId: e.target.value })} spellCheck={false} /></Field>
              <Field label="Código de sucursal"><input className="inp" value={m.branchCode} onChange={(e) => setM({ ...m, branchCode: e.target.value })} spellCheck={false} /></Field>
              <Field label="Nombre de la sucursal"><input className="inp" value={m.branchName} onChange={(e) => setM({ ...m, branchName: e.target.value })} /></Field>
              <Field label="Id de la terminal"><input className="inp" value={m.terminalId} onChange={(e) => setM({ ...m, terminalId: e.target.value })} spellCheck={false} /></Field>
              <Field label="Código de terminal"><input className="inp" value={m.terminalCode} onChange={(e) => setM({ ...m, terminalCode: e.target.value })} spellCheck={false} /></Field>
            </div>
            {error && <Banner kind="error">{error}</Banner>}
            <button className="btn btn-gold btn-lg" disabled={busy}>{busy ? 'Activando...' : 'Activar terminal'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setManual(false)} disabled={busy}>Volver</button>
          </form>
        )}
      </div>
    </div>
  );
}
