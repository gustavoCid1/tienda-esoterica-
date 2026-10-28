/**
 * Bloqueo escalonado por intentos fallidos de contraseña en el inicio de sesión SIN conexión
 * (en línea ya lo limita la API). Lógica pura; el estado se guarda en SecureStore.
 */
export interface LockState {
  failures: number;
  /** ms epoch hasta el que está bloqueado, o null. */
  lockedUntil: number | null;
}

export const EMPTY_LOCK: LockState = { failures: 0, lockedUntil: null };
export const MAX_FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;

export function isLocked(s: LockState, nowMs: number): boolean {
  return s.lockedUntil !== null && nowMs < s.lockedUntil;
}

export function lockRemainingMs(s: LockState, nowMs: number): number {
  return s.lockedUntil === null ? 0 : Math.max(0, s.lockedUntil - nowMs);
}

/** A partir del 5.º fallo: 1 min, luego 2, 4, 8... hasta 1 hora. */
export function registerFailure(s: LockState, nowMs: number): LockState {
  const failures = s.failures + 1;
  if (failures < MAX_FREE_ATTEMPTS) return { failures, lockedUntil: s.lockedUntil };
  const exp = Math.min(failures - MAX_FREE_ATTEMPTS, 10);
  const wait = Math.min(BASE_LOCK_MS * 2 ** exp, MAX_LOCK_MS);
  return { failures, lockedUntil: nowMs + wait };
}

export function registerSuccess(): LockState {
  return EMPTY_LOCK;
}

export function parseLock(raw: string | null | undefined): LockState {
  if (!raw) return EMPTY_LOCK;
  try {
    const v = JSON.parse(raw) as Partial<LockState>;
    const failures = typeof v.failures === 'number' && v.failures >= 0 ? Math.floor(v.failures) : 0;
    const lockedUntil = typeof v.lockedUntil === 'number' ? v.lockedUntil : null;
    return { failures, lockedUntil };
  } catch {
    return EMPTY_LOCK;
  }
}
