import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PROFIT_DISCLAIMER, type SalesSummary } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import { formatMXN, formatQty, monthLabelLong } from '../lib/format.ts';
import { monthRange, mxTodayKey, weekRange } from '../lib/dates.ts';
import {
  DEFAULT_PREFS, bestMonth, monthBars, moveWidget, normalizeDashboardExtra, normalizePrefs, pickSummary, rankBars,
  resolveWidgets, sumCashSessions, toggleHidden,
} from '../lib/dashboard.ts';
import type { CashSessionRow, DashboardExtra, DashboardPrefs, InventoryRow, MonthsResponse } from '../lib/types.ts';
import { Alert, Badge, Card, Empty, ErrorBox, KpiCard, Modal, PageHeader, Spinner, TableWrap, CloseButton } from '../components/ui.tsx';
import { BranchSelect, DateRangeBar } from '../components/common.tsx';
import { useBranches, useToast } from '../context.tsx';

/* Colores de gráficas: dorado de marca y gris oscuro; contraste suficiente sobre blanco. */
const GOLD = '#B8860B';
const GOLD_LIGHT = '#E3CF8A';
const GRAY = '#4B4B4B';

type Settled<T> = { data: T | null; error: string | null };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { data: await p, error: null };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

interface Bundle {
  today: Settled<SalesSummary | null>;
  week: Settled<SalesSummary | null>;
  month: Settled<SalesSummary | null>;
  period: Settled<SalesSummary | null>;
  months: Settled<MonthsResponse>;
  extra: Settled<DashboardExtra>;
  cash: Settled<CashSessionRow[]>;
}

export function Dashboard() {
  const { notify } = useToast();
  const { branches } = useBranches();
  const todayKey = mxTodayKey();
  const [range, setRange] = useState({ from: monthRange(todayKey).from, to: todayKey });
  const [branchId, setBranchId] = useState('');
  const [editing, setEditing] = useState(false);
  const [prefs, setPrefs] = useState<DashboardPrefs>(DEFAULT_PREFS);

  // Preferencias por usuario guardadas en el servidor. No otorgan permisos: solo orden y visibilidad.
  const prefsRes = useAsync((s) => api.get<unknown>('/prefs/dashboard', undefined, s), []);
  useEffect(() => {
    if (prefsRes.data) setPrefs(normalizePrefs(prefsRes.data));
  }, [prefsRes.data]);

  const validRange = range.from !== '' && range.to !== '' && range.from <= range.to;

  const bundle = useAsync<Bundle>(
    async (signal) => {
      const wk = weekRange(todayKey);
      const mo = monthRange(todayKey);
      const q = { branchId };
      const p = { from: range.from, to: range.to, ...q };
      const [today, week, month, period, months, extra, cash] = await Promise.all([
        settle(api.get<unknown>('/stats/today', q, signal).then(pickSummary)),
        settle(api.get<unknown>('/stats/summary', { from: wk.from, to: todayKey, ...q }, signal).then(pickSummary)),
        settle(api.get<unknown>('/stats/summary', { from: mo.from, to: todayKey, ...q }, signal).then(pickSummary)),
        settle(api.get<unknown>('/stats/summary', p, signal).then(pickSummary)),
        settle(
          api.get<{ months?: MonthsResponse['months']; best?: MonthsResponse['best'] }>('/stats/months', p, signal).then((r) => ({
            months: r?.months ?? [],
            best: r?.best ?? bestMonth(r?.months ?? []),
          })),
        ),
        settle(api.get<unknown>('/stats/dashboard', p, signal).then(normalizeDashboardExtra)),
        settle(api.get<unknown>('/cash/sessions', p, signal).then((d) => asList<CashSessionRow>(d))),
      ]);
      return { today, week, month, period, months, extra, cash };
    },
    [range.from, range.to, branchId],
    validRange,
  );

  // Ventas por sucursal: un resumen por sucursal en el período (ignora el filtro de sucursal).
  const byBranch = useAsync(
    async (signal) => {
      const rows = await Promise.all(
        branches.map(async (b) => ({
          branch: b,
          ...(await settle(api.get<unknown>('/stats/summary', { from: range.from, to: range.to, branchId: b.id }, signal).then(pickSummary))),
        })),
      );
      return rows;
    },
    [branches, range.from, range.to],
    validRange && branches.length > 0,
  );

  const widgets = useMemo(() => resolveWidgets(prefs), [prefs]);
  const b = bundle.data;

  const savePrefs = async (next: DashboardPrefs) => {
    try {
      await api.put('/prefs/dashboard', next);
      setPrefs(next);
      setEditing(false);
      notify('Tablero guardado.');
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const renderWidget = (id: string) => {
    if (!b) return null;
    switch (id) {
      case 'kpi_today':
        return <SalesKpi title="Ventas de hoy" s={b.today} sub="Desde las 00:00 (hora de México)" />;
      case 'kpi_week':
        return <SalesKpi title="Ventas de la semana" s={b.week} sub="Lunes a hoy" />;
      case 'kpi_month':
        return <SalesKpi title="Ventas del mes" s={b.month} sub="Día 1 a hoy" />;
      case 'kpi_period':
        return <SalesKpi title="Importe del período elegido" s={b.period} sub={`${range.from} a ${range.to}`} />;
      case 'kpi_tickets': {
        const s = b.period.data;
        return (
          <KpiCard
            kind="conteo"
            title="Tickets del período"
            value={s ? formatQty(s.ticketCount) : '-'}
            sub={s ? `Promedio ${formatMXN(s.avgTicketCents)} · Cancelados ${s.cancelledCount} · Devoluciones ${s.refundCount}` : b.period.error}
          />
        );
      }
      case 'kpi_units': {
        const s = b.period.data;
        return <KpiCard kind="unidades" title="Piezas vendidas (neto de devoluciones)" value={s ? `${formatQty(s.unitsSold)} u.` : '-'} sub={s ? undefined : b.period.error} />;
      }
      case 'kpi_cogs': {
        const s = b.period.data;
        return <KpiCard kind="costo" title="Costo de mercancía vendida" value={s ? formatMXN(s.cogsCents) : '-'} sub="Costo registrado al vender" />;
      }
      case 'kpi_profit': {
        const s = b.period.data;
        return (
          <KpiCard
            kind="utilidad"
            title="Utilidad bruta estimada"
            value={s ? formatMXN(s.grossProfitCents) : '-'}
            sub={s ? `Ventas netas ${formatMXN(s.netCents)} - costo ${formatMXN(s.cogsCents)}` : b.period.error}
            note={PROFIT_DISCLAIMER}
          />
        );
      }
      case 'best_month': {
        const best = b.months.data?.best;
        return (
          <KpiCard
            kind="importe"
            title="Mes con mayor importe del período"
            value={best ? monthLabelLong(best.month) : '-'}
            sub={best ? `Ventas netas ${formatMXN(best.netCents)}` : (b.months.error ?? 'Sin ventas en el período')}
          />
        );
      }
      case 'cash':
        return <CashWidget res={b.cash} />;
      case 'by_branch':
        return (
          <Card title="Ventas por sucursal (importe neto del período)">
            {byBranch.loading && !byBranch.data ? (
              <Spinner />
            ) : byBranch.error ? (
              <ErrorBox error={byBranch.error} />
            ) : !byBranch.data || byBranch.data.length === 0 ? (
              <Empty>No hay sucursales para comparar.</Empty>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Sucursal</th>
                      <th className="num">Tickets</th>
                      <th className="num">Unidades</th>
                      <th className="num">Importe neto</th>
                      <th className="num">Utilidad bruta est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byBranch.data.map((r) => (
                      <tr key={r.branch.id}>
                        <td>{r.branch.name}</td>
                        {r.data ? (
                          <>
                            <td className="num">{formatQty(r.data.ticketCount)}</td>
                            <td className="num">{formatQty(r.data.unitsSold)}</td>
                            <td className="num strong">{formatMXN(r.data.netCents)}</td>
                            <td className="num">{formatMXN(r.data.grossProfitCents)}</td>
                          </>
                        ) : (
                          <td colSpan={4} className="field-error">{r.error ?? 'Sin datos'}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        );
      case 'top_units': {
        const data = rankBars(b.period.data?.topByUnits ?? [], 'units');
        return (
          <Card title="Productos más vendidos (unidades)">
            {data.length === 0 ? <Empty>{b.period.error ?? 'Sin ventas en el período.'}</Empty> : <RankChart data={data} color={GOLD} unit="u." />}
          </Card>
        );
      }
      case 'top_revenue': {
        const data = rankBars(b.period.data?.topByRevenue ?? [], 'revenue');
        return (
          <Card title="Productos con mayores ingresos (importe de ventas)">
            {data.length === 0 ? <Empty>{b.period.error ?? 'Sin ventas en el período.'}</Empty> : <RankChart data={data} color={GRAY} money />}
          </Card>
        );
      }
      case 'months': {
        const data = monthBars(b.months.data?.months ?? []);
        return (
          <Card title="Ingresos por mes (comparación de meses)">
            {data.length === 0 ? (
              <Empty>{b.months.error ?? 'Sin ventas en el período.'}</Empty>
            ) : (
              <div className="chart" role="img" aria-label="Gráfica de barras de ingresos por mes">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toLocaleString('es-MX')}`} width={80} />
                    <Tooltip formatter={(v) => formatMXN(Math.round(Number(v) * 100))} />
                    <Legend />
                    <Bar dataKey="bruto" name="Vendido (bruto)" fill={GOLD_LIGHT} />
                    <Bar dataKey="neto" name="Ventas netas" fill={GOLD} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        );
      }
      case 'out_of_stock':
        return <StockList title="Agotados" tone="danger" res={b.extra} pick="outOfStock" />;
      case 'low_stock':
        return <StockList title="Bajo mínimo" tone="warn" res={b.extra} pick="lowStock" />;
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        title="Resumen"
        subtitle="Cifras calculadas por el servidor con hora de México. Las ventas netas descuentan cancelaciones y devoluciones."
        actions={
          <>
            <button type="button" className="btn" onClick={() => bundle.reload()}>
              Actualizar
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
              Personalizar
            </button>
          </>
        }
      />
      <div className="filters">
        <DateRangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="inline-field">
          <span>Sucursal</span>
          <BranchSelect value={branchId} onChange={setBranchId} allLabel="Todas (consolidado)" />
        </label>
      </div>
      {!validRange && <Alert tone="warn">Elige un rango de fechas válido (desde no puede ser posterior a hasta).</Alert>}
      <Legend5 />
      {bundle.loading && !b && <Spinner />}
      {bundle.error && <ErrorBox error={bundle.error} onRetry={bundle.reload} />}
      {prefsRes.error && <Alert tone="info">No se pudo leer tu tablero guardado; se muestra el orden predeterminado.</Alert>}
      {b && (
        <div className="dash-grid">
          {widgets
            .filter((w) => w.visible)
            .map((w) => (
              <div key={w.def.id} className={`dash-item span-${w.def.span}`}>
                {renderWidget(w.def.id)}
              </div>
            ))}
          {widgets.every((w) => !w.visible) && <Empty>Ocultaste todos los indicadores. Usa Personalizar para mostrarlos.</Empty>}
        </div>
      )}
      {editing && <CustomizeModal prefs={prefs} onClose={() => setEditing(false)} onSave={savePrefs} />}
    </>
  );
}

/** Leyenda que explica los cinco tipos de cifra para no confundirlas. */
function Legend5() {
  return (
    <div className="metric-legend" aria-label="Tipos de cifra">
      <span className="legend-item kpi-importe">Importe de ventas</span>
      <span className="legend-item kpi-unidades">Unidades vendidas</span>
      <span className="legend-item kpi-utilidad">Utilidad bruta estimada</span>
      <span className="legend-item kpi-esperado">Efectivo esperado</span>
      <span className="legend-item kpi-contado">Efectivo contado</span>
    </div>
  );
}

function SalesKpi({ title, s, sub }: { title: string; s: Settled<SalesSummary | null>; sub: string }) {
  if (!s.data) return <KpiCard kind="importe" title={title} value="-" sub={s.error ?? 'Sin datos'} />;
  return (
    <KpiCard
      kind="importe"
      title={title}
      value={formatMXN(s.data.netCents)}
      sub={`${sub} · ${formatQty(s.data.ticketCount)} tickets · Bruto ${formatMXN(s.data.grossCents)}`}
    />
  );
}

function RankChart({ data, color, money, unit }: { data: { name: string; value: number }[]; color: string; money?: boolean; unit?: string }) {
  return (
    <div className="chart" role="img" aria-label="Gráfica de barras de productos">
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => (money ? `$${Number(v).toLocaleString('es-MX')}` : String(v))} />
          <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => (money ? formatMXN(Math.round(Number(v) * 100)) : `${v} ${unit ?? ''}`)} />
          <Bar dataKey="value" name={money ? 'Importe' : 'Unidades'} fill={color} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CashWidget({ res }: { res: Settled<CashSessionRow[]> }) {
  if (!res.data) {
    return (
      <Card title="Efectivo en cortes del período">
        <Alert tone="info">{res.error ?? 'Sin datos de caja.'}</Alert>
      </Card>
    );
  }
  const t = sumCashSessions(res.data);
  return (
    <Card title="Efectivo en cortes del período" actions={<Link to="/caja">Ver cortes</Link>}>
      <div className="kpi-pair">
        <KpiCard kind="esperado" title="Según el sistema" value={formatMXN(t.expectedCents)} sub="Fondo + efectivo cobrado - retiros - gastos - devoluciones en efectivo" />
        <KpiCard kind="contado" title="Contado físicamente" value={formatMXN(t.countedCents)} sub={`Diferencia ${formatMXN(t.countedCents - t.expectedCents)}`} />
      </div>
      <p className="muted small">
        {t.closed} corte(s) cerrado(s){t.open > 0 ? `, ${t.open} sesión(es) abierta(s) sin corte` : ''}.
        {t.provisional > 0 && <> <Badge tone="warn">{t.provisional} provisional(es) o pendiente(s) de conciliar</Badge></>}
      </p>
    </Card>
  );
}

function StockList(props: { title: string; tone: 'danger' | 'warn'; res: Settled<DashboardExtra>; pick: keyof DashboardExtra }) {
  const rows: InventoryRow[] = props.res.data?.[props.pick] ?? [];
  const estado = props.pick === 'outOfStock' ? 'agotado' : 'bajo';
  return (
    <Card title={`${props.title} (${rows.length})`} actions={<Link to={`/inventario?estado=${estado}`}>Ver en inventario</Link>}>
      {props.res.error ? (
        <Alert tone="info">{props.res.error}</Alert>
      ) : rows.length === 0 ? (
        <Empty>Ninguno.</Empty>
      ) : (
        <ul className="plain-list">
          {rows.slice(0, 8).map((r) => (
            <li key={`${r.variantId}-${r.branchId}`}>
              <span>
                {r.productName} <span className="muted">{r.variantLabel}</span>
                {r.branchName ? <span className="muted"> · {r.branchName}</span> : null}
              </span>
              <Badge tone={props.tone}>
                {r.qty} / mín. {r.minStock}
              </Badge>
            </li>
          ))}
          {rows.length > 8 && <li className="muted">y {rows.length - 8} más...</li>}
        </ul>
      )}
    </Card>
  );
}

function CustomizeModal(props: { prefs: DashboardPrefs; onClose: () => void; onSave: (p: DashboardPrefs) => Promise<void> }) {
  const initial = useMemo(() => resolveWidgets(props.prefs), [props.prefs]);
  const [order, setOrder] = useState(initial.map((w) => w.def.id));
  const [hidden, setHidden] = useState(props.prefs.hidden);
  const [busy, setBusy] = useState(false);
  const titles = useMemo(() => new Map(initial.map((w) => [w.def.id, w.def.title])), [initial]);
  const dirty = order.join() !== initial.map((w) => w.def.id).join() || [...hidden].sort().join() !== [...props.prefs.hidden].sort().join();

  return (
    <Modal
      title="Personalizar tablero"
      dirty={dirty}
      onClose={props.onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="button" className="btn" disabled={busy} onClick={() => { setOrder(DEFAULT_PREFS.order); setHidden([]); }}>
            Restablecer
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await props.onSave({ order, hidden });
              setBusy(false);
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <p className="muted small">Elige qué indicadores ver y en qué orden. Se guarda para tu usuario y no cambia tus permisos.</p>
      <ul className="sort-list">
        {order.map((id, i) => (
          <li key={id}>
            <label className="check">
              <input type="checkbox" checked={!hidden.includes(id)} onChange={() => setHidden((h) => toggleHidden(h, id))} />
              <span>{titles.get(id)}</span>
            </label>
            <span className="row-actions">
              <button type="button" className="icon-btn" aria-label="Subir" disabled={i === 0} onClick={() => setOrder((o) => moveWidget(o, id, -1))}>
                &uarr;
              </button>
              <button type="button" className="icon-btn" aria-label="Bajar" disabled={i === order.length - 1} onClick={() => setOrder((o) => moveWidget(o, id, 1))}>
                &darr;
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
