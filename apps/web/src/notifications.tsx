/**
 * Notificaciones de existencias mínimas. Solo para quien tiene `estadisticas.ver` (gerente): el
 * vendedor no consulta ni ve nada de esto (y el servidor responde 403 de todos modos).
 * Se consulta GET /stats/low-stock al entrar, cada 60 s y al volver a enfocar la ventana.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './lib/api.ts';
import { errorMessage } from './lib/hooks.ts';
import { LOW_STOCK_REFRESH_MS, countLowStock, normalizeLowStock, type LowStockCounts } from './lib/notifications.ts';
import type { LowStockItem } from './lib/types-v2.ts';
import { useAuth } from './context.tsx';

interface NotificationsCtx {
  /** ¿La persona puede ver notificaciones? */
  enabled: boolean;
  items: LowStockItem[];
  counts: LowStockCounts;
  loading: boolean;
  error: string | null;
  /** Marca de tiempo (ms) de la última consulta correcta. */
  updatedAt: number | null;
  refresh: () => void;
}

const EMPTY: LowStockCounts = { total: 0, agotados: 0, bajos: 0 };

const NotificationsContext = createContext<NotificationsCtx>({
  enabled: false,
  items: [],
  counts: EMPTY,
  loading: false,
  error: null,
  updatedAt: null,
  refresh: () => undefined,
});

export const useNotifications = () => useContext(NotificationsContext);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const enabled = !!user && can('estadisticas.ver');
  const [items, setItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inflight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const raw = await api.get<unknown>('/stats/low-stock');
      if (!alive.current) return;
      setItems(normalizeLowStock(raw));
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      inflight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setError(null);
      setUpdatedAt(null);
      return;
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, LOW_STOCK_REFRESH_MS);
    const onFocus = () => void load();
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, load]);

  const value = useMemo<NotificationsCtx>(
    () => ({ enabled, items, counts: countLowStock(items), loading, error, updatedAt, refresh: () => void load() }),
    [enabled, items, loading, error, updatedAt, load],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
