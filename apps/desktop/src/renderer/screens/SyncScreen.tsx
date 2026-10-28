/** Resumen de sincronización: pendientes por enviar, rechazadas y conflictos (los resuelve el gerente en el panel web). */
import { useCallback, useEffect, useState } from 'react';
import type { ConflictRow, QueueRow } from '../../shared/ipc.ts';
import { Banner } from '../components/Field.tsx';
import { syncSummary } from '../components/StatusBar.tsx';
import { call, errorText } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

const TYPE_LABEL: Record<string, string> = {
  'sale.create': 'Venta',
  'sale.adjust': 'Cancelación / devolución',
  'stock.movement': 'Movimiento de inventario',
  'cash.open': 'Apertura de caja',
  'cash.movement': 'Movimiento de caja',
  'cash.close': 'Corte de caja',
};

export function SyncScreen() {
  const { sync } = useApp();
  const { toast } = useFeedback();
  const [pending, setPending] = useState<QueueRow[]>([]);
  const [problems, setProblems] = useState<QueueRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useScanHandler(() => toast('info', 'En esta pantalla no se usa el escáner.'));

  const load = useCallback(async () => {
    try {
      const [p, r, c, co] = await Promise.all([call('sync:queue', { status: 'pendiente' }), call('sync:queue', { status: 'rechazada' }), call('sync:queue', { status: 'conflicto' }), call('sync:conflicts')]);
      setPending(p);
      setProblems([...r, ...c]);
      setConflicts(co);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, sync?.pending, sync?.lastRunAt]);

  const syncNow = async () => {
    setBusy(true);
    try {
      await call('sync:now');
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const s = syncSummary(sync, Date.now());

  return (
    <div className="page">
      <div className="row-between">
        <h1>Sincronización</h1>
        <button className="btn btn-gold" onClick={() => void syncNow()} disabled={busy || sync?.running}>{busy || sync?.running ? 'Sincronizando...' : 'Sincronizar ahora'}</button>
      </div>
      <Banner kind={s.level === 'ok' ? 'ok' : s.level === 'error' ? 'error' : s.level === 'warn' ? 'warn' : 'info'}>{s.text}</Banner>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="stat-row">
        <div className="card"><span className="muted">Por enviar</span><div className="stat-big">{sync?.pending ?? 0}</div></div>
        <div className="card"><span className="muted">Rechazadas</span><div className={`stat-big ${(sync?.rejected ?? 0) > 0 ? 'neg' : ''}`}>{sync?.rejected ?? 0}</div></div>
        <div className="card"><span className="muted">Conflictos abiertos</span><div className={`stat-big ${(sync?.openConflicts ?? 0) > 0 ? 'warn-text' : ''}`}>{sync?.openConflicts ?? 0}</div></div>
        <div className="card"><span className="muted">Último envío correcto</span><div className="stat-mid">{sync?.lastOkAt ? dateTime(sync.lastOkAt) : 'Nunca'}</div></div>
      </div>
      <p className="muted">Nada se pierde sin internet: las ventas, movimientos y cortes se guardan aquí y se envían solos cuando hay conexión.</p>

      <div className="card">
        <h3>Pendientes por enviar</h3>
        <QueueTable rows={pending} empty="No hay nada pendiente." />
      </div>
      <div className="card">
        <h3>Operaciones con problema</h3>
        <QueueTable rows={problems} empty="Ninguna operación rechazada o con aviso." />
      </div>
      <div className="card">
        <h3>Conflictos de sincronización</h3>
        {conflicts.length === 0 && <p className="muted">No hay conflictos abiertos.</p>}
        {conflicts.map((c) => (
          <div key={c.id} className="conflict">
            <div className="row-between"><strong>{c.kind}</strong><span className="muted small">{dateTime(c.createdAt)}</span></div>
            <div className="muted small mono">{JSON.stringify(c.detail)}</div>
          </div>
        ))}
        {conflicts.length > 0 && <p className="muted small">La venta ya ocurrió y está aplicada; el gerente revisa y resuelve estas diferencias desde el panel web.</p>}
      </div>
    </div>
  );
}

function QueueTable({ rows, empty }: { rows: QueueRow[]; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="table">
      <thead><tr><th>Operación</th><th>Hora</th><th>Estado</th><th className="num">Intentos</th><th>Último error</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.opId}>
            <td>{TYPE_LABEL[r.type] ?? r.type}{r.origin === 'lan' ? ' (teléfono)' : ''}</td>
            <td>{dateTime(r.localTs)}</td>
            <td>{r.status}</td>
            <td className="num">{r.attempts}</td>
            <td className="muted small">{r.lastError ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
