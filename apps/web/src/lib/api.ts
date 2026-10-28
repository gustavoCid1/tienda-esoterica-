/**
 * Cliente HTTP tipado para la API central (docs/API.md).
 *
 * Reglas:
 *  - El token de sesión vive en memoria (y en sessionStorage, ver session.ts); nunca contraseñas.
 *  - 401 en una petición normal => la sesión ya no es válida => se avisa a la app para cerrar sesión.
 *  - 403 => falta permiso: se muestra el mensaje del servidor; NO se cierra sesión.
 *  - Acciones sensibles piden `reauth: true`: se obtiene un token de POST /auth/reauth (vigencia
 *    5 min) mediante el manejador registrado por la interfaz y se envía en `x-reauth`.
 *  - El servidor siempre autoriza; ocultar botones en la interfaz es solo comodidad.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const RAW_BASE = (import.meta.env.VITE_API_URL ?? '/api') as string;
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
/** Devuelve un token de reautenticación válido (pidiendo la contraseña si hace falta) o lanza. */
let reauthProvider: (() => Promise<string>) | null = null;

export function setAuthToken(token: string | null): void {
  sessionToken = token;
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}
export function setReauthProvider(fn: (() => Promise<string>) | null): void {
  reauthProvider = fn;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

/** Arma "?a=1&b=2" omitiendo vacíos; booleanos verdaderos se envían como "1". Pura y probada. */
export function buildQuery(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Exige cabecera x-reauth (acciones sensibles). */
  reauth?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Los datos enviados no son válidos.',
  401: 'La sesión no es válida o expiró. Inicia sesión de nuevo.',
  403: 'No tienes permiso para esta acción.',
  404: 'No se encontró el recurso solicitado.',
  409: 'El registro entra en conflicto con otro existente.',
  429: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  500: 'Error interno del servidor.',
};

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  if (opts.reauth) {
    if (!reauthProvider) throw new ApiError(0, 'No se pudo solicitar la confirmación de contraseña.');
    // Si el usuario cancela, el proveedor lanza ApiError(0, 'Operación cancelada').
    headers['x-reauth'] = await reauthProvider();
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'No se pudo conectar con el servidor. Revisa la red e inténtalo de nuevo.');
  }

  const data = await parseBody(res);
  if (res.ok) return data as T;

  const serverMsg = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : '';
  const message = serverMsg || DEFAULT_MESSAGES[res.status] || `Error ${res.status}`;

  // Un 401 sin reauth y fuera del login significa sesión caducada. Con reauth, o en
  // /auth/login y /auth/reauth, puede ser simplemente contraseña incorrecta.
  const isAuthEndpoint = path === '/auth/login' || path === '/auth/reauth';
  if (res.status === 401 && !opts.reauth && !isAuthEndpoint) onUnauthorized?.();
  if (opts.reauth && (res.status === 401 || res.status === 403)) clearReauthCache?.();

  throw new ApiError(res.status, message);
}

/** La interfaz registra aquí cómo invalidar el token de reautenticación en caché. */
let clearReauthCache: (() => void) | null = null;
export function setClearReauthCache(fn: (() => void) | null): void {
  clearReauthCache = fn;
}

/** Olvida el token de reautenticación en caché (al cerrar sesión). */
export function dropReauth(): void {
  clearReauthCache?.();
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) =>
    request<T>('POST', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body: unknown, opts: Omit<RequestOptions, 'body'> = {}) =>
    request<T>('PATCH', path, { ...opts, body }),
  put: <T>(path: string, body: unknown, opts: Omit<RequestOptions, 'body'> = {}) =>
    request<T>('PUT', path, { ...opts, body }),
};

/** Acepta `[...]` o `{ items: [...] }` (las listas paginadas de la API) y devuelve siempre un arreglo. */
export function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

/** Total declarado por el servidor en listas paginadas, o la longitud recibida. */
export function listTotal(data: unknown): number {
  if (data && typeof data === 'object' && typeof (data as { total?: unknown }).total === 'number') {
    return (data as { total: number }).total;
  }
  return asList(data).length;
}
