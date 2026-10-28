/** Estado global de la aplicación: dispositivo, sesión, ajustes, sincronización y respaldos. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppInfo, BackupState, DeviceState, SessionUser, SyncState } from '../../shared/ipc.ts';
import type { AppSettings } from '../../shared/settings.ts';
import { call, errorText, onEvent } from '../lib/api.ts';
import { useFeedback } from './Feedback.tsx';

interface AppApi {
  ready: boolean;
  info: AppInfo | null;
  device: DeviceState | null;
  user: SessionUser | null;
  settings: AppSettings | null;
  sync: SyncState | null;
  backup: BackupState | null;
  notice: string | null;
  dismissNotice: () => void;
  refreshDevice: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider ausente');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { toast } = useFeedback();
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [backup, setBackup] = useState<BackupState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshDevice = useCallback(async () => setDevice(await call('device:get')), []);
  const refreshSettings = useCallback(async () => setSettings(await call('settings:get')), []);

  // Carga inicial.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [i, d, s, u, sy, b] = await Promise.all([
          call('app:info'), call('device:get'), call('settings:get'), call('auth:current'), call('sync:state').catch(() => null), call('backup:state').catch(() => null),
        ]);
        if (!alive) return;
        setInfo(i);
        setNotice(i.startupNotice);
        setDevice(d);
        setSettings(s);
        setUser(u);
        setSync(sy);
        setBackup(b);
      } catch (e) {
        toast('error', errorText(e));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  // Eventos del proceso principal.
  useEffect(() => {
    const offs = [
      onEvent('evt:sync', setSync),
      onEvent('evt:backup', setBackup),
      onEvent('evt:notice', (n) => toast(n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'info', n.text)),
      onEvent('evt:session-ended', (e) => {
        setUser(null);
        toast('warn', e.reason);
      }),
    ];
    // Al volver la red se sincroniza de inmediato (además del ciclo de ~30 s).
    const online = () => void call('sync:now').catch(() => undefined);
    window.addEventListener('online', online);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('online', online);
    };
  }, [toast]);

  const login = useCallback(async (username: string, password: string) => {
    setUser(await call('auth:login', { username, password }));
  }, []);

  const logout = useCallback(async () => {
    await call('auth:logout');
    setUser(null);
  }, []);

  const value = useMemo<AppApi>(
    () => ({
      ready, info, device, user, settings, sync, backup, notice,
      dismissNotice: () => setNotice(null),
      refreshDevice, refreshSettings, login, logout,
    }),
    [ready, info, device, user, settings, sync, backup, notice, refreshDevice, refreshSettings, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
