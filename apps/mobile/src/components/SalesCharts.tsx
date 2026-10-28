/** Panel de gráficas de ventas generales (solo gerente): día/mes, selector de tipo de gráfica, detalle al tocar un día o mes. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { formatMXN, mxTodayKey } from '@amara/shared';
import { Banner, Card, Chip, ChipRow, H2, Loading, Muted, Row } from './ui';
import { ChartKindSelector, ChartView } from './charts';
import { useChartKind } from '../hooks-v2';
import { bucketLabelLong, buildChartData, defaultRange, hasAnySales, latestBucketWithSales, pieSlices, rankingFor, topOfBucket } from '../lib/charts';
import type { Granularity, TopProductsSeries } from '../lib/charts';
import { SeriesForbiddenError, loadTopSeries } from '../services/stats-series';
import type { SeriesLoad } from '../services/stats-series';
import { useApp } from '../state/AppContext';
import { colors, space } from '../theme';

export function SalesCharts() {
  const app = useApp();
  const { store, device, online, api } = app;
  const [kind, setKind] = useChartKind();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [load, setLoad] = useState<SeriesLoad<TopProductsSeries> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [bucket, setBucket] = useState<string | null>(null);
  const [slice, setSlice] = useState<number | null>(null);
  const req = useRef(0);
  const today = mxTodayKey();
  const range = useMemo(() => defaultRange(granularity, today), [granularity, today]);

  const refresh = useCallback(async () => {
    if (!store || !device) return;
    const id = ++req.current;
    setBusy(true);
    try {
      const r = await loadTopSeries({ api, store, online, branchId: device.branchId }, { granularity, from: range.from, to: range.to, limit: 5 });
      if (id !== req.current) return;
      setLoad(r);
      setError(null);
      setBucket((cur) => (cur && r.data.buckets.some((b) => b.bucket === cur) ? cur : latestBucketWithSales(r.data)));
      setSlice(null);
    } catch (e) {
      if (id === req.current) setError(e instanceof SeriesForbiddenError ? e.message : e instanceof Error ? e.message : 'No se pudo cargar la gráfica.');
    } finally {
      if (id === req.current) setBusy(false);
    }
  }, [store, device, api, online, granularity, range.from, range.to]);

  useEffect(() => {
    void refresh();
  }, [refresh, app.dataVersion]);

  const chart = useMemo(() => (load ? buildChartData(load.data, granularity, range) : null), [load, granularity, range]);
  const ranking = useMemo(() => (load ? rankingFor(load.data, bucket) : []), [load, bucket]);
  const slices = useMemo(() => pieSlices(ranking, 6), [ranking]);
  const top = load && bucket ? topOfBucket(load.data, bucket) : null;

  return (
    <Card>
      <H2>Ventas generales</H2>
      <Muted>Unidades vendidas de los productos más vendidos. Toca un {granularity === 'day' ? 'día' : 'mes'} para ver su ranking.</Muted>
      <ChipRow>
        <Chip label="Por día (30 días)" selected={granularity === 'day'} onPress={() => setGranularity('day')} />
        <Chip label="Por mes (12 meses)" selected={granularity === 'month'} onPress={() => setGranularity('month')} />
      </ChipRow>
      <ChartKindSelector value={kind} onChange={setKind} />
      {load?.source === 'local' ? <Banner kind="warn" title="Datos locales" text={load.note ?? ''} /> : null}
      {error ? <Banner kind="error" text={error} /> : null}
      {busy && !load ? <Loading /> : null}
      {load && chart ? (
        hasAnySales(load.data) ? (
          <>
            <ChartView kind={kind} data={chart} slices={slices} selectedBucket={bucket} onSelectBucket={setBucket} selectedSlice={slice} onSelectSlice={setSlice} />
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
                {bucket ? `Detalle de ${bucketLabelLong(bucket, granularity)}` : 'Detalle del periodo'}
              </Text>
              {bucket ? (top ? <Muted>Producto más vendido: {top.name} ({top.qty})</Muted> : <Muted>Sin ventas en ese periodo.</Muted>) : null}
              {ranking.slice(0, 5).map((p, i) => (
                <Row key={p.productId} label={`${i + 1}. ${p.name}`} value={`${p.qty} u. · ${formatMXN(p.netCents)}`} />
              ))}
              {ranking.length === 0 ? <Muted>No hay ventas que mostrar.</Muted> : null}
            </View>
          </>
        ) : (
          <Muted style={{ paddingVertical: space.md }}>No hay ventas en este periodo para graficar.</Muted>
        )
      ) : null}
    </Card>
  );
}
