/**
 * Cliente HTTP mínimo hacia la API central (autenticación, activación, alta de productos).
 * Usa `net.fetch` de Electron: respeta el proxy y los certificados configurados en Windows.
 * La sincronización usa HttpSyncApi (@amara/sync) con el mismo fetch.
 */
import { net } from 'electron';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** fetch compatible con HttpSyncApi (typeof fetch). */
export const electronFetch = ((input: string | URL | Request, init?: RequestInit) =>
  net.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init as never)) as unknown as typeof fetch;

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  o: { method?: 'GET' | 'POST' | 'PATCH'; token?: string | null; body?: unknown; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 15_000);
  try {
    const res = await electronFetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.headers ?? {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = res.statusText || `Error ${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* sin cuerpo JSON */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** ¿El fallo es de red / servidor caído (se puede seguir en modo local) y no un rechazo lógico? */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500 || err.status === 408;
  return true;
}
