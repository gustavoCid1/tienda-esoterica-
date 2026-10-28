import { useState } from 'react';
import { formatMxDateTime, MXN_DENOMINATIONS } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { describeCashDifference, formatMXN } from '../lib/format.ts';
import { addDays, mxTodayKey } from '../lib/dates.ts';
import { cashSessionKind } from '../lib/ops.ts';
import { sumCashSessions } from '../lib/dashboard.ts';
import type { CashSessionRow } from '../lib/types.ts';
import { Alert, Badge, Card, Empty, ErrorBox, KpiCard, Modal, PageHeader, Spinner, TableWrap } from '../components/ui.tsx';
import { BranchSelect, DateRangeBar } from '../components/common.tsx';
import { useBranches } from '../context.tsx';

export function CashSessions() {
  const { branchName } = useBranches();
  const today = mxTodayKey();
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [branchId, setBranchId] = useState('');
  const [open, setOpen] = useState<CashSessionRow | null>(null);
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to;

  const res = useAsync(
    (signal) =>
      api.get<unknown>('/cash/sessions', { branchId, from: range.from, to: range.to }, signal).then((d) => asList<CashSessionRow>(d)),
    [branchId, range.from, range.to],
    valid,
  );
  const rows = res.data ?? [];
  const totals = sumCashSessions(rows);

  return (
    <>
      <PageHeader title="Cortes de caja" subtitle="Historial de sesiones de caja con efectivo esperado, efectivo contado y diferencia." />
      <Alert tone="info" title="Corte real e informe agregado no son lo mismo">
        Un <strong>corte real</strong> es el cierre de una sesión de caja con conteo físico del efectivo. Los informes de la sección Informes son
        agregados por fecha y no sustituyen al corte. Un corte <strong>provisional</strong> se cerró con operaciones pendientes de sincronizar o
        conciliar: sus cifras pueden cambiar.
      </Alert>
      <div className="filters">
        <DateRangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="inline-field">
          <span>Sucursal</span>
          <BranchSelect value={branchId} onChange={setBranchId} allLabel="Todas" />
        </label>
      </div>
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <>
          <div className="kpi-row">
            <KpiCard kind="esperado" title="Efectivo esperado (cortes cerrados)" value={formatMXN(totals.expectedCents)} />
            <KpiCard kind="contado" title="Efectivo contado (cortes cerrados)" value={formatMXN(totals.countedCents)} sub={describeCashDifference(totals.countedCents - totals.expectedCents)} />
          </div>
          <Card>
            {rows.length === 0 ? (
              <Empty>No hay sesiones de caja en ese período.</Empty>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Apertura</th><th>Cierre</th><th>Sucursal</th><th>Terminal</th><th>Cajero</th>
                      <th className="num">Fondo</th>
                      <th className="num th-esperado">Efectivo esperado</th>
                      <th className="num th-contado">Efectivo contado</th>
                      <th className="num">Diferencia</th>
                      <th>Tipo</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const kind = cashSessionKind(s);
                      const diff = s.differenceCents ?? (s.countedCents != null && s.expectedCents != null ? s.countedCents - s.expectedCents : null);
                      return (
                        <tr key={s.id}>
                          <td>{formatMxDateTime(s.openedAt)}</td>
                          <td>{s.closedAt ? formatMxDateTime(s.closedAt) : <span className="muted">Abierta</span>}</td>
                          <td>{branchName(s.branchId)}</td>
                          <td>{s.terminalName ?? s.terminalId.slice(0, 6)}</td>
                          <td>{s.openedByName ?? s.openedBy.slice(0, 6)}</td>
                          <td className="num">{formatMXN(s.openingCents)}</td>
                          <td className="num cell-esperado">{s.expectedCents != null ? formatMXN(s.expectedCents) : '-'}</td>
                          <td className="num cell-contado">{s.countedCents != null ? formatMXN(s.countedCents) : '-'}</td>
                          <td className={`num strong ${diff != null && diff < 0 ? 'neg' : diff != null && diff > 0 ? 'pos' : ''}`}>
                            {diff != null ? describeCashDifference(diff) : '-'}
                          </td>
                          <td><Badge tone={kind.tone} title={kind.hint}>{kind.label}</Badge></td>
                          <td className="row-actions"><button type="button" className="btn btn-sm" onClick={() => setOpen(s)}>Detalle</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
      {open && <SessionDetail s={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SessionDetail({ s, onClose }: { s: CashSessionRow; onClose: () => void }) {
  const { branchName } = useBranches();
  const kind = cashSessionKind(s);
  const b = s.breakdown;
  return (
    <Modal title="Detalle de la sesión de caja" size="lg" onClose={onClose}>
      <div className="form">
        <Alert tone={kind.tone === 'warn' ? 'warn' : 'info'} title={kind.label}>{kind.hint}</Alert>
        <div className="detail-grid">
          <div><span className="muted small">Sucursal</span><div>{branchName(s.branchId)}</div></div>
          <div><span className="muted small">Apertura</span><div>{formatMxDateTime(s.openedAt)}</div></div>
          <div><span className="muted small">Cierre</span><div>{s.closedAt ? formatMxDateTime(s.closedAt) : 'Abierta'}</div></div>
          <div><span className="muted small">Fondo inicial</span><div>{formatMXN(s.openingCents)}</div></div>
        </div>
        {b ? (
          <div className="totals">
            <div><span>Fondo inicial</span><span>{formatMXN(b.openingCents)}</span></div>
            <div><span>+ Cobros en efectivo</span><span>{formatMXN(b.cashSalesCents)}</span></div>
            <div><span>+ Entradas de efectivo</span><span>{formatMXN(b.cashInCents)}</span></div>
            <div><span>- Retiros</span><span>{formatMXN(b.withdrawalsCents)}</span></div>
            <div><span>- Gastos</span><span>{formatMXN(b.expensesCents)}</span></div>
            <div><span>- Devoluciones en efectivo</span><span>{formatMXN(b.cashRefundsCents)}</span></div>
            <div className="strong cell-esperado"><span>Efectivo esperado</span><span>{formatMXN(b.expectedCents)}</span></div>
            {s.countedCents != null && <div className="strong cell-contado"><span>Efectivo contado</span><span>{formatMXN(s.countedCents)}</span></div>}
            <div className="muted"><span>Tarjeta (no entra al cajón)</span><span>{formatMXN(b.byMethod.tarjeta)}</span></div>
            <div className="muted"><span>Transferencia (no entra al cajón)</span><span>{formatMXN(b.byMethod.transferencia)}</span></div>
          </div>
        ) : (
          <p className="muted">El servidor no envió el desglose de esta sesión.</p>
        )}
        {s.denominations && Object.keys(s.denominations).length > 0 && (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Denominación</th><th className="num">Piezas</th><th className="num">Subtotal</th></tr></thead>
              <tbody>
                {Object.entries(s.denominations).filter(([, q]) => q > 0).map(([label, qty]) => (
                  <tr key={label}><td>{label}</td><td className="num">{qty}</td><td className="num">{formatMXN((MXN_DENOMINATIONS[label] ?? 0) * qty)}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {s.notes && <p><span className="muted small">Notas: </span>{s.notes}</p>}
      </div>
    </Modal>
  );
}
