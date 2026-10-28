/**
 * Persistencia de la sesión del navegador. Solo se guarda el token y el usuario
 * (nunca contraseñas) y únicamente en sessionStorage: se borra al cerrar la pestaña.
 * Todo acceso va en try/catch: el almacenamiento puede estar bloqueado.
 */
import type { SessionUser } from './types.ts';

const KEY = 'amara.web.session';

export interface StoredSession {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export function loadSession(now: number = Date.now()): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s?.token || !s.user || !s.expiresAt) return null;
    if (new Date(s.expiresAt).getTime() <= now) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: la sesión vive solo en memoria */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nada que limpiar */
  }
}

/** Preferencias locales por navegador (no sensibles). */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignorado */
  }
}
