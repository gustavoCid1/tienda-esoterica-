/** Inicio: estado, accesos rápidos y (solo gerente) el resumen de ventas. Sin logo: es pantalla de trabajo. */
import React from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, H1, H2, Loading, Muted, P, Row, Screen, Spacer } from '../../src/components/ui';
import { StatusBanner } from '../../src/components/StatusBanner';
import { ModeBadge } from '../../src/components/ModeBadge';
import { useApp } from '../../src/state/AppContext';
import { useCart } from '../../src/state/CartContext';
import { formatMxDateTime } from '@amara/shared';

export default function Home() {
  const app = useApp();
  const cart = useCart();
  const router = useRouter();
  if (!app.session || !app.device) return <Loading />;

  const branch = app.myBranches.find((b) => b.id === app.device?.branchId);
  const pending = app.sync.status?.pending ?? 0;
  const conflicts = app.sync.status?.openConflicts ?? 0;

  return (
    <Screen edges={['left', 'right']}>
      <H1>Hola, {app.session.user.name}</H1>
      <Muted>
        {branch?.name ?? 'Sucursal'} · Terminal {app.device.terminalCode} · {app.session.user.role === 'gerente' ? 'Gerente' : 'Vendedor'}
        {app.session.mode === 'offline' ? ' · sesión sin conexión' : ''}
      </Muted>

      <StatusBanner />

      <ModeBadge mode={app.mode} />

      <Button title="Escanear" onPress={() => router.push('/scan')} />
      <Button title={cart.units > 0 ? `Venta de emergencia (${cart.units})` : 'Venta de emergencia'} variant="dark" onPress={() => router.push('/cart')} />
      <Button title="Consultar inventario" variant="secondary" onPress={() => router.push('/inventory')} />
      <Button title="Tickets" variant="secondary" onPress={() => router.push('/tickets')} />
      {app.can('estadisticas.ver') ? <Button title="Resumen de ventas de hoy" variant="secondary" onPress={() => router.push('/summary')} /> : null}

      <Spacer h={4} />
      <Card>
        <H2>Sincronización</H2>
        <Row label="Pendientes por enviar" value={String(pending)} strong={pending > 0} />
        {conflicts > 0 ? <Row label="Conflictos abiertos" value={String(conflicts)} strong /> : null}
        <Row label="Última correcta" value={app.sync.status?.lastSyncOkAt ? formatMxDateTime(app.sync.status.lastSyncOkAt) : 'Nunca'} />
        <Row label="Conexión" value={app.online ? 'Con red' : 'Sin red'} />
        {app.sync.running ? <P>Sincronizando...</P> : null}
        <Button title="Ver detalle" variant="secondary" onPress={() => router.push('/sync')} />
      </Card>
    </Screen>
  );
}
