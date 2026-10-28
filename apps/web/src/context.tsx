/**
 * Contextos globales: sesión y permisos, avisos, sucursales y confirmación de contraseña.
 *
 * Seguridad:
 *  - El token vive en memoria y en sessionStorage; nunca se guardan contraseñas.
 *  - La contraseña de reautenticación solo existe en el estado del modal mientras se escribe.
 *  - Los permisos de GET /auth/permissions sirven únicamente para mostrar u ocultar opciones;
 *    el servidor vuelve a autorizar cada petición.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode,
} from 'react';
import type { Permission } from '@amara/shared';
import {
  ApiError, api, asList, dropReauth, setAuthToken, setClearReauthCache, setReauthProvider, setUnauthorizedHandler,
} from './lib/api.ts';
import { clearSession, loadSession, saveSession } from './lib/session.ts';
import { errorMessage } from './lib/hooks.ts';
import type { Branch, LoginResponse, SessionUser } from './lib/types.ts';
import { Alert, Field, Modal } from './components/ui.tsx';

/* --------------------------------------------------------------------- Avisos */

interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'info';
  text: string;
}
interface ToastCtx {
  notify: (text: string, tone?: Toast['tone']) => void;
}
const ToastContext = createContext<ToastCtx>({ notify: () => undefined });
export const useToast = () => useContext(ToastContext);

function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const notify = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, tone, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------- Reautenticación */

/** Vigencia en caché del token de reautenticación: el servidor da 5 min; se usa 4:30 por margen. */
const REAUTH_TTL_MS = 270_000;

function ReauthProvider({ children }: { children: ReactNode }) {
  const cache = useRef<{ token: string; until: number } | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: unknown) => void } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setClearReauthCache(() => {
      cache.current = null;
    });
    setReauthProvider(
      () =>
        new Promise<string>((resolve, reject) => {
          if (cache.current && cache.current.until > Date.now()) {
            resolve(cache.current.token);
            return;
          }
          pending.current = { resolve, reject };
          setOpen(true);
        }),
    );
    return () => {
      setReauthProvider(null);
      setClearReauthCache(null);
    };
  }, []);

  const finish = (token: string) => {
    cache.current = { token, until: Date.now() + REAUTH_TTL_MS };
    setOpen(false);
    pending.current?.resolve(token);
    pending.current = null;
  };
  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new ApiError(0, 'Operación cancelada: no se confirmó la contraseña.'));
    pending.current = null;
  };

  return (
    <>
      {children}
      {open && <ReauthModal onDone={finish} onCancel={cancel} />}
    </>
  );
}

function ReauthModal({ onDone, onCancel }: { onDone: (token: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Escribe tu contraseña.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ token: string }>('/auth/reauth', { password });
      setPassword('');
      onDone(r.token);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Contraseña incorrecta.' : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Confirma tu contraseña"
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="reauth-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Verificando...' : 'Confirmar'}
          </button>
        </>
      }
    >
      <form id="reauth-form" onSubmit={submit} className="form">
        <p className="prose">Esta acción es sensible. Vuelve a escribir tu contraseña para continuar; la confirmación dura 5 minutos.</p>
        <Field label="Contraseña" error={error}>
          <input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------- Sesión */

interface AuthCtx {
  user: SessionUser | null;
  /** false mientras se valida una sesión guardada al abrir la página. */
  ready: boolean;
  permissions: ReadonlySet<string>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (p: Permission) => boolean;
  canAny: (ps: Permission[]) => boolean;
}

const AuthContext = createContext<AuthCtx | null>(null);
export function useAuth(): AuthCtx {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [permissions, setPermissions] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    dropReauth();
    setAuthToken(null);
    clearSession();
    setUser(null);
    setPermissions(new Set());
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const loadPermissions = useCallback(async () => {
    const r = await api.get<{ permissions: string[] }>('/auth/permissions');
    setPermissions(new Set(r.permissions ?? []));
  }, []);

  // Restaura una sesión guardada en esta pestaña y la valida contra el servidor.
  useEffect(() => {
    const s = loadSession();
    if (!s) {
      setReady(true);
      return;
    }
    setAuthToken(s.token);
    (async () => {
      try {
        // /auth/me devuelve el usuario (posiblemente envuelto en { user }); se combina con el guardado.
        const me = await api.get<Partial<SessionUser> & { user?: Partial<SessionUser> }>('/auth/me');
        await loadPermissions();
        setUser({ ...s.user, ...(me.user ?? me) });
      } catch {
        logout();
      } finally {
        setReady(true);
      }
    })();
  }, [loadPermissions, logout]);

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await api.post<LoginResponse>('/auth/login', { username: username.trim(), password });
      setAuthToken(r.token);
      try {
        await loadPermissions();
      } catch (e) {
        setAuthToken(null);
        throw e;
      }
      saveSession({ token: r.token, expiresAt: r.expiresAt, user: r.user });
      setUser(r.user);
    },
    [loadPermissions],
  );

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      permissions,
      login,
      logout,
      can: (p) => permissions.has(p),
      canAny: (ps) => ps.some((p) => permissions.has(p)),
    }),
    [user, ready, permissions, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* --------------------------------------------------------------- Sucursales */

interface BranchesCtx {
  branches: Branch[];
  loading: boolean;
  error: string | null;
  branchName: (id: string | null | undefined) => string;
  reload: () => void;
}
const BranchesContext = createContext<BranchesCtx>({
  branches: [],
  loading: false,
  error: null,
  branchName: (id) => id ?? '',
  reload: () => undefined,
});
export const useBranches = () => useContext(BranchesContext);

function BranchesProvider({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const allowed = !!user && can('sucursales.gestionar');

  useEffect(() => {
    if (!allowed) {
      setBranches([]);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get<unknown>('/admin/branches')
      .then((d) => {
        if (alive) {
          setBranches(asList<Branch>(d).map((b) => ({ ...b, locations: b.locations ?? [] })));
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [allowed, tick]);

  const value = useMemo<BranchesCtx>(
    () => ({
      branches,
      loading,
      error,
      branchName: (id) => (id ? branches.find((b) => b.id === id)?.name ?? `Sucursal ${id.slice(0, 6)}` : ''),
      reload: () => setTick((t) => t + 1),
    }),
    [branches, loading, error],
  );
  return <BranchesContext.Provider value={value}>{children}</BranchesContext.Provider>;
}

/* ------------------------------------------------------------- Composición */

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ReauthProvider>
        <AuthProvider>
          <BranchesProvider>{children}</BranchesProvider>
        </AuthProvider>
      </ReauthProvider>
    </ToastProvider>
  );
}

/** Aviso estándar cuando una pantalla se abre sin el permiso necesario. */
export function NoAccess() {
  return (
    <Alert tone="warn" title="Sin acceso">
      Tu rol no tiene permiso para ver esta sección. Si crees que es un error, pide a un gerente que revise tu usuario.
    </Alert>
  );
}
