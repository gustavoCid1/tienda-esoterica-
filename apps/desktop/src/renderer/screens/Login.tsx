/** Pantalla de bienvenida e inicio de sesión (solo gerente y vendedor). */
import { useState } from 'react';
import type { FormEvent } from 'react';
import logoUrl from '../assets/logo-amara.png';
import { errorCode, errorText } from '../lib/api.ts';
import { Banner, Field } from '../components/Field.tsx';
import { useApp } from '../state/AppState.tsx';

export function LoginScreen() {
  const { login, device, sync, info } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstTime, setFirstTime] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFirstTime(false);
    try {
      await login(username, password);
    } catch (err) {
      setError(errorText(err));
      setFirstTime(errorCode(err) === 'sin_credenciales_locales');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        {/* El logo conserva su proporción: solo se fija el ancho, el alto es automático. */}
        <img className="welcome-logo" src={logoUrl} alt="Esotérica Amara" />
        <h1>Bienvenida</h1>
        <p className="muted center">
          {device?.branch ? `${device.branch.name} - Terminal ${device.terminal?.code ?? ''}` : 'Terminal'}
        </p>
        <form onSubmit={submit} className="stack">
          <Field label="Usuario">
            <input className="inp inp-lg" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" spellCheck={false} />
          </Field>
          <Field label="Contraseña">
            <input className="inp inp-lg" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {error && <Banner kind="error">{error}</Banner>}
          {firstTime && <Banner kind="info">La primera vez que entra un usuario en esta computadora hace falta internet. Después podrá entrar sin conexión.</Banner>}
          <button className="btn btn-gold btn-lg" type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
        <p className="muted center small">
          {sync?.online ? 'Conectado al servidor' : 'Sin conexión: se puede entrar y vender igual'}
          {info ? ` - Versión ${info.version}` : ''}
        </p>
      </div>
    </div>
  );
}
