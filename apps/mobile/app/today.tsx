/**
 * Consultar tickets de hoy (SOLO gerente): muestra lo VENDIDO (producto, cantidad, precio) y el importe de cada ticket,
 * NO el ticket impreso. El ticket completo solo se abre si el gerente lo pide con el botón. Desde aquí también se genera el
 * ticket de cierre (de la última caja cerrada de esta terminal) y se llega a "ticket de permiso" (que necesita el código
 * recién creado de un token, así que se genera en la pantalla de Tokens).
 */
import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMXN, formatMxDateTime } from '@amara/shared';
import { Banner, Button, Card, Divider, H1, Loading, Muted, Row, Screen } from '../src/components/ui';
import { DocPreview } from '../src/components/DocPreview';
import { PermitButton } from '../src/components/PermitButton';
import { StatusBanner } from '../src/components/StatusBanner';
import { loadClosureTicketData } from '../src/lib/closure-data';
import { closureHtml } from '../src/lib/documents';
import { summarizeToday } from '../src/lib/misc-v2';
import { loadToday } from '../src/services/today';
import type { TodayLoad } from '../src/services/today';
import { useApp } from '../src/state/AppContext';
import { colors, space } from '../src/theme';

export default function Today() {
  const app = useApp();
  const router = useRouter();
  const { store, device, session, online, api } = app;
  const [data, setData] = useState<TodayLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [closureDoc, setClosureDoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store || !device) return;
    try {
      setData(await loadToday({ api, store, online, branchId: device.branchId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los tickets.');
    }
  }, [store, device, api, online]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, app.dataVersion]),
  );

  if (!store || !device || !session) return <Loading />;
  if (!app.can('tickets.archivo')) return <Screen><Banner kind="error" text="Solo el gerente puede consultar los tickets de hoy." /></Screen>;

  async function openFull(saleId: string) {
    if (!store) return;
    const sale = await store.getSale(saleId);
    if (!sale) {
      setNotice('Ese ticket no está guardado en este teléfono (se vendió en otro equipo). Consúltalo en la web o en esa terminal.');
      return;
    }
    setNotice(null);
    router.push(`/ticket/${saleId}`);
  }

  async function makeClosure() {
    if (!store || !device) return;
    setNotice(null);
    const closed = (await store.listClosures(20)).find((c) => c.terminalId === device.terminalId && c.branchId === device.branchId);
    if (!closed) {
      setNotice('Todavía no hay un cierre de caja en esta terminal. Cierra la caja desde "Caja" y después genera el ticket.');
      return;
    }
    const branch = app.myBranches.find((b) => b.id === device.branchId);
    const d = await loadClosureTicketData(store, closed.id, { branchName: branch?.name ?? device.branchCode, terminalCode: device.terminalCode });
    if (!d) {
      setNotice('No se pudo armar el ticket de cierre.');
      return;
    }
    setClosureDoc(closureHtml(d));
  }

  const view = data ? summarizeToday(data.items) : null;
  return (
    <Screen
      edges={['left', 'right']}
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
    >
      <H1>Tickets de hoy</H1>
      <StatusBanner compact />
      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="warn" text={notice} /> : null}
      {data?.source === 'local' ? <Banner kind="warn" title="Datos locales" text={data.note ?? ''} /> : null}

      <Card tone="gold">
        <Row label="Tickets" value={String(view?.count ?? 0)} />
        <Row label="Vendido (sin cancelados)" value={formatMXN(view?.totalCents ?? 0)} strong />
        <Muted>Aquí se ve lo vendido y su precio. El ticket impreso se abre solo si lo pides con "Ver ticket completo".</Muted>
      </Card>

      <Button title="Generar ticket de cierre" variant="dark" onPress={() => void makeClosure()} />
      <PermitButton title="Generar ticket de permiso" onPress={() => router.push({ pathname: '/tokens', params: { nuevo: '1' } })} />
      <Muted>El ticket de permiso lleva el código de un token y solo puede generarse mientras se muestra el código recién creado.</Muted>

      {data && data.items.length === 0 ? <Muted>No hay tickets hoy.</Muted> : null}
      {data?.items.map((s) => (
        <Card key={s.saleId} style={s.status === 'cancelada' ? styles.cancelled : undefined}>
          <View style={styles.head}>
            <Text style={styles.folio}>{s.folio}</Text>
            <Text style={styles.total}>{formatMXN(s.totalCents)}</Text>
          </View>
          <Muted>
            {formatMxDateTime(s.createdAt)}
            {s.type === 'limpia' ? ' · Limpia' : ''}
            {s.sellerName ? ` · Vendió: ${s.sellerName}` : ''}
          </Muted>
          {s.status === 'cancelada' ? <Text style={styles.cancelText}>CANCELADO</Text> : null}
          <Divider />
          {s.items.map((i, idx) => (
            <View key={idx} style={styles.line}>
              <Text style={styles.lineName}>
                {i.kind === 'extra' ? `Extra: ${i.name}${i.label ? ` (${i.label})` : ''}${i.extraNote ? ` - ${i.extraNote}` : ''}` : `${i.qty} x ${i.name}${i.label ? ` (${i.label})` : ''}`}
              </Text>
              <Text style={styles.lineVal}>{i.kind === 'extra' ? formatMXN(i.netCents) : `${formatMXN(i.unitPriceCents)} c/u`}</Text>
            </View>
          ))}
          <Button title="Ver ticket completo" variant="secondary" onPress={() => void openFull(s.saleId)} />
        </Card>
      ))}

      <DocPreview
        visible={closureDoc !== null}
        title="Ticket de cierre"
        html={closureDoc ?? ''}
        onClose={() => setClosureDoc(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  folio: { fontSize: 16, fontWeight: '800', color: colors.text },
  total: { fontSize: 18, fontWeight: '900', color: colors.text },
  cancelled: { opacity: 0.6 },
  cancelText: { color: colors.danger, fontWeight: '800', fontSize: 13 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  lineName: { flex: 1, fontSize: 15, color: colors.text },
  lineVal: { fontSize: 15, color: colors.muted },
});
