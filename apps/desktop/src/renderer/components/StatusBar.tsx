/** Barra superior: usuario, sucursal/terminal, estado de sincronización y avisos de respaldo. */
import { useEffect, useState } from 'react';
import type { BackupState, SyncState } from '../../shared/ipc.ts';

function ago(iso: string | null, now: number): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function syncSummary(s: SyncState | null, now: number): { text: string; level: 'ok' | 'warn' | 'error' | 'info' } {
  if (!s) return { text: 'Sincronización: sin datos', level: 'info' };
  if (!s.activated) return { text: 'Sin servidor configurado (trabajando solo en esta PC)', level: 'info' };
  if (s.authError) return { text: 'La terminal no está autorizada en el servidor', level: 'error' };
  if (s.running) return { text: 'Sincronizando...', level: 'info' };
  if (!s.online) return { text: `Sin conexión${s.pending ? ` - ${s.pending} pendiente(s) por enviar` : ''}`, level: 'warn' };
  if (s.lastError) return { text: `Error al sincronizar: ${s.lastError}`, level: 'warn' };
  if (s.pending > 0) return { text: `${s.pending} pendiente(s) por enviar`, level: 'warn' };
  return { text: `Sincronizado ${ago(s.lastOkAt, now)}`, level: 'ok' };
}

export function StatusBar({
  userName, roleLabel, place, sync, backup, onLogout,
}: {
  userName: string; roleLabel: string; place: string; sync: SyncState | null; backup: BackupState | null; onLogout: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const s = syncSummary(sync, now);
  return (
    <header className="topbar">
      <div className="brand">Esotérica Amara</div>
      <div className="topbar-place">{place}</div>
      <div className={`chip chip-${s.level}`} title="Estado de sincronización">
        {s.text}
      </div>
      {backup?.warning && (
        <div className="chip chip-error" title={backup.warning}>
          Respaldo con problemas
        </div>
      )}
      <div className="topbar-user">
        <strong>{userName}</strong> <span className="muted">({roleLabel})</span>
      </div>
      <button className="btn btn-sm" onClick={onLogout}>
        Cerrar sesión
      </button>
    </header>
  );
}
