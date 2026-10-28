/**
 * Pantallas de solo lectura del sistema: estado de sincronización, respaldos, auditoría y
 * diagnóstico técnico. Los datos exactos los define el servidor; aquí se muestran de forma tolerante.
 */
import { useMemo, useState } from 'react';
import { formatMxDateTime } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { formatBytes, formatQty } from '../lib/format.ts';
import { addDays, mxTodayKey } from '../lib/dates.ts';
import type { AdminUser, BackupRow, SyncStatus } from '../lib/types.ts';
import type { AuditView } from '../lib/types-v2.ts';
import { filterAuditRows, normalizeAuditRows } from '../lib/audit.ts';
import { Alert, Badge, Card, Empty, ErrorBox, KpiCard, Modal, PageHeader, Spinner, TableWrap } from '../components/ui.tsx';
import { DateRangeBar } from '../components/common.tsx';
import { useAuth, useBranches } from '../context.tsx';

/* --------------------------------------------------------------- Sincronización */

export function SyncStatusPage() {
  const { branchName } = useBranches();
  const res = useAsync((s) => api.get<SyncStatus>('/admin/sync/status', undefined, s), []);
  const d = res.data;
  const terminals = d?.terminals ?? [];
  const pending = d?.pendingOps ?? terminals.reduce((a, t) => a + (t.pendingOps ?? t.pendingEvents ?? 0), 0);
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
                          <td className="num">{t.pendingOps ?? t.pendingEvents ?? 0}</td>
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

/** La API v1 guarda `at`, `ok` y `dir`; la pantalla trabaja con fecha, estado y ubicación. */
function normalizeBackup(b: BackupRow): BackupRow {
  return {
    ...b,
    createdAt: b.createdAt ?? b.at ?? '',
    status: b.status ?? (b.ok === undefined ? '-' : b.ok ? 'completo' : 'con error'),
    location: b.location ?? b.dir,
    sizeBytes: b.sizeBytes ?? (b.files ? b.files.reduce((a, f) => a + (f.bytes ?? 0), 0) : undefined),
  };
}

export function BackupsPage() {
  const res = useAsync((s) => api.get<unknown>('/admin/backups', undefined, s).then((d) => asList<BackupRow>(d).map(normalizeBackup)), []);
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
                        <td>{b.createdAt ? formatMxDateTime(b.createdAt) : '-'}</td>
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

/**
 * Auditoría. La causa de que antes no cargara está documentada en lib/audit.ts: el servidor manda
 * `at` y un `detail` OBJETO, y la pantalla intentaba pintar ese objeto. Ahora todo pasa por
 * normalizeAuditRows (texto seguro), y hay estados visibles de carga, error y vacío.
 */
export function AuditPage() {
  const { can } = useAuth();
  const today = mxTodayKey();
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [entity, setEntity] = useState('');
  const [text, setText] = useState('');
  const dEntity = useDebounced(entity.trim(), 300);
  const [open, setOpen] = useState<AuditView | null>(null);
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to;

  // Nombres de usuario para mostrar quién hizo cada cambio (la auditoría solo guarda el id).
  const users = useAsync((s) => api.get<unknown>('/admin/users', undefined, s).then((d) => asList<AdminUser>(d)), [], can('usuarios.gestionar'));
  const userNames = useMemo(() => Object.fromEntries((users.data ?? []).map((u) => [u.id, u.name])), [users.data]);

  const res = useAsync(
    (signal) => api.get<unknown>('/admin/audit', { entity: dEntity, from: range.from, to: range.to, limit: 500 }, signal),
    [dEntity, range.from, range.to],
    valid,
  );
  const all = useMemo(() => normalizeAuditRows(res.data, userNames), [res.data, userNames]);
  const rows = useMemo(() => filterAuditRows(all, text), [all, text]);
  const total = res.data && typeof res.data === 'object' && typeof (res.data as { total?: unknown }).total === 'number' ? (res.data as { total: number }).total : all.length;

  return (
    <>
      <PageHeader
        title="Auditoría"
        subtitle="Quién cambió qué y cuándo: precios, usuarios, cancelaciones, ajustes y más."
        actions={<button type="button" className="btn" onClick={res.reload} disabled={res.loading}>{res.loading ? 'Actualizando...' : 'Actualizar'}</button>}
      />
      <div className="filters">
        <DateRangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="inline-field"><span>Entidad</span><input value={entity} placeholder="ej. variant, user, sale" onChange={(e) => setEntity(e.target.value)} /></label>
        <label className="inline-field grow"><span>Buscar en resultados</span><input type="search" value={text} onChange={(e) => setText(e.target.value)} /></label>
      </div>
      {!valid && <Alert tone="warn">Elige un rango de fechas válido (desde no puede ser posterior a hasta).</Alert>}
      {valid && res.loading && !res.data && <Spinner label="Cargando auditoría" />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {valid && res.data !== null && (
        <Card>
          {rows.length === 0 ? (
            <Empty>{all.length === 0 ? 'No hay registros de auditoría en ese rango de fechas.' : 'Ningún registro coincide con tu búsqueda.'}</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Detalle</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, 500).map((r) => (
                    <tr key={r.id}>
                      <td>{r.at ? formatMxDateTime(r.at) : <span className="muted">-</span>}</td>
                      <td>{r.userLabel}</td>
                      <td>{r.entity}</td>
                      <td><strong>{r.action}</strong></td>
                      <td className="small audit-detail">{r.summary}</td>
                      <td className="row-actions">{r.hasDiff && <button type="button" className="btn btn-sm" onClick={() => setOpen(r)}>Ver detalle</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {all.length > 0 && <p className="muted small">Se muestran {Math.min(rows.length, 500)} de {rows.length} registros{total > all.length ? ` (el servidor tiene ${total} en el rango; acota las fechas para ver el resto)` : ''}.</p>}
        </Card>
      )}
      {open && (
        <Modal title={`${open.entity}: ${open.action}`} size="lg" onClose={() => setOpen(null)}>
          {open.before !== null || open.after !== null ? (
            <div className="two-col">
              <div><h3 className="section-title">Antes</h3><pre className="code-block">{JSON.stringify(open.before, null, 2)}</pre></div>
              <div><h3 className="section-title">Después</h3><pre className="code-block">{JSON.stringify(open.after, null, 2)}</pre></div>
            </div>
          ) : (
            <div><h3 className="section-title">Detalle registrado</h3><pre className="code-block">{JSON.stringify(open.raw, null, 2)}</pre></div>
          )}
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
