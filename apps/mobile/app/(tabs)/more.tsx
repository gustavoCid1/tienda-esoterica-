/** Más: accesos a las demás funciones. Las opciones se muestran u ocultan según el rol; el servidor igualmente autoriza. */
import React from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, H2, Loading, MenuItem, Muted, Screen, Spacer } from '../../src/components/ui';
import { StatusBanner } from '../../src/components/StatusBanner';
import { useApp } from '../../src/state/AppContext';
import { useCart } from '../../src/state/CartContext';
import { useAlerts } from '../../src/state/AlertsContext';
import { badgeText } from '../../src/lib/low-stock';

export default function More() {
  const app = useApp();
  const cart = useCart();
  const alerts = useAlerts();
  const router = useRouter();
  if (!app.session || !app.device) return <Loading />;

  const pending = app.sync.status?.pending ?? 0;
  const branch = app.myBranches.find((b) => b.id === app.device?.branchId);

  return (
    <Screen edges={['left', 'right']}>
      <StatusBanner compact />
      <H2>Vender</H2>
      <MenuItem title="Venta de emergencia" subtitle="Funciona sin internet; se envía al reconectar" badge={cart.units > 0 ? String(cart.units) : undefined} onPress={() => router.push('/cart')} />

      <MenuItem title="Limpias" subtitle={app.session.user.role === 'gerente' ? 'Armar una limpia con artículos y servicio' : 'Pide contraseña de administrador o token'} onPress={() => router.push('/limpias')} />
      <MenuItem title="Caja" subtitle="Abrir y cerrar caja (el cierre pide autorización)" onPress={() => router.push('/cash')} />

      <H2>Inventario</H2>
      <MenuItem title="Etiquetas" subtitle="Vista previa, imprimir o guardar PDF" onPress={() => router.push('/labels')} />
      <MenuItem title="Entradas de mercancía" subtitle={app.can('inventario.mover') ? 'Registrar mercancía que llega' : 'Solo con permiso temporal del gerente'} onPress={() => router.push('/entry')} />
      <MenuItem title="Códigos QR y de barras" subtitle="Consultar y mostrar códigos de un producto" onPress={() => router.push('/codes')} />

      {app.can('estadisticas.ver') ? (
        <>
          <H2>Gerencia</H2>
          <MenuItem title="Panel administrativo" subtitle="Mis ventas, gráficas y notificaciones" onPress={() => router.push('/admin')} />
          {alerts.enabled ? <MenuItem title="Notificaciones" subtitle="Productos en o bajo su mínimo" badge={alerts.counts.total > 0 ? badgeText(alerts.counts.total) : undefined} onPress={() => router.push('/notifications')} /> : null}
          <MenuItem title="Tickets de hoy" subtitle="Lo vendido hoy, cierre y permiso" onPress={() => router.push('/today')} />
          <MenuItem title="Resumen de ventas de hoy" subtitle="Vendido, netas, tickets y efectivo esperado" onPress={() => router.push('/summary')} />
          <MenuItem title="Extras" subtitle="Categorías con botón Extra" onPress={() => router.push('/extras')} />
          <MenuItem title="Tokens de seguridad" subtitle="Crear, ver y revocar (en línea)" onPress={() => router.push('/tokens')} />
        </>
      ) : null}

      <H2>Conexión</H2>
      <MenuItem title="Sincronización" subtitle={pending > 0 ? `${pending} pendientes por enviar` : 'Todo enviado'} onPress={() => router.push('/sync')} />
      <MenuItem title="Vincular con la PC" subtitle="Usar el teléfono como escáner o imprimir en la PC" onPress={() => router.push('/pc-link')} />

      <H2>Cuenta y terminal</H2>
      <MenuItem title="Cambiar de sucursal" subtitle={branch?.name ?? ''} onPress={() => router.push('/branch')} />
      <MenuItem title="Terminal" subtitle={`Código ${app.device.terminalCode}`} onPress={() => router.push('/terminal-setup')} />
      <MenuItem title="Compatibilidad de escáner e impresión" onPress={() => router.push('/about')} />

      <Spacer />
      <Muted>
        Sesión de {app.session.user.name} ({app.session.user.role}){app.session.mode === 'offline' ? ', iniciada sin conexión' : ''}.
      </Muted>
      <Button
        title="Cerrar sesión"
        variant="secondary"
        onPress={() => {
          const lost = pending > 0 ? `\n\nHay ${pending} operaciones sin enviar. NO se pierden: quedan guardadas y se enviarán al volver a entrar con conexión.` : '';
          Alert.alert('Cerrar sesión', `¿Salir de la cuenta?${lost}`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Salir', style: 'destructive', onPress: () => void app.logout() }]);
        }}
      />
    </Screen>
  );
}
