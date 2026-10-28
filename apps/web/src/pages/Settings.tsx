import { useState } from 'react';
import { formatMxDateTime } from '@amara/shared';
import { API_BASE, api } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import { DEFAULT_PREFS } from '../lib/dashboard.ts';
import { ALL_PERMISSIONS, PERMISSION_LABEL, ROLE_NAME } from '../lib/permLabels.ts';
import { Alert, Badge, Card, ConfirmDialog, PageHeader } from '../components/ui.tsx';
import { useAuth, useToast } from '../context.tsx';

/**
 * Configuración. La API v1 no define endpoints de configuración del negocio, por lo que esta
 * pantalla se limita a: estado de la conexión, datos de la sesión, permisos efectivos y
 * preferencias personales (tablero y datos locales del navegador).
 */
export function Settings() {
  const { user, permissions, can, logout } = useAuth();
  const { notify } = useToast();
  const health = useAsync((s) => api.get<{ ok?: boolean; time?: string; version?: string }>('/health', undefined, s), []);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const resetDashboard = async () => {
    setBusy(true);
    try {
      await api.put('/prefs/dashboard', DEFAULT_PREFS);
      notify('Tablero restablecido.');
      setConfirmReset(false);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearLocal = () => {
    try {
      localStorage.removeItem('amara.web.labels.history');
      notify('Se borró el historial local de etiquetas.');
    } catch {
      notify('No se pudo acceder al almacenamiento del navegador.', 'error');
    }
  };

  return (
    <>
      <PageHeader title="Configuración" subtitle="Conexión, sesión y preferencias personales." />
      <div className="two-col">
        <Card title="Sesión">
          <dl className="dl">
            <dt>Usuario</dt><dd>{user?.name} ({user?.username})</dd>
            <dt>Rol</dt><dd>{user ? ROLE_NAME[user.role] : ''}</dd>
            <dt>Sucursales</dt><dd>{user?.branchIds.length ?? 0}</dd>
          </dl>
          <p className="muted small">El token de sesión solo vive en esta pestaña; al cerrarla se pierde. Nunca se guardan contraseñas.</p>
          <button type="button" className="btn" onClick={logout}>Cerrar sesión</button>
        </Card>
        <Card title="Conexión con el servidor" actions={<button type="button" className="btn btn-sm" onClick={health.reload}>Probar</button>}>
          <dl className="dl">
            <dt>Dirección de la API</dt><dd className="mono">{API_BASE}</dd>
            <dt>Estado</dt>
            <dd>{health.loading ? 'Probando...' : health.error ? <Badge tone="danger">Sin respuesta</Badge> : health.data?.ok === false ? <Badge tone="warn">Con problemas</Badge> : <Badge tone="ok">En línea</Badge>}</dd>
            {health.data?.version && (<><dt>Versión del servidor</dt><dd>{health.data.version}</dd></>)}
            {health.data?.time && (<><dt>Hora del servidor</dt><dd>{formatMxDateTime(health.data.time)}</dd></>)}
          </dl>
          {health.error && <Alert tone="error">{health.error}</Alert>}
          <p className="muted small">Zona horaria del negocio: America/Mexico_City. Moneda: pesos mexicanos (MXN).</p>
        </Card>
      </div>

      <Card title="Preferencias personales">
        <div className="btn-row">
          {can('estadisticas.ver') && <button type="button" className="btn" onClick={() => setConfirmReset(true)}>Restablecer mi tablero</button>}
          <button type="button" className="btn" onClick={clearLocal}>Borrar historial local de etiquetas</button>
        </div>
        <p className="muted small">Personalizar el tablero solo cambia qué ves y en qué orden; no concede permisos.</p>
      </Card>

      <Card title="Permisos de tu sesión (informativo)">
        <Alert tone="info">Lista que entregó el servidor para mostrar u ocultar opciones. Cada acción se vuelve a autorizar en el servidor.</Alert>
        <ul className="perm-list">
          {ALL_PERMISSIONS.filter((p) => permissions.has(p)).map((p) => <li key={p}>{PERMISSION_LABEL[p]}</li>)}
        </ul>
      </Card>

      {confirmReset && (
        <ConfirmDialog
          title="Restablecer tablero"
          message="Se mostrarán todos los indicadores en su orden original."
          confirmLabel="Restablecer"
          busy={busy}
          onCancel={() => setConfirmReset(false)}
          onConfirm={resetDashboard}
        />
      )}
    </>
  );
}
