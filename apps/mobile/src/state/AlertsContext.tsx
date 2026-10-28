/**
 * Notificaciones de existencias (SOLO gerente): lista de productos en mínimo, contador y aviso del teléfono.
 * Se revisa al abrir la app, tras cada sincronización y cada 5 minutos con la app abierta. El vendedor nunca carga nada
 * (y el servidor igualmente le da 403).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { can } from '@amara/shared';
import { countLowStock } from '../lib/low-stock';
import type { LowStockCounts, LowStockItem } from '../lib/low-stock';
import { loadLowStock, notifyNewLowStock } from '../services/alerts';
import { disableBackgroundAlerts, enableBackgroundAlerts } from '../services/background-alerts';
import type { BackgroundState } from '../services/background-alerts';
import { configureNotifications, permissionState, requestPermission } from '../services/notifications';
import type { PermissionState } from '../services/notifications';
import { useApp } from './AppContext';

export const ALERTS_REFRESH_MS = 5 * 60_000;

interface AlertsValue {
  enabled: boolean;
  items: LowStockItem[];
  counts: LowStockCounts;
  source: 'servidor' | 'local' | null;
  note: string | null;
  loading: boolean;
  error: string | null;
  permission: PermissionState;
  background: BackgroundState | null;
  refresh: () => Promise<void>;
  askPermission: () => Promise<PermissionState>;
}

const EMPTY: LowStockCounts = { total: 0, agotados: 0, bajos: 0 };
const Ctx = createContext<AlertsValue | null>(null);

export function useAlerts(): AlertsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAlerts debe usarse dentro de <AlertsProvider>');
  return v;
}

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const { store, device, session, phase, online, api } = app;
  const enabled = phase === 'listo' && !!session && can(session.user.role, 'estadisticas.ver');
  const [items, setItems] = useState<LowStockItem[]>([]);
  const [source, setSource] = useState<'servidor' | 'local' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>('pendiente');
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const live = useRef({ store, device, session, online });
  live.current = { store, device, session, online };
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const { store: s, device: d, session: sess, online: on } = live.current;
    if (!s || !d || !sess || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const r = await loadLowStock({ api, store: s, online: on && !!sess.token, branchId: d.branchId });
      setItems(r.items);
      setSource(r.source);
      setNote(r.note);
      setError(null);
      // Aviso del teléfono: solo lo nuevo (sin repetir). Sin permiso no se pierde: se reintenta cuando lo concedan.
      await notifyNewLowStock(s, sess.user.id, d.branchId, r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron consultar las existencias.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [api]);

  // Al abrir (entrar un gerente) y tras cada sincronización.
  const lastAttempt = app.sync.lastAttemptAt;
  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh, lastAttempt, app.dataVersion]);

  // Periódico con la app abierta.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void refresh(), ALERTS_REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  // Permiso, canal y tarea en segundo plano (solo gerente). Al salir de la sesión o no ser gerente, se quita la tarea.
  useEffect(() => {
    let off = false;
    if (!enabled) {
      setItems([]);
      setSource(null);
      void disableBackgroundAlerts();
      return;
    }
    (async () => {
      await configureNotifications();
      const p = await permissionState();
      if (off) return;
      setPermission(p);
      const b = await enableBackgroundAlerts();
      if (!off) setBackground(b);
    })();
    return () => {
      off = true;
    };
  }, [enabled]);

  const askPermission = useCallback(async () => {
    const p = await requestPermission();
    setPermission(p);
    if (p === 'concedido') void refresh();
    return p;
  }, [refresh]);

  const value = useMemo<AlertsValue>(
    () => ({ enabled, items, counts: enabled ? countLowStock(items) : EMPTY, source, note, loading, error, permission, background, refresh, askPermission }),
    [enabled, items, source, note, loading, error, permission, background, refresh, askPermission],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
