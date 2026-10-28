/** Selección de sucursal (solo las autorizadas para el usuario). */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Banner, Button, H2, Loading, Muted, Screen, Spacer } from '../src/components/ui';
import { useApp } from '../src/state/AppContext';

export default function BranchScreen() {
  const app = useApp();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await app.selectBranch(id);
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo seleccionar la sucursal.');
    } finally {
      setBusyId(null);
    }
  }

  // Con una sola sucursal autorizada se selecciona sola la primera vez.
  useEffect(() => {
    if (app.phase === 'sucursal' && app.myBranches.length === 1 && !busyId && !error) void choose(app.myBranches[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.phase, app.myBranches.length]);

  if (!app.session) return <Loading />;

  return (
    <Screen>
      <H2>Elige tu sucursal</H2>
      <Muted>Solo aparecen las sucursales que el gerente te autorizó. La primera vez se descarga el catálogo y requiere internet.</Muted>
      {app.myBranches.length === 0 ? <Banner kind="error" text="Tu usuario no tiene sucursales asignadas. Pide al gerente que te asigne una." /> : null}
      {app.myBranches.map((b) => (
        <Button
          key={b.id}
          title={b.code ? `${b.name} (${b.code})` : b.name}
          variant={app.device?.branchId === b.id ? 'primary' : 'secondary'}
          onPress={() => void choose(b.id)}
          loading={busyId === b.id}
          disabled={busyId !== null && busyId !== b.id}
        />
      ))}
      {error ? <Banner kind="error" text={error} /> : null}
      <Spacer />
      {app.phase === 'listo' ? <Button title="Cancelar" variant="secondary" onPress={() => router.back()} /> : <Button title="Cerrar sesión" variant="secondary" onPress={() => void app.logout()} />}
    </Screen>
  );
}
