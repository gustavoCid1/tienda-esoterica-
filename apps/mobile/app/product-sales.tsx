/**
 * Ventas de un producto (SOLO gerente): gráfica del mes (líneas o barras, el tipo se recuerda) y lista de las últimas
 * ventas de ese mes. En línea usa GET /stats/product-series; sin conexión calcula con los datos de este teléfono y lo avisa.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatMXN, formatMxDateTime, mxTodayKey } from '@amara/shared';
import { Banner, Button, Card, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { ChartKindSelector, ChartView } from '../src/components/charts';
import { useChartKind } from '../src/hooks-v2';
import { addMonthsKey, bucketLabelLong, buildChartData, monthStartKey } from '../src/lib/charts';
import type { ProductSeries, TopProductsSeries } from '../src/lib/charts';
import { SeriesForbiddenError, loadProductSeries } from '../src/services/stats-series';
import type { SeriesLoad } from '../src/services/stats-series';
import { useApp } from '../src/state/AppContext';
import { colors, radius, space } from '../src/theme';

function monthEnd(monthStart: string, today: string): string {
  if (monthStart.slice(0, 7) === today.slice(0, 7)) return today;
  const next = addMonthsKey(monthStart, 1);
  return new Date(Date.parse(`${next}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export default function ProductSales() {
  const { productId, name } = useLocalSearchParams<{ productId?: string; name?: string }>();
  const app = useApp();
  const router = useRouter();
  const { store, device, online, api } = app;
  const today = mxTodayKey();
  const [kindRaw, setKind] = useChartKind();
  const kind = kindRaw === 'pie' ? 'line' : kindRaw;
  const [month, setMonth] = useState(monthStartKey(today));
  const [load, setLoad] = useState<SeriesLoad<ProductSeries> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [bucket, setBucket] = useState<string | null>(null);
  const req = useRef(0);
  const range = useMemo(() => ({ from: month, to: monthEnd(month, today) }), [month, today]);

  const refresh = useCallback(async () => {
    if (!store || !device || !productId) return;
    const id = ++req.current;
    setBusy(true);
    try {
      const r = await loadProductSeries({ api, store, online, branchId: device.branchId }, { productId, granularity: 'day', from: range.from, to: range.to });
      if (id !== req.current) return;
      setLoad(r);
      setError(null);
    } catch (e) {
      if (id === req.current) setError(e instanceof SeriesForbiddenError ? e.message : e instanceof Error ? e.message : 'No se pudo cargar la gráfica.');
    } finally {
      if (id === req.current) setBusy(false);
    }
  }, [store, device, productId, api, online, range.from, range.to]);

  useEffect(() => {
    void refresh();
  }, [refresh, app.dataVersion]);

  const chart = useMemo(() => {
    if (!load) return null;
    const asTop: TopProductsSeries = { buckets: [], series: [{ productId: productId ?? '', name: name ?? 'Producto', points: load.data.points }] };
    return buildChartData(asTop, 'day', range, 1);
  }, [load, productId, name, range]);

  if (!store || !device) return <Loading />;
  if (!app.can('estadisticas.ver')) return <Screen><Banner kind="error" text="Solo el gerente puede ver las ventas de un producto." /></Screen>;

  const picked = bucket && load ? load.data.points.find((p) => p.bucket === bucket) : null;
  const atCurrent = month.slice(0, 7) >= today.slice(0, 7);

  return (
    <Screen>
      <H1>{name ?? 'Ventas del producto'}</H1>
      <View style={styles.nav}>
        <Button title="Mes anterior" variant="secondary" onPress={() => { setMonth(addMonthsKey(month, -1)); setBucket(null); }} />
        <Button title="Mes siguiente" variant="secondary" disabled={atCurrent} onPress={() => { setMonth(addMonthsKey(month, 1)); setBucket(null); }} />
      </View>
      <Muted>{month.slice(0, 7)}</Muted>
      {error ? <Banner kind="error" text={error} /> : null}
      {load?.note ? <Banner kind="warn" text={load.note} /> : null}
      {busy && !load ? <Loading /> : null}

      {load && chart ? (
        <Card>
          <ChartKindSelector value={kind} onChange={setKind} kinds={['line', 'bar']} />
          <Row label="Unidades del mes" value={String(load.data.totalQty)} strong />
          <Row label="Importe del mes" value={formatMXN(load.data.totalNetCents)} strong />
          {load.data.totalQty === 0 && load.data.totalNetCents === 0 ? <Muted>Sin ventas de este producto en el mes.</Muted> : null}
          <ChartView kind={kind} data={chart} slices={[]} selectedBucket={bucket} onSelectBucket={setBucket} selectedSlice={null} onSelectSlice={() => undefined} />
          {picked ? (
            <Muted>
              {bucketLabelLong(picked.bucket, 'day')}: {picked.qty} u. · {formatMXN(picked.netCents)}
            </Muted>
          ) : (
            <Muted>Toca un día para ver su detalle.</Muted>
          )}
        </Card>
      ) : null}

      {load ? (
        <Card>
          <H2>Últimas ventas del mes</H2>
          {load.data.last.length === 0 ? <Muted>No hay ventas de este producto en el mes.</Muted> : null}
          {load.data.last.map((s) => (
            <Pressable key={s.saleId} accessibilityRole="button" onPress={() => router.push(`/ticket/${s.saleId}`)} style={({ pressed }) => [styles.sale, pressed && { opacity: 0.7 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.folio}>{s.folio}</Text>
                <Text style={styles.sub}>{formatMxDateTime(s.createdAt)}</Text>
              </View>
              <Text style={styles.amount}>
                {s.qty} u. · {formatMXN(s.netCents)}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { gap: space.sm },
  sale: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: radius.sm },
  folio: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.muted },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text },
});
