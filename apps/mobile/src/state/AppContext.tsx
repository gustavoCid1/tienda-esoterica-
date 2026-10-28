/**
 * Estado global: base local, sesión, terminal, sucursal, conexión y sincronización en segundo plano.
 *
 * Fases de arranque (las usa app/_layout.tsx para decidir la pantalla):
 *   cargando -> (error) -> login -> terminal -> sucursal -> listo
 *
 * Sincronización automática (runSyncCycle: primero envía, luego baja): al abrir la app, al volver a
 * primer plano, al recuperar la conexión (NetInfo) y cada SYNC_INTERVAL_MS con la app abierta.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { can } from '@amara/shared';
import type { Permission } from '@amara/shared';
import type { Actor, DeviceInfo, LocalStore } from '@amara/database';
import type { CycleReport } from '@amara/sync';
import { SYNC_INTERVAL_MS, SYNC_MIN_GAP_MS, defaultApiUrl } from '../config';
import { ApiClient } from '../services/api';
import {
  clearSession,
  hasOfflineProfile,
  loadSession,
  loginOffline,
  loginOnline,
  mirrorVerifierToStore,
  saveOfflineProfile,
  saveSession,
  sessionIsValid,
} from '../services/auth';
import type { Session } from '../services/auth';
import { loadBranches, openStore } from '../services/database';
import type { BranchRow } from '../services/database';
import { touchClockHighWater } from '../services/entry';
import { KEYS, secureDelete, secureGet, secureGetJson, secureSet, secureSetJson } from '../services/secure';
import { runSync } from '../services/sync';
import { CLOCK_TOLERANCE_MS } from '../lib/staleness';

export type Phase = 'cargando' | 'error' | 'login' | 'terminal' | 'sucursal' | 'listo';
export type ScanMode = 'venta' | 'inventario';

export interface TerminalCfg {
  terminalId: string;
  terminalCode: string;
}

export type SyncStatusRow = Awaited<ReturnType<LocalStore['syncStatus']>>;

export interface SyncUi {
  running: boolean;
  lastReport: CycleReport | null;
  lastAttemptAt: string | null;
  status: SyncStatusRow | null;
}

export interface AppContextValue {
  phase: Phase;
  fatalError: string | null;
  store: LocalStore | null;
  session: Session | null;
  actor: Actor | null;
  terminal: TerminalCfg | null;
  device: DeviceInfo | undefined;
  branches: BranchRow[];
  /** Sucursales a las que el usuario tiene acceso, con nombre si ya se descargó. */
  myBranches: BranchRow[];
  online: boolean;
  apiUrl: string;
  api: ApiClient;
  mode: ScanMode;
  setMode: (m: ScanMode) => void;
  sync: SyncUi;
  /** Sube cada vez que cambian los datos locales (para que las pantallas vuelvan a consultar). */
  dataVersion: number;
  notifyDataChanged: () => void;
  /** El servidor rechazó la sesión/terminal (401/403) en la última sincronización. */
  needsOnlineLogin: boolean;
  can: (p: Permission) => boolean;
  login: (username: string, password: string) => Promise<{ offlineReady: boolean }>;
  loginWithoutConnection: (username: string, password: string) => Promise<void>;
  reauthOnline: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  setApiUrl: (url: string) => Promise<void>;
  saveTerminal: (cfg: TerminalCfg, token?: string) => Promise<void>;
  selectBranch: (branchId: string) => Promise<void>;
  syncNow: (reason?: 'manual' | 'auto') => Promise<CycleReport | null>;
  refreshSyncStatus: () => Promise<void>;
  hasOfflineLogin: (username: string) => Promise<boolean>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp debe usarse dentro de <AppProvider>');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [store, setStore] = useState<LocalStore | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [terminal, setTerminal] = useState<TerminalCfg | null>(null);
  const [device, setDevice] = useState<DeviceInfo | undefined>(undefined);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [online, setOnline] = useState(true);
  const [apiUrl, setApiUrlState] = useState('');
  const [mode, setMode] = useState<ScanMode>('venta');
  const [dataVersion, setDataVersion] = useState(0);
  const [needsOnlineLogin, setNeedsOnlineLogin] = useState(false);
  const [sync, setSync] = useState<SyncUi>({ running: false, lastReport: null, lastAttemptAt: null, status: null });

  // Referencia al estado más reciente: los temporizadores y listeners leen de aquí y no de cierres viejos.
  const live = useRef({ store, session, terminal, device, apiUrl, online });
  live.current = { store, session, terminal, device, apiUrl, online };
  const inflight = useRef<Promise<CycleReport | null> | null>(null);
  const lastRun = useRef(0);

  // ───────────── Arranque ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await openStore();
        const check = await s.integrityCheck();
        if (!check.ok) {
          // No se borra ni repara nada automáticamente: hay ventas ahí. Se avisa y se detiene.
          throw new Error(`La base de datos local reporta problemas de integridad: ${check.problems.slice(0, 3).join('; ')}`);
        }
        const [url, sess, term, dev, brs] = await Promise.all([
          secureGet(KEYS.apiUrl),
          loadSession(),
          secureGetJson<TerminalCfg>(KEYS.terminal),
          s.getDeviceInfo(),
          loadBranches(s),
        ]);
        if (cancelled) return;
        setStore(s);
        setApiUrlState((url ?? '').trim() || defaultApiUrl());
        if (sessionIsValid(sess, Date.now())) setSession(sess);
        else if (sess) await clearSession();
        if (term && term.terminalId && term.terminalCode) setTerminal(term);
        setDevice(dev);
        setBranches(brs);
        await touchClockHighWater(s);
      } catch (e) {
        if (!cancelled) setFatalError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ───────────── Fase ─────────────
  const phase: Phase = !booted
    ? 'cargando'
    : fatalError
      ? 'error'
      : !session
        ? 'login'
        : !terminal
          ? 'terminal'
          : !device || !session.user.branchIds.includes(device.branchId)
            ? 'sucursal'
            : 'listo';

  // ───────────── API ─────────────
  const api = useMemo(
    () =>
      new ApiClient({
        getBaseUrl: () => live.current.apiUrl,
        getToken: () => live.current.session?.token ?? null,
      }),
    [],
  );

  const actor: Actor | null = useMemo(() => (session ? { userId: session.user.id, userName: session.user.name, role: session.user.role } : null), [session]);

  const myBranches = useMemo<BranchRow[]>(
    () => (session ? session.user.branchIds.map((id) => branches.find((b) => b.id === id) ?? { id, code: '', name: `Sucursal ${id.slice(0, 8)}` }) : []),
    [session, branches],
  );

  // ───────────── Red ─────────────
  useEffect(() => {
    return NetInfo.addEventListener((st) => {
      // isInternetReachable puede ser null mientras se determina: se trata como conectado.
      setOnline(!!st.isConnected && st.isInternetReachable !== false);
    });
  }, []);

  const notifyDataChanged = useCallback(() => setDataVersion((v) => v + 1), []);

  const refreshSyncStatus = useCallback(async () => {
    const s = live.current.store;
    if (!s) return;
    const status = await s.syncStatus();
    setSync((prev) => ({ ...prev, status }));
  }, []);

  // ───────────── Sincronización ─────────────
  const syncNow = useCallback((reason: 'manual' | 'auto' = 'manual'): Promise<CycleReport | null> => {
    // Si ya hay un ciclo en curso se devuelve ESE mismo (quien llama puede esperar a que termine).
    if (inflight.current) return inflight.current;
    const { store: s, session: sess, terminal: term, device: dev } = live.current;
    if (!s || !sess || !term || !dev) return Promise.resolve(null);
    if (reason === 'auto' && Date.now() - lastRun.current < SYNC_MIN_GAP_MS) return Promise.resolve(null);
    lastRun.current = Date.now();
    setSync((p) => ({ ...p, running: true }));

    const p = (async (): Promise<CycleReport | null> => {
      let report: CycleReport | null = null;
      try {
        report = await runSync({
          store: s,
          baseUrl: live.current.apiUrl,
          // Se prefiere el token de la terminal (dura meses y sirve aunque la sesión de usuario haya vencido).
          getToken: async () => (await secureGet(KEYS.terminalToken)) ?? live.current.session?.token ?? null,
          branchId: dev.branchId,
          terminalId: term.terminalId,
        });
        if (report.pulled) {
          setBranches(await loadBranches(s));
          // Tras un pull correcto la hora del teléfono quedó comparada con la del servidor: si coincide, se
          // reinicia la marca de agua (permite corregir un reloj que estaba adelantado).
          const lastPull = await s.getMeta('last_pull_at');
          const lp = lastPull ? Date.parse(lastPull) : NaN;
          if (Number.isFinite(lp) && Math.abs(Date.now() - lp) < CLOCK_TOLERANCE_MS) await touchClockHighWater(s, Date.now(), true);
          else await touchClockHighWater(s);
          try {
            await mirrorVerifierToStore(s, sess.user);
          } catch {
            /* la fila de usuario puede no existir aún */
          }
        } else {
          await touchClockHighWater(s);
        }
        setNeedsOnlineLogin(report.authError);
      } catch (e) {
        report = { online: false, authError: false, sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0, pulled: false, remaining: 0, error: e instanceof Error ? e.message : String(e) };
      } finally {
        const status = await s.syncStatus().catch(() => null);
        setSync({ running: false, lastReport: report, lastAttemptAt: new Date().toISOString(), status });
        setDataVersion((v) => v + 1);
      }
      return report;
    })();
    inflight.current = p;
    void p.finally(() => {
      inflight.current = null;
    });
    return p;
  }, []);

  // Al abrir (fase listo) y periódicamente mientras la app está abierta y hay red.
  useEffect(() => {
    if (phase !== 'listo') return;
    void syncNow('auto');
    const t = setInterval(() => {
      if (live.current.online) void syncNow('auto');
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(t);
  }, [phase, syncNow]);

  // Al volver a primer plano.
  useEffect(() => {
    if (phase !== 'listo') return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        const s = live.current.store;
        if (s) void touchClockHighWater(s);
        if (live.current.online) void syncNow('auto');
      }
    });
    return () => sub.remove();
  }, [phase, syncNow]);

  // Al recuperar la conexión.
  const wasOnline = useRef(true);
  useEffect(() => {
    if (online && !wasOnline.current && phase === 'listo') void syncNow('auto');
    wasOnline.current = online;
  }, [online, phase, syncNow]);

  // Estado de sincronización disponible desde que hay base.
  useEffect(() => {
    if (store) void refreshSyncStatus();
  }, [store, refreshSyncStatus, dataVersion]);

  // ───────────── Acciones ─────────────
  const login = useCallback(
    async (username: string, password: string) => {
      if (!live.current.store) throw new Error('La base local no está lista.');
      const sess = await loginOnline(api, username, password);
      // Verificador para entrar sin conexión (scrypt; tarda unos segundos). La contraseña NO se guarda.
      const offlineReady = await saveOfflineProfile(sess.user, password);
      await saveSession(sess);
      setNeedsOnlineLogin(false);
      setSession(sess);
      return { offlineReady };
    },
    [api],
  );

  const loginWithoutConnection = useCallback(async (username: string, password: string) => {
    const s = live.current.store;
    if (!s) throw new Error('La base local no está lista.');
    const sess = await loginOffline(s, username, password);
    await saveSession(sess);
    setSession(sess);
  }, []);

  const reauthOnline = useCallback(
    async (password: string) => {
      const cur = live.current.session;
      if (!cur) throw new Error('No hay sesión.');
      const sess = await loginOnline(api, cur.user.username, password);
      if (sess.user.id !== cur.user.id) throw new Error('La cuenta no coincide con la sesión actual.');
      await saveOfflineProfile(sess.user, password);
      await saveSession(sess);
      setSession(sess);
      setNeedsOnlineLogin(false);
      void syncNow('manual');
    },
    [api, syncNow],
  );

  const logout = useCallback(async () => {
    await clearSession();
    setSession(null);
    setNeedsOnlineLogin(false);
    setMode('venta');
  }, []);

  const setApiUrl = useCallback(async (url: string) => {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) await secureSet(KEYS.apiUrl, clean);
    else await secureDelete(KEYS.apiUrl);
    const effective = clean || defaultApiUrl();
    live.current.apiUrl = effective; // disponible de inmediato para la siguiente petición
    setApiUrlState(effective);
  }, []);

  const saveTerminal = useCallback(async (cfg: TerminalCfg, token?: string) => {
    const clean = { terminalId: cfg.terminalId.trim(), terminalCode: cfg.terminalCode.trim().toUpperCase() };
    await secureSetJson(KEYS.terminal, clean);
    // token: undefined = no tocar; '' = quitar; texto = guardar (es un secreto: solo SecureStore).
    if (token !== undefined) {
      if (token.trim()) await secureSet(KEYS.terminalToken, token.trim());
      else await secureDelete(KEYS.terminalToken);
    }
    setTerminal(clean);
  }, []);

  const selectBranch = useCallback(
    async (branchId: string) => {
      const { store: s, session: sess, terminal: term } = live.current;
      if (!s || !sess || !term) throw new Error('Falta configurar la terminal.');
      if (!sess.user.branchIds.includes(branchId)) throw new Error('No tienes acceso a esa sucursal.');

      let row = (await loadBranches(s)).find((b) => b.id === branchId);
      if (!row) {
        // Primera vez con esta sucursal: hace falta descargar su catálogo (y su código para los folios).
        if (!live.current.online) throw new Error('Necesitas conexión para descargar esta sucursal por primera vez.');
        const rep = await runSync({
          store: s,
          baseUrl: live.current.apiUrl,
          getToken: async () => (await secureGet(KEYS.terminalToken)) ?? live.current.session?.token ?? null,
          branchId,
          terminalId: term.terminalId,
        });
        setBranches(await loadBranches(s));
        row = (await loadBranches(s)).find((b) => b.id === branchId);
        if (!row) {
          throw new Error(rep.error ? `No se pudo descargar la sucursal: ${rep.error}` : 'El servidor no devolvió datos de esa sucursal.');
        }
      }
      const info: DeviceInfo = { branchId: row.id, branchCode: row.code, terminalId: term.terminalId, terminalCode: term.terminalCode };
      await s.setDeviceInfo(info);
      setDevice(info);
      setBranches(await loadBranches(s));
      setDataVersion((v) => v + 1);
    },
    [],
  );

  const canDo = useCallback((p: Permission) => can(session?.user.role, p), [session]);

  const value: AppContextValue = {
    phase,
    fatalError,
    store,
    session,
    actor,
    terminal,
    device,
    branches,
    myBranches,
    online,
    apiUrl,
    api,
    mode,
    setMode,
    sync,
    dataVersion,
    notifyDataChanged,
    needsOnlineLogin,
    can: canDo,
    login,
    loginWithoutConnection,
    reauthOnline,
    logout,
    setApiUrl,
    saveTerminal,
    selectBranch,
    syncNow,
    refreshSyncStatus,
    hasOfflineLogin: hasOfflineProfile,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
