/**
 * Configuración de la terminal (una vez por teléfono).
 * La API no tiene (todavía) una ruta para que el teléfono se registre solo: el gerente crea la terminal
 * (tipo "movil") en la administración y aquí se capturan su ID y su código (1-3 caracteres A-Z/0-9,
 * parte del folio). El token de terminal es OPCIONAL y se guarda en SecureStore.
 */
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Banner, Button, Field, Muted, Screen } from '../src/components/ui';
import { useApp } from '../src/state/AppContext';

export default function TerminalSetup() {
  const app = useApp();
  const router = useRouter();
  const [terminalId, setTerminalId] = useState(app.terminal?.terminalId ?? '');
  const [terminalCode, setTerminalCode] = useState(app.terminal?.terminalCode ?? '');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const code = terminalCode.trim().toUpperCase();
    if (!terminalId.trim()) return setError('Escribe el ID de la terminal.');
    if (!/^[A-Z0-9]{1,3}$/.test(code)) return setError('El código debe tener de 1 a 3 letras mayúsculas o números (por ejemplo M1).');
    setBusy(true);
    try {
      const wasReady = app.phase === 'listo';
      await app.saveTerminal({ terminalId, terminalCode: code }, token.length > 0 ? token : undefined);
      if (wasReady && router.canGoBack()) router.back();
      // En la configuración inicial el guardia de navegación continúa a la selección de sucursal.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Muted>
        Cada teléfono necesita una terminal registrada por el gerente. El código forma parte del folio de cada venta, por eso no debe repetirse en
        otro equipo.
      </Muted>
      <Field label="ID de la terminal" value={terminalId} onChangeText={setTerminalId} autoCapitalize="none" autoCorrect={false} />
      <Field label="Código de la terminal (1 a 3 caracteres)" value={terminalCode} onChangeText={(t) => setTerminalCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={3} />
      <Field label="Token de terminal (opcional)" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry hint="Si el gerente te lo dio, la sincronización funciona aunque tu sesión venza. Se guarda cifrado. Déjalo vacío para no cambiarlo." />
      {error ? <Banner kind="error" text={error} /> : null}
      <Button title="Guardar" onPress={() => void save()} loading={busy} />
    </Screen>
  );
}
