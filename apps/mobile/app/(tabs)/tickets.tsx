/**
 * Tickets (consulta y reimpresión). El gerente ve todos los de esta terminal/sucursal (tickets.archivo);
 * el vendedor solo los propios (ventas.ver_propias). Los datos son los de ESTE teléfono (ventas hechas
 * aquí o replicadas por la PC); el archivo completo está en el servidor / la web.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatMXN, formatMxDateTime, mxDayBounds, mxTodayKey } from '@amara/shared';
import { Banner, Chip, ChipRow, Loading, Muted } from '../../src/components/ui';
import { useApp } from '../../src/state/AppContext';
import { addDays } from '../../src/lib/date-range';
import { colors, radius, space } from '../../src/theme';

interface Row {
  id: string;
  folio: string;
  createdAt: string;
  totalCents: number;
  status: string;
  syncState: string;
  userName: string;
}

type Span = 'hoy' | '7' | '30';

export default function Tickets() {
  const app = useApp();
  const router = useRouter();
  const { store, device, session } = app;
  const [rows, setRows] = useState<Row[]>([]);
  const [folio, setFolio] = useState('');
  const [span, setSpan] = useState<Span>('hoy');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!store || !device || !session) return;
    try {
      const today = mxTodayKey();
      const fromDay = span === 'hoy' ? today : addDays(today, span === '7' ? -6 : -29);
      const r = await store.listSales({
        from: mxDayBounds(fromDay).from,
        to: mxDayBounds(today).to,
        branchId: device.branchId,
        folio: folio.trim() || undefined,
        // El vendedor SOLO ve sus tickets; el gerente ve todos.
        userId: app.can('tickets.archivo') ? undefined : session.user.id,
        limit: 300,
      });
      setRows(r as Row[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer los tickets.');
    }
  }, [store, device, session, span, folio, app]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, app.dataVersion]),
  );

  if (!store || !device) return <Loading />;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.top}>
        <TextInput style={styles.search} value={folio} onChangeText={setFolio} placeholder="Buscar por folio" placeholderTextColor="#8A8A8A" autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Buscar por folio" />
        <ChipRow>
          <Chip label="Hoy" selected={span === 'hoy'} onPress={() => setSpan('hoy')} />
          <Chip label="7 días" selected={span === '7'} onPress={() => setSpan('7')} />
          <Chip label="30 días" selected={span === '30'} onPress={() => setSpan('30')} />
        </ChipRow>
        {!app.can('tickets.archivo') ? <Muted>Solo se muestran tus ventas.</Muted> : null}
        {error ? <Banner kind="error" text={error} /> : null}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.gold}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={<Muted style={styles.empty}>No hay tickets en este periodo.</Muted>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/ticket/${item.id}`)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.folio}>{item.folio}</Text>
              <Text style={styles.sub}>
                {formatMxDateTime(item.createdAt)} · {item.userName}
              </Text>
              <Text style={styles.sub}>{item.syncState === 'pendiente' ? 'Pendiente de enviar' : item.syncState === 'sincronizada' ? 'Enviada' : item.syncState === 'conflicto' ? 'Enviada con diferencia (revisa al gerente)' : item.syncState}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.total}>{formatMXN(item.totalCents)}</Text>
              {item.status === 'cancelada' ? <Text style={styles.cancel}>CANCELADA</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { padding: space.lg, gap: space.sm },
  search: { minHeight: 52, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, color: colors.text, backgroundColor: colors.white },
  list: { paddingHorizontal: space.lg, paddingBottom: 32, gap: space.sm },
  empty: { textAlign: 'center', margin: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  folio: { fontSize: 15, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.muted },
  total: { fontSize: 17, fontWeight: '900', color: colors.text },
  cancel: { fontSize: 12, fontWeight: '800', color: colors.danger },
});
