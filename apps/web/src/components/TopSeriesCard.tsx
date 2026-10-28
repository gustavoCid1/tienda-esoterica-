/**
 * Productos más vendidos por día o por mes (GET /stats/top-products-series), con selector de tipo
 * de gráfica (líneas, barras o pastel). Al tocar un punto/barra, o al elegir un periodo en la lista,
 * se muestra el producto MÁS vendido de ese día o mes y el ranking completo de ese periodo.
 * Unidades vendidas, nunca importe: el importe del ranking se rotula aparte.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { formatMXN, formatQty } from '../lib/format.ts';
import {
  CHART_KINDS, bucketLabel, bucketLabelLong, buildChartData, normalizeTopSeries, pieSlices, rankingFor, seriesRange, topOfBucket,
} from '../lib/series.ts';
import type { ChartKind, SeriesGranularity } from '../lib/types-v2.ts';
import { Card, Empty, ErrorBox, Spinner, TableWrap } from './ui.tsx';

const GRANULARITIES: { id: SeriesGranularity; label: string }[] = [
  { id: 'day', label: 'Por día' },
  { id: 'month', label: 'Por mes' },
];

interface Props {
  branchId: string;
  range: { from: string; to: string };
  chartKind: ChartKind;
  onChartKind: (k: ChartKind) => void;
}

export function TopSeriesCard({ branchId, range, chartKind, onChartKind }: Props) {
  const [granularity, setGranularity] = useState<SeriesGranularity>('day');
  const [selected, setSelected] = useState<string | null>(null);
  const req = useMemo(() => seriesRange(granularity, range), [granularity, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const validRange = req.from !== '' && req.to !== '' && req.from <= req.to;

  const res = useAsync(
    (signal) => api.get<unknown>('/stats/top-products-series', { from: req.from, to: req.to, granularity, branchId, limit: 5 }, signal),
    [req.from, req.to, granularity, branchId],
    validRange,
  );

  // Al cambiar de día/mes, sucursal o fechas, la selección anterior ya no aplica.
  useEffect(() => setSelected(null), [granularity, req.from, req.to, branchId]);

  const data = useMemo(() => normalizeTopSeries(res.data), [res.data]);
  const chart = useMemo(() => buildChartData(data, granularity, req), [data, granularity, req]);
  const ranking = useMemo(() => rankingFor(data, selected), [data, selected]);
  const top = selected ? topOfBucket(data, selected) : null;
  const slices = useMemo(() => pieSlices(ranking), [ranking]);
  const withSales = data.buckets.filter((b) => topOfBucket(data, b.bucket));

  const pick = (state: { activeLabel?: string | number } | null | undefined) => {
    const label = state?.activeLabel;
    if (label !== undefined && label !== null) setSelected(String(label));
  };

  const tickLabel = (b: unknown) => bucketLabel(String(b), granularity);
  const tipLabel = (b: unknown) => bucketLabelLong(String(b), granularity);
  const hasData = withSales.length > 0 && chart.keys.length > 0;

  return (
    <Card
      title="Productos más vendidos por día o mes (unidades)"
      actions={
        <div className="series-controls">
          <div className="chips" role="radiogroup" aria-label="Agrupar por">
            {GRANULARITIES.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={granularity === g.id} className={`chip ${granularity === g.id ? 'chip-active' : ''}`} onClick={() => setGranularity(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="chips" role="radiogroup" aria-label="Tipo de gráfica">
            {CHART_KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={chartKind === k.id} className={`chip ${chartKind === k.id ? 'chip-active' : ''}`} onClick={() => onChartKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {granularity === 'month' && <p className="muted small">Se muestran los 12 meses que terminan en la fecha "hasta" del tablero.</p>}
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {!!res.data && !hasData && <Empty>No hubo ventas de productos en este periodo.</Empty>}
      {!!res.data && hasData && (
        <>
          <div className="chart" role="img" aria-label={`Gráfica de ${chartKind === 'line' ? 'líneas' : chartKind === 'bar' ? 'barras' : 'pastel'} de productos más vendidos`}>
            <ResponsiveContainer width="100%" height={300}>
              {chartKind === 'line' ? (
                <LineChart data={chart.rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} onClick={pick}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} tickFormatter={tickLabel} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={40} />
                  <Tooltip labelFormatter={tipLabel} />
                  <Legend />
                  {chart.keys.map((k) => (
                    <Line key={k.key} type="monotone" dataKey={k.key} name={k.name} stroke={k.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              ) : chartKind === 'bar' ? (
                <BarChart data={chart.rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} onClick={pick}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} tickFormatter={tickLabel} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={40} />
                  <Tooltip labelFormatter={tipLabel} />
                  <Legend />
                  {chart.keys.map((k) => (
                    <Bar key={k.key} dataKey={k.key} name={k.name} fill={k.color} />
                  ))}
                </BarChart>
              ) : (
                <PieChart>
                  <Tooltip formatter={(v) => `${v} u.`} />
                  <Legend />
                  <Pie data={slices} dataKey="value" nameKey="name" outerRadius={110} label={(e: { name?: string; value?: number }) => `${e.name ?? ''}: ${e.value ?? 0}`}>
                    {slices.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                </PieChart>
              )}
            </ResponsiveContainer>
          </div>
          {chartKind === 'pie' && (
            <p className="muted small">El pastel muestra la proporción de unidades de {selected ? bucketLabelLong(selected, granularity) : 'todo el periodo'}.</p>
          )}

          <div className="series-pick">
            <label className="inline-field grow">
              <span>{granularity === 'day' ? 'Elegir un día' : 'Elegir un mes'} (o toca la gráfica)</span>
              <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}>
                <option value="">Todo el periodo</option>
                {withSales.map((b) => (
                  <option key={b.bucket} value={b.bucket}>
                    {bucketLabelLong(b.bucket, granularity)} · {topOfBucket(data, b.bucket)?.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="series-detail" aria-live="polite">
            {selected ? (
              <p className="series-top">
                <strong>{bucketLabelLong(selected, granularity)}:</strong>{' '}
                {top ? (
                  <>
                    el producto más vendido fue <strong>{top.name}</strong> con {formatQty(top.qty)} u.
                  </>
                ) : (
                  'no hubo ventas de productos.'
                )}
              </p>
            ) : (
              <p className="muted small">Toca un {granularity === 'day' ? 'día' : 'mes'} en la gráfica para ver qué producto se vendió más ese {granularity === 'day' ? 'día' : 'mes'}. Abajo, el ranking de todo el periodo.</p>
            )}
            {ranking.length > 0 && (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Producto</th>
                      <th className="num">Unidades vendidas</th>
                      <th className="num">Importe de ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.slice(0, 10).map((p, i) => (
                      <tr key={p.productId} className={i === 0 ? 'row-top' : ''}>
                        <td className="num">{i + 1}</td>
                        <td>{p.name}</td>
                        <td className="num strong">{formatQty(p.qty)}</td>
                        <td className="num">{formatMXN(p.netCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
