/**
 * Cliente HTTP mínimo hacia la API central (docs/API.md).
 * Errores: ApiError. `unreachable` = no hubo respuesta útil (sin red, tiempo agotado, 5xx, 408, 429):
 * la pantalla puede caer a datos locales. 401/403/4xx lógicos NO son "unreachable".
 */
export class ApiError extends Error {
  status: number;
  unreachable: boolean;
  constructor(status: number, message: string, unreachable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.unreachable = unreachable;
  }
}

export interface ApiClientOptions {
  getBaseUrl: () => string;
  getToken: () => string | null | Promise<string | null>;
  timeoutMs?: number;
}

export class ApiClient {
  private o: ApiClientOptions;
  constructor(o: ApiClientOptions) {
    this.o = o;
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, opts: { body?: unknown; auth?: boolean; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
    const base = this.o.getBaseUrl().trim().replace(/\/+$/, '');
    if (!base) throw new ApiError(0, 'Falta la dirección del servidor. Escríbela en "Servidor".');
    const token = opts.auth === false ? null : await this.o.getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? this.o.timeoutMs ?? 20_000);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let msg = res.statusText || `Error ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* sin cuerpo JSON */
        }
        throw new ApiError(res.status, msg, res.status >= 500 || res.status === 408 || res.status === 429);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // TypeError de fetch (sin red / DNS) o AbortError por tiempo agotado.
      throw new ApiError(0, 'No hay conexión con el servidor.', true);
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(path: string, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  post<T>(path: string, body?: unknown, opts?: { auth?: boolean; timeoutMs?: number; headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('POST', path, { body, ...opts });
  }

  /** v2. PUT (categorías de Extras). */
  put<T>(path: string, body?: unknown, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('PUT', path, { body, ...opts });
  }
}
