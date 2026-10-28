/**
 * Protocolo de sincronización cliente ↔ API.
 *
 * Principios (ver docs/SINCRONIZACION.md):
 *  1. Se sincronizan EVENTOS (ventas, ajustes, movimientos, caja), nunca cantidades finales.
 *  2. Cada evento tiene un opId único; el servidor lo aplica una sola vez (idempotencia).
 *  3. Una venta que ya ocurrió físicamente NUNCA se rechaza por existencias; se aplica y,
 *     si deja inventario negativo, se registra un CONFLICTO para el gerente.
 *  4. El cliente hace push de todo lo pendiente y SOLO después hace pull; así la existencia
 *     que baja ya incluye lo que subió y no se pierden ni se duplican las ventas locales.
 */
import type { SyncOp, SyncResult } from '@amara/shared';
import type { PullPayload } from '@amara/database';

export interface PushRequest {
  terminalId: string;
  ops: SyncOp[];
}

export interface PushResponse {
  results: SyncResult[];
  serverTime: string;
}

export interface PullQuery {
  branchId: string;
  /** serverTime del último pull exitoso; el catálogo se manda incremental, el stock completo. */
  since?: string;
}

export interface SyncApi {
  push(req: PushRequest): Promise<PushResponse>;
  pull(q: PullQuery): Promise<PullPayload>;
}

export class SyncHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
  }
}

/** Cliente HTTP hacia la API central. `fetchImpl` permite probar sin red. */
export class HttpSyncApi implements SyncApi {
  private baseUrl: string;
  private getToken: () => string | null | Promise<string | null>;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(opts: { baseUrl: string; getToken: () => string | null | Promise<string | null>; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getToken = opts.getToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const token = await this.getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          msg = ((await res.json()) as { error?: string }).error ?? msg;
        } catch {
          /* sin cuerpo JSON */
        }
        throw new SyncHttpError(res.status, msg);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  push(req: PushRequest): Promise<PushResponse> {
    return this.request('/sync/push', { method: 'POST', body: req });
  }

  pull(q: PullQuery): Promise<PullPayload> {
    const qs = new URLSearchParams({ branchId: q.branchId, ...(q.since ? { since: q.since } : {}) });
    return this.request(`/sync/pull?${qs}`, { method: 'GET' });
  }
}

/** ¿El error indica "sin conexión / servidor caído" (se reintenta) y no un rechazo lógico? */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof SyncHttpError) return err.status >= 500 || err.status === 408 || err.status === 429;
  return true; // TypeError de fetch, abort por timeout, DNS, etc.
}
