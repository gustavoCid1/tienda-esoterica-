/**
 * Notificaciones (SOLO gerente): productos en o bajo su mínimo. En línea usa GET /stats/low-stock; sin conexión, las
 * existencias guardadas en el teléfono. El aviso del teléfono es LOCAL (no push): ver el texto de la pantalla.
 */
import React from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, H1, H2, Loading, Muted, Screen } from '../src/components/ui';
import { StatusBanner } from '../src/components/StatusBanner';
import { isLegacyNegative, severityOf, shownQty } from '../src/lib/low-stock';
import { useAlerts } from '../src/state/AlertsContext';
import { useApp } from '../src/state/AppContext';
import { colors, radius, space } from '../src/theme';

export default function Notifications() {
  const app = useApp();
  const alerts = useAlerts();
  const router = useRouter();
  if (!app.session) return <Loading />;
  if (!app.can('estadisticas.ver')) return <Screen><Banner kind="error" text="Solo el gerente puede ver las notificaciones de existencias." /></Screen>;

  const bg = alerts.background;
  return (
    <Screen edges={['left', 'right']} refreshControl={<RefreshControl refreshing={alerts.loading} onRefresh={() => void alerts.refresh()} tintColor={colors.gold} />}>
      <H1>Notificaciones</H1>
      <StatusBanner compact />
      <Card tone="gold">
        <H2>{alerts.counts.total} {alerts.counts.total === 1 ? 'producto' : 'productos'} en o bajo su mínimo</H2>
        <Muted>
          {alerts.counts.agotados} agotados · {alerts.counts.bajos} en su mínimo
        </Muted>
        {alerts.source === 'local' ? <Banner kind="warn" title="Datos locales" text={alerts.note ?? 'Se muestran las existencias guardadas en este teléfono.'} /> : null}
        {alerts.error ? <Banner kind="error" text={alerts.error} /> : null}
      </Card>

      {alerts.items.length === 0 && !alerts.loading ? <Muted>Ningún producto está en su mínimo.</Muted> : null}
      {alerts.items.map((i) => {
        const out = severityOf(i) === 'agotado';
        return (
          <View key={`${i.variantId}-${i.branchId}`} style={[styles.item, out && styles.itemOut]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{i.productName}</Text>
              <Text style={styles.sub}>{i.label}{i.category ? ` · ${i.category}` : ''}</Text>
              <Text style={styles.sub}>Mínimo: {i.minStock}</Text>
              {isLegacyNegative(i.qty) ? <Text style={styles.warn}>Existencia por corregir (era negativa por una venta sin conexión). Revisa el conteo.</Text> : null}
            </View>
            <View style={styles.qty}>
              <Text style={[styles.qtyNum, out && { color: colors.danger }]}>{shownQty(i.qty)}</Text>
              <Text style={styles.qtyLabel}>{out ? 'Agotado' : 'Bajo'}</Text>
            </View>
          </View>
        );
      })}

      <Card>
        <H2>Aviso en el teléfono</H2>
        <Muted>
          Cuando aparecen productos NUEVOS en su mínimo, esta app muestra una notificación local en el teléfono al abrir la app y al sincronizar, sin repetir la misma alerta.
        </Muted>
        <Banner
          kind="warn"
          title="Aviso honesto"
          text="Con la app cerrada del todo NO hay aviso en tiempo real: eso necesita un servicio de notificaciones push (FCM / Expo push) que todavía no está configurado. Mientras tanto, Android puede ejecutar una revisión periódica en segundo plano (cada 15 minutos como mínimo, cuando el sistema lo permite y sin garantía)."
        />
        <Muted>
          Permiso de notificaciones: {alerts.permission === 'concedido' ? 'concedido' : alerts.permission === 'denegado' ? 'denegado (actívalo en los ajustes de Android)' : alerts.permission === 'no_disponible' ? 'no disponible en este entorno' : 'sin pedir todavía'}.
        </Muted>
        <Muted>
          Revisión en segundo plano: {bg === 'activa' ? 'registrada (la ejecuta Android cuando puede)' : bg === 'restringida' ? 'restringida por el sistema (ahorro de batería)' : bg === 'no_disponible' ? 'no disponible en este entorno (por ejemplo Expo Go)' : 'revisando...'}.
        </Muted>
        {alerts.permission === 'pendiente' ? <Button title="Activar avisos del teléfono" onPress={() => void alerts.askPermission()} /> : null}
        <Button title="Revisar ahora" variant="secondary" loading={alerts.loading} onPress={() => void alerts.refresh()} />
        <Button title="Ver inventario" variant="secondary" onPress={() => router.push('/inventory')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  itemOut: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
  warn: { fontSize: 13, color: colors.danger, fontWeight: '700' },
  qty: { minWidth: 64, alignItems: 'center', borderRadius: radius.sm, padding: space.sm, backgroundColor: colors.surface },
  qtyNum: { fontSize: 20, fontWeight: '900', color: colors.text },
  qtyLabel: { fontSize: 12, color: colors.muted, fontWeight: '700' },
});
