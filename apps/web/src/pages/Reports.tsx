import { useMemo, useState } from 'react';
import { PAYMENT_METHODS, PROFIT_DISCLAIMER, type SalesSummary } from '@amara/shared';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { dayLabel, formatMXN, formatQty, monthLabelLong, toCsv } from '../lib/format.ts';
import { monthRange, mxTodayKey, weekRange, type DayRange } from '../lib/dates.ts';
import { bestMonth, pickSummary } from '../lib/dashboard.ts';
import { downloadText } from '../lib/download.ts';
import type { MonthsResponse } from '../lib/types.ts';
import { Alert, Card, Empty, ErrorBox, KpiCard, PageHeader, Spinner, TableWrap, Tabs } from '../components/ui.tsx';
import { DateRangeBar } from '../components/common.tsx';
import { useBranches } from '../context.tsx';

type Kind = 'diario' | 'semanal' | 'mensual' | 'fechas';

const KINDS: { id: Kind; label: string }[] = [
  { id: 'diario', label: 'Diario' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'mensual', label: 'Mensual' },
  { id: 'fechas', label: 'Por fechas' },
];
const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' } as const;
const EACH = '__each';

export function Reports() {
  const { branches } = useBranches();
  const today = mxTodayKey();
  const [kind, setKind] = useState<Kind>('diario');
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [custom, setCustom] = useState<DayRange>({ from: monthRange(today).from, to: today });
  const [scope, setScope] = useState(''); // '' = consolidado, EACH = una fila por sucursal, otro = id

  const range: DayRange = useMemo(() => {
    if (kind === 'diario') return { from: day, to: day };
    if (kind === 'semanal') return weekRange(day);
    if (kind === 'mensual') return /^\d{4}-\d{2}$/.test(month) ? monthRange(`${month}-01`) : { from: '', to: '' };
    return custom;
  }, [kind, day, month, custom]);
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to;

  const res = useAsync(
    async (signal) => {
      const q = (branchId: string) => ({ from: range.from, to: range.to, branchId });
      const fetchSummary = (branchId: string) => api.get<unknown>('/stats/summary', q(branchId), signal).then(pickSummary);
      const main = await fetchSummary(scope === EACH ? '' : scope);
      const months =
        kind === 'mensual' || kind === 'fechas'
          ? await api
              .get<{ months?: MonthsResponse['months']; best?: MonthsResponse['best'] }>('/stats/months', q(scope === EACH ? '' : scope), signal)
              .then((r) => ({ months: r?.months ?? [], best: r?.best ?? bestMonth(r?.months ?? []) }))
          : null;
      const perBranch =
        scope === EACH ? await Promise.all(branches.map(async (b) => ({ branch: b, summary: await fetchSummary(b.id) }))) : [];
      return { main, months, perBranch };
    },
    [range.from, range.to, scope, kind, branches],
    valid,
  );

  const title = `Informe ${kind === 'fechas' ? 'por fechas' : kind} ${range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} al ${dayLabel(range.to)}`}`;
  const scopeName = scope === '' ? 'Consolidado (todas las sucursales)' : scope === EACH ? 'Por sucursal' : branches.find((b) => b.id === scope)?.name ?? '';

  const exportCsv = (s: SalesSummary) => {
    const rows: (string | number)[][] = [
      ['Informe', title],
      ['Alcance', scopeName],
      ['Naturaleza', 'Informe agregado; no es un corte de caja'],
      [],
      ['Concepto', 'Importe (MXN)'],
      ['Vendido (bruto)', s.grossCents / 100],
      ['Cancelaciones', s.cancelledCents / 100],
      ['Devoluciones', s.refundedCents / 100],
      ['Ventas netas', s.netCents / 100],
      ['Costo de mercancía vendida', s.cogsCents / 100],
      ['Utilidad bruta estimada', s.grossProfitCents / 100],
      ['Tickets', s.ticketCount],
      ['Unidades vendidas', s.unitsSold],
      [],
      ['Método', 'Bruto', 'Devuelto', 'Neto'],
      ...PAYMENT_METHODS.map((m) => [METHOD_LABEL[m], s.byMethod[m].grossCents / 100, s.byMethod[m].refundedCents / 100, s.byMethod[m].netCents / 100]),
      [],
      ['Producto', 'Unidades', 'Importe (MXN)'],
      ...s.topByRevenue.map((p) => [p.name, p.units, p.revenueCents / 100]),
      [],
      ['Nota', PROFIT_DISCLAIMER],
    ];
    downloadText(`informe-${range.from}_${range.to}.csv`, toCsv([], rows));
  };

  const s = res.data?.main ?? null;

  return (
    <>
      <PageHeader
        title="Informes"
        subtitle="Informes agregados de ventas por fecha de cada registro."
        actions={
          <>
            <button type="button" className="btn" disabled={!s} onClick={() => s && exportCsv(s)}>Exportar CSV</button>
            <button type="button" className="btn btn-primary" disabled={!s} onClick={() => window.print()}>Imprimir</button>
          </>
        }
      />
      <Alert tone="info" title="Esto es un informe agregado, no un corte de caja">
        Resume ventas, cancelaciones y devoluciones del período. El efectivo esperado y contado solo existen en los cortes de caja.
      </Alert>
      <Tabs value={kind} onChange={setKind} items={KINDS} />
      <div className="filters no-print">
        {(kind === 'diario' || kind === 'semanal') && (
          <label className="inline-field">
            <span>{kind === 'diario' ? 'Día' : 'Cualquier día de la semana'}</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        )}
        {kind === 'mensual' && (
          <label className="inline-field">
            <span>Mes</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        )}
        {kind === 'fechas' && <DateRangeBar from={custom.from} to={custom.to} onChange={(from, to) => setCustom({ from, to })} />}
        <label className="inline-field">
          <span>Alcance</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Consolidado (todas)</option>
            <option value={EACH}>Una fila por sucursal</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      {!valid && <Alert tone="warn">Elige un período válido.</Alert>}
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && !s && <Empty>El servidor no devolvió cifras para este período.</Empty>}
      {s && res.data && (
        <div className="print-area report">
          <h2 className="report-title">{title}</h2>
          <p className="muted">{scopeName} &middot; Informe agregado (no es corte de caja) &middot; Horario de México</p>

          <div className="kpi-row">
            <KpiCard kind="importe" title="Ventas netas" value={formatMXN(s.netCents)} sub={`Bruto ${formatMXN(s.grossCents)} - cancelaciones ${formatMXN(s.cancelledCents)} - devoluciones ${formatMXN(s.refundedCents)}`} />
            <KpiCard kind="conteo" title="Tickets" value={formatQty(s.ticketCount)} sub={`Promedio ${formatMXN(s.avgTicketCents)} · ${s.cancelledCount} cancelado(s) · ${s.refundCount} devolución(es)`} />
            <KpiCard kind="unidades" title="Unidades vendidas" value={`${formatQty(s.unitsSold)} u.`} />
            <KpiCard kind="costo" title="Costo de mercancía vendida" value={formatMXN(s.cogsCents)} />
            <KpiCard kind="utilidad" title="Utilidad bruta estimada" value={formatMXN(s.grossProfitCents)} note={PROFIT_DISCLAIMER} />
            {res.data.months?.best && (
              <KpiCard kind="importe" title="Mes con mayor importe" value={monthLabelLong(res.data.months.best.month)} sub={formatMXN(res.data.months.best.netCents)} />
            )}
          </div>

          {res.data.perBranch.length > 0 && (
            <Card title="Por sucursal">
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Sucursal</th><th className="num">Tickets</th><th className="num">Unidades</th><th className="num">Ventas netas</th><th className="num">Costo</th><th className="num">Utilidad bruta est.</th></tr></thead>
                  <tbody>
                    {res.data.perBranch.map(({ branch, summary }) => (
                      <tr key={branch.id}>
                        <td>{branch.name}</td>
                        {summary ? (
                          <>
                            <td className="num">{formatQty(summary.ticketCount)}</td>
                            <td className="num">{formatQty(summary.unitsSold)}</td>
                            <td className="num strong">{formatMXN(summary.netCents)}</td>
                            <td className="num">{formatMXN(summary.cogsCents)}</td>
                            <td className="num">{formatMXN(summary.grossProfitCents)}</td>
                          </>
                        ) : <td colSpan={5} className="muted">Sin datos</td>}
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td>Consolidado</td>
                      <td className="num">{formatQty(s.ticketCount)}</td>
                      <td className="num">{formatQty(s.unitsSold)}</td>
                      <td className="num">{formatMXN(s.netCents)}</td>
                      <td className="num">{formatMXN(s.cogsCents)}</td>
                      <td className="num">{formatMXN(s.grossProfitCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}

          <Card title="Por método de pago">
            <TableWrap>
              <table className="table">
                <thead><tr><th>Método</th><th className="num">Cobrado</th><th className="num">Devuelto</th><th className="num">Neto</th></tr></thead>
                <tbody>
                  {PAYMENT_METHODS.map((m) => (
                    <tr key={m}>
                      <td>{METHOD_LABEL[m]}</td>
                      <td className="num">{formatMXN(s.byMethod[m].grossCents)}</td>
                      <td className="num">{formatMXN(s.byMethod[m].refundedCents)}</td>
                      <td className="num strong">{formatMXN(s.byMethod[m].netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="muted small">El cobro en efectivo de este informe no es el efectivo esperado en caja (que depende del fondo, retiros y gastos).</p>
          </Card>

          <div className="two-col">
            <Card title="Más vendidos (unidades)">
              <RankTable rows={s.topByUnits} />
            </Card>
            <Card title="Mayores ingresos (importe)">
              <RankTable rows={s.topByRevenue} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function RankTable({ rows }: { rows: SalesSummary['topByUnits'] }) {
  if (rows.length === 0) return <Empty>Sin ventas.</Empty>;
  return (
    <TableWrap>
      <table className="table">
        <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Importe</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.variantId}><td>{r.name}</td><td className="num">{formatQty(r.units)}</td><td className="num">{formatMXN(r.revenueCents)}</td></tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
