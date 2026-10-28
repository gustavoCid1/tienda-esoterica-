/**
 * Pantallas de solo lectura del sistema: estado de sincronización, respaldos, auditoría y
 * diagnóstico técnico. Los datos exactos los define el servidor; aquí se muestran de forma tolerante.
 */
import { useState } from 'react';
import { formatMxDateTime } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { formatBytes, formatQty } from '../lib/format.ts';
import { addDays, mxTodayKey } from '../lib/dates.ts';
import type { AuditRow, BackupRow, SyncStatus } from '../lib/types.ts';
import { Alert, Badge, Card, Empty, ErrorBox, KpiCard, Modal, PageHeader, Spinner, TableWrap } from '../components/ui.tsx';
import { DateRangeBar } from '../components/common.tsx';
import { useBranches } from '../context.tsx';

/* --------------------------------------------------------------- Sincronización */

export function SyncStatusPage() {
  const { branchName } = useBranches();
  const res = useAsync((s) => api.get<SyncStatus>('/admin/sync/status', undefined, s), []);
  const d = res.data;
  const terminals = d?.terminals ?? [];
  const pending = d?.pendingOps ?? terminals.reduce((a, t) => a + (t.pendingOps ?? 0), 0);
  const staleMs = 15 * 60 * 1000;

  return (
    <>
      <PageHeader title="Estado de sincronización" subtitle="Cada terminal trabaja sin conexión y envía sus operaciones cuando hay red." actions={<button type="button" className="btn" onClick={res.reload}>Actualizar</button>} />
      {res.loading && !d && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {d && (
        <>
          <div className="kpi-row">
            <KpiCard kind="conteo" title="Terminales" value={formatQty(terminals.length)} />
            <KpiCard kind="conteo" title="Operaciones pendientes de enviar" value={formatQty(pending)} />
            {d.openConflicts !== undefined && <KpiCard kind="conteo" title="Conflictos abiertos" value={formatQty(d.openConflicts)} />}
          </div>
          <Card title="Terminales">
            {terminals.length === 0 ? <Empty>El servidor no reportó terminales.</Empty> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Terminal</th><th>Sucursal</th><th>Última sincronización</th><th className="num">Pendientes</th><th>Estado</th></tr></thead>
                  <tbody>
                    {terminals.map((t, i) => {
                      const last = t.lastSyncAt ? new Date(t.lastSyncAt).getTime() : null;
                      const ref = d.serverTime ? new Date(d.serverTime).getTime() : Date.now();
                      const stale = last === null || ref - last > staleMs;
                      return (
                        <tr key={t.id ?? t.terminalId ?? i}>
                          <td><strong>{t.name ?? t.code ?? (t.id ?? t.terminalId ?? '').slice(0, 8)}</strong></td>
                          <td>{t.branchId ? branchName(t.branchId) : '-'}</td>
                          <td>{t.lastSyncAt ? formatMxDateTime(t.lastSyncAt) : <span className="muted">Nunca</span>}</td>
                          <td className="num">{t.pendingOps ?? 0}</td>
                          <td>{stale ? <Badge tone="warn" title="Sin sincronizar en los últimos 15 minutos">Sin sincronizar reciente</Badge> : <Badge tone="ok">Al día</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <p className="muted small">Una terminal "sin sincronizar reciente" puede estar simplemente apagada o sin red; sus ventas y cortes aparecerán como provisionales hasta que envíe.</p>
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- Respaldos */

export function BackupsPage() {
  const res = useAsync((s) => api.get<unknown>('/admin/backups', undefined, s).then((d) => asList<BackupRow>(d)), []);
  const rows = res.data ?? [];
  const last = rows.find((b) => /ok|exito|éxito|completo|success/i.test(b.status));
  return (
    <>
      <PageHeader title="Respaldos" subtitle="Registro de copias de seguridad de la base de datos." actions={<button type="button" className="btn" onClick={res.reload}>Actualizar</button>} />
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <>
          {rows.length === 0 ? <Alert tone="warn" title="Sin respaldos registrados">No hay respaldos en el registro. Revisa la configuración de respaldos del servidor.</Alert>
            : last ? <Alert tone="ok" title="Último respaldo correcto">{formatMxDateTime(last.createdAt)}</Alert>
            : <Alert tone="warn" title="Ningún respaldo correcto">Hay intentos registrados, pero ninguno terminó correctamente.</Alert>}
          <Card>
            {rows.length === 0 ? <Empty>Sin registros.</Empty> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Fecha</th><th>Tipo</th><th>Estado</th><th className="num">Tamaño</th><th>Ubicación</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td>{formatMxDateTime(b.createdAt)}</td>
                        <td>{b.kind ?? '-'}</td>
                        <td><Badge tone={/ok|exito|éxito|completo|success/i.test(b.status) ? 'ok' : /error|fall|fail/i.test(b.status) ? 'danger' : 'muted'}>{b.status}</Badge></td>
                        <td className="num">{formatBytes(b.sizeBytes)}</td>
                        <td className="small">{b.location ?? '-'}</td>
                        <td className="small">{b.detail ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- Auditoría */

export function AuditPage() {
  const today = mxTodayKey();
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [entity, setEntity] = useState('');
  const [text, setText] = useState('');
  const dEntity = useDebounced(entity.trim(), 300);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to;

  const res = useAsync(
    (signal) => api.get<unknown>('/admin/audit', { entity: dEntity, from: range.from, to: range.to }, signal).then((d) => asList<AuditRow>(d)),
    [dEntity, range.from, range.to],
    valid,
  );
  const t = text.trim().toLowerCase();
  const rows = (res.data ?? []).filter((r) => !t || [r.action, r.entity, r.userName, r.detail].join(' ').toLowerCase().includes(t));

  return (
    <>
      <PageHeader title="Auditoría" subtitle="Quién cambió qué y cuándo: precios, usuarios, cancelaciones, ajustes y más." />
      <div className="filters">
        <DateRangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="inline-field"><span>Entidad</span><input value={entity} placeholder="ej. variante, usuario, venta" onChange={(e) => setEntity(e.target.value)} /></label>
        <label className="inline-field grow"><span>Buscar en resultados</span><input type="search" value={text} onChange={(e) => setText(e.target.value)} /></label>
      </div>
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          {rows.length === 0 ? <Empty>No hay registros de auditoría con esos filtros.</Empty> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Detalle</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, 500).map((r) => (
                    <tr key={r.id}>
                      <td>{formatMxDateTime(r.createdAt)}</td>
                      <td>{r.userName ?? r.userId?.slice(0, 8) ?? '-'}</td>
                      <td>{r.entity}</td>
                      <td><strong>{r.action}</strong></td>
                      <td className="small">{r.detail ?? ''}</td>
                      <td className="row-actions">{(r.before != null || r.after != null) && <button type="button" className="btn btn-sm" onClick={() => setOpen(r)}>Antes / después</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {rows.length > 500 && <p className="muted small">Se muestran 500 de {rows.length}; acota las fechas.</p>}
        </Card>
      )}
      {open && (
        <Modal title={`${open.entity}: ${open.action}`} size="lg" onClose={() => setOpen(null)}>
          <div className="two-col">
            <div><h3 className="section-title">Antes</h3><pre className="code-block">{JSON.stringify(open.before ?? null, null, 2)}</pre></div>
            <div><h3 className="section-title">Después</h3><pre className="code-block">{JSON.stringify(open.after ?? null, null, 2)}</pre></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- Diagnóstico */

export function DiagnosticsPage() {
  const res = useAsync((s) => api.get<Record<string, unknown>>('/admin/diagnostics', undefined, s), []);
  return (
    <>
      <PageHeader title="Diagnóstico técnico" subtitle="Versión, conexión a base de datos y latencia. No incluye datos financieros." actions={<button type="button" className="btn" onClick={res.reload}>Actualizar</button>} />
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          <TableWrap>
            <table className="table">
              <tbody>
                {Object.entries(res.data).map(([k, v]) => (
                  <tr key={k}><th scope="row">{k}</th><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
