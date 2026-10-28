import { useState, type FormEvent } from 'react';
import { loginSchema } from '@amara/shared/schemas';
import { useAuth } from '../context.tsx';
import { ApiError } from '../lib/api.ts';
import { errorMessage } from '../lib/hooks.ts';
import { issuesToErrors, type FieldErrors } from '../lib/forms.ts';
import { Alert, Field } from '../components/ui.tsx';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues as never));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await login(parsed.data.username, parsed.data.password);
      // La contraseña no se conserva: el componente se desmonta al iniciar sesión.
    } catch (err) {
      setPassword('');
      setFormError(err instanceof ApiError && err.status === 401 ? 'Usuario o contraseña incorrectos.' : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit} noValidate>
        <img className="login-logo" src="/logo-amara.png" alt="Esotérica Amara" width={200} height={155} />
        <h1>Panel administrativo</h1>
        <p className="muted center">Acceso para gerencia</p>
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field label="Usuario" error={errors.username}>
          <input value={username} autoComplete="username" autoFocus onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Contraseña" error={errors.password}>
          <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Entrando...' : 'Iniciar sesión'}
        </button>
        <p className="muted small center">La sesión se cierra al cerrar la pestaña. Nunca compartas tu contraseña.</p>
      </form>
    </div>
  );
}
