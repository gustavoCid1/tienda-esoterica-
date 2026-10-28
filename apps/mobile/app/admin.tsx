/**
 * Panel administrativo (SOLO gerente): entrada del administrador. "Mis ventas" de hoy, notificaciones de existencias y
 * gráficas de ventas generales con selector de tipo (pastel, líneas, barras). El vendedor no ve nada de esto: la pantalla
 * lo rechaza, no se le ofrece el acceso y el servidor igualmente da 403 a sus consultas.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMXN, formatMxDateTime } from '@amara/shared';
import { Banner, Button, Card, H1, H2, Loading, MenuItem, Muted, Row, Screen } from '../src/components/ui';
import { StatusBanner } from '../src/components/StatusBanner';
import { SalesCharts } from '../src/components/SalesCharts';
import { badgeText } from '../src/lib/low-stock';
import { mySales, summarizeToday } from '../src/lib/misc-v2';
import type { TodayLoad } from '../src/services/today';
import { loadToday } from '../src/services/today';
import { useAlerts } from '../src/state/AlertsContext';
import { useApp } from '../src/state/AppContext';

export default function Admin() {
  const app = useApp();
  const alerts = useAlerts();
  const router = useRouter();
  const { store, device, session, online, api } = app;
  const [today, setToday] = useState<TodayLoad | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store || !device) return;
    try {
      setToday(await loadToday({ api, store, online, branchId: device.branchId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar las ventas de hoy.');
    }
  }, [store, device, api, online]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, app.dataVersion]),
  );

  // Un vendedor que llegue aquí por error vuelve al inicio (la autorización real está en el servidor y en LocalStore).
  useEffect(() => {
    if (session && !app.can('estadisticas.ver')) router.replace('/home');
  }, [session, app, router]);

  if (!session || !device || !store) return <Loading />;
  if (!app.can('estadisticas.ver')) return <Screen><Banner kind="error" text="Solo el gerente puede entrar al panel administrativo." /></Screen>;

  const mine = today ? mySales(today.items, session.user.id) : [];
  const mineView = summarizeToday(mine);
  const branch = app.myBranches.find((b) => b.id === device.branchId);

  return (
    <Screen edges={['left', 'right']}>
      <H1>Panel administrativo</H1>
      <Muted>
        {session.user.name} · {branch?.name ?? 'Sucursal'}
      </Muted>
      <StatusBanner compact />

      <MenuItem
        title="Notificaciones de existencias"
        subtitle={alerts.counts.total > 0 ? `${alerts.counts.agotados} agotados · ${alerts.counts.bajos} en su mínimo` : 'Ningún producto en su mínimo'}
        badge={badgeText(alerts.counts.total) || undefined}
        onPress={() => router.push('/notifications')}
      />

      <Card>
        <H2>Mis ventas de hoy</H2>
        <Muted>Las que vendió {session.user.name} (según el empleado elegido al cobrar).</Muted>
        {error ? <Banner kind="error" text={error} /> : null}
        {today?.source === 'local' ? <Banner kind="warn" title="Datos locales" text={today.note ?? ''} /> : null}
        <Row label="Tickets" value={String(mineView.count)} />
        <Row label="Vendido (sin cancelados)" value={formatMXN(mineView.totalCents)} strong />
        {mine.slice(0, 5).map((s) => (
          <Row key={s.saleId} label={`${s.folio} · ${formatMxDateTime(s.createdAt).slice(11)}${s.type === 'limpia' ? ' · Limpia' : ''}${s.status === 'cancelada' ? ' · CANCELADO' : ''}`} value={formatMXN(s.totalCents)} />
        ))}
        {mine.length === 0 && today ? <Muted>Todavía no hay ventas tuyas hoy. Las ventas anteriores a la versión 2 no traen empleado y no se asignan.</Muted> : null}
        <Button title="Consultar tickets de hoy" variant="secondary" onPress={() => router.push('/today')} />
      </Card>

      <SalesCharts />

      <H2>Gerencia</H2>
      <MenuItem title="Resumen de ventas de hoy" subtitle="Vendido, netas, tickets y efectivo esperado" onPress={() => router.push('/summary')} />
      <MenuItem title="Caja" subtitle="Abrir, cerrar y ticket de cierre" onPress={() => router.push('/cash')} />
      <MenuItem title="Limpias" subtitle="Armar una limpia con artículos y servicio" onPress={() => router.push('/limpias')} />
      <MenuItem title="Etiquetas" subtitle="Vista previa e impresión de etiquetas" onPress={() => router.push('/labels')} />
      <MenuItem title="Extras" subtitle="Categorías que admiten el botón Extra" onPress={() => router.push('/extras')} />
      <MenuItem title="Tokens de seguridad" subtitle="Permisos con duración para cerrar, devolver o cancelar" onPress={() => router.push('/tokens')} />

      <Button title="Ir a Inicio (venta e inventario)" variant="dark" onPress={() => router.replace('/home')} />
    </Screen>
  );
}
