/**
 * Ventana de autorización de una acción sensible (cerrar caja, cancelar, devolver, Limpias).
 *  - Gerente: confirma con SU contraseña.
 *  - Vendedor: contraseña de un administrador O token de seguridad con el propósito correcto.
 * La contraseña/código solo se usan para comprobar (local y, si hace falta, en línea) y se borran al cerrar.
 * Se comprueba primero con los datos del teléfono; si no basta y hay internet, con el servidor. Si no se puede comprobar, se DENIEGA.
 */
import React, { useEffect, useState } from 'react';
import { Banner, Button, Chip, ChipRow, Field, Muted } from './ui';
import { Sheet } from './Sheet';
import { PURPOSE_ACTION, authorizeAction, modesFor } from '../lib/authorize';
import type { AuthMode, AuthOutcome } from '../lib/authorize';
import { useApp } from '../state/AppContext';
import type { TokenPurpose } from '@amara/shared';

export type AuthSuccess = Extract<AuthOutcome, { ok: true }>;

export function AuthModal(props: { visible: boolean; purpose: TokenPurpose; onCancel: () => void; onAuthorized: (a: AuthSuccess) => void; extraNote?: string }) {
  const { visible, purpose, onCancel, onAuthorized, extraNote } = props;
  const app = useApp();
  const { store, session, device, online, api } = app;
  const role = session?.user.role ?? 'vendedor';
  const modes = modesFor(role);
  const [mode, setMode] = useState<AuthMode>('password');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSecret('');
      setError(null);
      setMode('password');
    }
  }, [visible]);

  async function submit() {
    if (!store || !session || !device) return;
    setBusy(true);
    setError(null);
    // Deja pintar el estado "Comprobando..." antes de que scrypt ocupe el hilo de JavaScript unos segundos.
    await new Promise<void>((r) => setTimeout(r, 60));
    try {
      const out = await authorizeAction(
        store,
        { purpose, branchId: device.branchId, userId: session.user.id, role, mode, secret },
        online && session.token ? (body) => api.post<unknown>('/security/verify', body, { timeoutMs: 10_000 }) : null,
      );
      if (out.ok) {
        setSecret('');
        onAuthorized(out);
      } else {
        setError(out.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo comprobar la autorización.');
    } finally {
      setBusy(false);
    }
  }

  const action = PURPOSE_ACTION[purpose];
  return (
    <Sheet visible={visible} title="Autorización necesaria" onClose={onCancel}>
      <Muted>
        {role === 'gerente'
          ? `Para ${action} confirma tu contraseña.`
          : `Para ${action} se necesita la contraseña de un administrador o un token de seguridad vigente para esta acción.`}
      </Muted>
      {extraNote ? <Muted>{extraNote}</Muted> : null}
      {modes.length > 1 ? (
        <ChipRow>
          <Chip label="Contraseña de administrador" selected={mode === 'password'} onPress={() => { setMode('password'); setSecret(''); setError(null); }} />
          <Chip label="Token" selected={mode === 'token'} onPress={() => { setMode('token'); setSecret(''); setError(null); }} />
        </ChipRow>
      ) : null}
      {mode === 'password' ? (
        <Field label={role === 'gerente' ? 'Tu contraseña' : 'Contraseña del administrador'} value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      ) : (
        <Field label="Código del token" value={secret} onChangeText={setSecret} autoCapitalize="characters" autoCorrect={false} maxLength={14} placeholder="Hasta 10 caracteres" />
      )}
      {!online ? <Banner kind="info" text="Sin conexión: se comprueba con los datos guardados en este teléfono. Si no se puede comprobar, se niega." /> : null}
      {busy ? <Muted>Comprobando... puede tardar unos segundos.</Muted> : null}
      {error ? <Banner kind="error" text={error} /> : null}
      <Button title="Autorizar" onPress={() => void submit()} loading={busy} disabled={secret.trim() === ''} />
      <Button title="Cancelar" variant="secondary" onPress={onCancel} disabled={busy} />
    </Sheet>
  );
}
