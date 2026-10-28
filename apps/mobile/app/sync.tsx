/**
 * Estado de sincronización: última sincronización correcta, pendientes, rechazadas, conflictos y aviso de
 * datos desactualizados. La sincronización corre sola (al abrir, al reconectar, al volver a la app y cada
 * pocos minutos); aquí se puede forzar.
 */
import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { formatMxDateTime } from '@amara/shared';
import { Banner, Button, Card, Field, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { StatusBanner } from '../src/components/StatusBanner';
import { useApp } from '../src/state/AppContext';
import { useNow } from '../src/hooks';
import { humanAge } from '../src/lib/staleness';
import { ApiError } from '../src/services/api';
import { colors } from '../src/theme';

interface QueueRow {
  seq: number;
  opId: string;
  type: string;
  status: string;
  attempts: number;
  lastError: string | null;
  localTs: string;
}

const TYPE_LABEL: Record<string, string> = {
  'sale.create': 'Venta',
  'sale.adjust': 'Cancelación o devolución',
  'stock.movement': 'Movimiento de inventario',
  'cash.open': 'Apertura de caja',
  'cash.movement': 'Movimiento de caja',
  'cash.close': 'Corte de caja',
};

export default function SyncScreen() {
  const app = useApp();
  const { store } = app;
  const now = useNow(30_000);
  const [pending, setPending] = useState<QueueRow[]>([]);
  const [rejected, setRejected] = useState<QueueRow[]>([]);
  const [conflicts, setConflicts] = useState<{ id: string; kind: string; created_at: string; detail_json: string }[]>([]);
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!store) return;
      void (async () => {
        setPending((await store.listQueue('pendiente', 30)) as QueueRow[]);
        setRejected((await store.listQueue('rechazada', 30)) as QueueRow[]);
        setConflicts(await store.openConflicts());
      })();
    }, [store, app.dataVersion]),
  );

  if (!store) return <Loading />;
  const st = app.sync.status;
  const rep = app.sync.lastReport;
  const lastOk = st?.lastSyncOkAt ?? null;

  async function reauth() {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await app.reauthOnline(password);
      setPassword('');
    } catch (e) {
      setAuthError(e instanceof ApiError && e.unreachable ? 'No hay conexión con el servidor.' : e instanceof Error ? e.message : 'No se pudo iniciar sesión.');
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <Screen>
      <StatusBanner />

      {app.needsOnlineLogin || (app.session?.mode === 'offline' && !app.sync.lastReport?.pulled) ? (
        <Card tone="gold">
          <H2>{app.needsOnlineLogin ? 'La sesión en línea venció' : 'Sesión sin conexión'}</H2>
          <Muted>
            {app.needsOnlineLogin
              ? 'El servidor rechazó la sesión o la terminal. Escribe tu contraseña con conexión para volver a sincronizar. Lo pendiente sigue guardado.'
              : 'Entraste sin conexión: para sincronizar hace falta iniciar sesión en línea (o configurar el token de terminal).'}
          </Muted>
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          {authError ? <Banner kind="error" text={authError} /> : null}
          <Button title="Iniciar sesión en línea" onPress={() => void reauth()} loading={authBusy} disabled={!password || !app.online} />
        </Card>
      ) : null}

      <Card>
        <H2>Estado</H2>
        <Row label="Última sincronización correcta" value={lastOk ? `${formatMxDateTime(lastOk)} (hace ${humanAge(now - Date.parse(lastOk))})` : 'Nunca'} />
        <Row label="Último intento" value={app.sync.lastAttemptAt ? formatMxDateTime(app.sync.lastAttemptAt) : 'Ninguno'} />
        <Row label="Pendientes por enviar" value={String(st?.pending ?? 0)} strong={(st?.pending ?? 0) > 0} />
        <Row label="Rechazadas por el servidor" value={String(st?.rejected ?? 0)} strong={(st?.rejected ?? 0) > 0} valueColor={(st?.rejected ?? 0) > 0 ? colors.danger : undefined} />
        <Row label="Conflictos abiertos" value={String(st?.openConflicts ?? 0)} strong={(st?.openConflicts ?? 0) > 0} />
        <Row label="Conexión" value={app.online ? 'Con red' : 'Sin red'} />
        <Row label="Servidor" value={app.apiUrl || 'Sin configurar'} />
        <Button title="Sincronizar ahora" onPress={() => void app.syncNow('manual')} loading={app.sync.running} disabled={!app.online} />
        {!app.online ? <Muted>Sin conexión: se sincronizará solo al recuperarla.</Muted> : null}
      </Card>

      {rep ? (
        <Card>
          <H2>Último ciclo</H2>
          <Row label="Enviadas" value={String(rep.sent)} />
          <Row label="Aplicadas / duplicadas" value={`${rep.applied} / ${rep.duplicates}`} />
          <Row label="Con conflicto" value={String(rep.conflicts)} />
          <Row label="Rechazadas" value={String(rep.rejected)} />
          <Row label="Catálogo y existencias descargados" value={rep.pulled ? 'Sí' : 'No'} />
          {!rep.pulled && rep.remaining > 0 ? <Muted>No se descargaron datos nuevos porque aún quedan operaciones por enviar (primero se envía, luego se baja).</Muted> : null}
          {rep.error ? <Banner kind={rep.authError ? 'error' : 'warn'} text={rep.authError ? `Sesión o terminal no autorizada: ${rep.error}` : rep.online ? rep.error : 'Sin conexión con el servidor. Se reintentará.'} /> : null}
        </Card>
      ) : null}

      {conflicts.length > 0 ? (
        <Card>
          <H2>Conflictos abiertos</H2>
          <Muted>La operación SÍ se aplicó, pero quedó una diferencia (por ejemplo existencia negativa) para que el gerente la revise en la web.</Muted>
          {conflicts.map((c) => (
            <Banner key={c.id} kind="warn" title={c.kind} text={`${formatMxDateTime(c.created_at)} · ${c.detail_json.slice(0, 160)}`} />
          ))}
        </Card>
      ) : null}

      {rejected.length > 0 ? (
        <Card>
          <H2>Rechazadas</H2>
          <Muted>El servidor no aceptó estas operaciones. Avisa al gerente: no se pierden del teléfono.</Muted>
          {rejected.map((r) => (
            <Banner key={r.opId} kind="error" title={TYPE_LABEL[r.type] ?? r.type} text={`${formatMxDateTime(r.localTs)} · ${r.lastError ?? 'sin detalle'}`} />
          ))}
        </Card>
      ) : null}

      {pending.length > 0 ? (
        <Card>
          <H2>Pendientes ({st?.pending ?? pending.length})</H2>
          {pending.map((p) => (
            <Text key={p.opId} style={{ fontSize: 14, color: colors.text }}>
              {TYPE_LABEL[p.type] ?? p.type} · {formatMxDateTime(p.localTs)}
              {p.attempts > 0 ? ` · ${p.attempts} intentos` : ''}
              {p.lastError ? ` · ${p.lastError.slice(0, 80)}` : ''}
            </Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
