/**
 * Inicio de sesión.
 *  - EN LÍNEA: POST /auth/login. Si sale bien, se guarda un VERIFICADOR scrypt (nunca la contraseña)
 *    en SecureStore para poder entrar después sin conexión.
 *  - SIN CONEXIÓN: se compara la contraseña contra ese verificador. Hay bloqueo escalonado por
 *    intentos fallidos y el verificador caduca (OFFLINE_LOGIN_MAX_DAYS).
 * El servidor revalida rol y sucursales en CADA petición: lo local solo decide qué se muestra y
 * qué puede hacerse sin red.
 */
import { can } from '@amara/shared';
import type { Role } from '@amara/shared';
import { hashPassword, verifyPassword } from '@amara/shared/password';
import type { LocalStore } from '@amara/database';
import { OFFLINE_LOGIN_MAX_DAYS, OFFLINE_SESSION_HOURS } from '../config';
import { EMPTY_LOCK, isLocked, lockRemainingMs, parseLock, registerFailure } from '../lib/lockout';
import { isProfileUsable, lockKey, normalizeUsername, parseProfile, profileKey } from '../lib/offline-login';
import type { OfflineProfile } from '../lib/offline-login';
import { ApiClient } from './api';
import { KEYS, secureDelete, secureGet, secureGetJson, secureSet, secureSetJson } from './secure';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  branchIds: string[];
}

export interface Session {
  user: AuthUser;
  /** Token de sesión del servidor; null si se entró sin conexión. */
  token: string | null;
  /** Vencimiento del token (servidor) o, sin conexión, del permiso de uso local. */
  expiresAt: string;
  loginAt: string;
  mode: 'online' | 'offline';
}

export class AuthError extends Error {
  code: 'credenciales' | 'sin_perfil' | 'bloqueado' | 'caducado' | 'rol' | 'inactivo';
  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** La app móvil es para gerente y vendedor. El desarrollador no tiene funciones operativas aquí. */
export function roleAllowedOnMobile(role: Role): boolean {
  return can(role, 'ventas.crear') || can(role, 'inventario.ver');
}

function assertRole(role: Role): void {
  if (role === 'desarrollador' || !roleAllowedOnMobile(role)) {
    throw new AuthError('rol', 'Tu rol no tiene acceso a la aplicación móvil.');
  }
}

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

/** POST /auth/login. Lanza ApiError (401 credenciales, unreachable si no hay red). */
export async function loginOnline(api: ApiClient, username: string, password: string): Promise<Session> {
  const r = await api.post<LoginResponse>('/auth/login', { username: username.trim(), password }, { auth: false });
  assertRole(r.user.role);
  return {
    user: { id: r.user.id, name: r.user.name, username: r.user.username, role: r.user.role, branchIds: r.user.branchIds ?? [] },
    token: r.token,
    expiresAt: r.expiresAt,
    loginAt: new Date().toISOString(),
    mode: 'online',
  };
}

/** Guarda el verificador para entrar sin conexión. Devuelve false si no fue posible (p. ej. contraseña corta). */
export async function saveOfflineProfile(user: AuthUser, password: string): Promise<boolean> {
  let verifier: string;
  try {
    // scrypt N=2^15 (~32 MB): puede tardar varios segundos en teléfonos modestos. Ver PENDIENTES.
    verifier = hashPassword(password);
  } catch {
    return false;
  }
  const profile: OfflineProfile = {
    userId: user.id,
    username: normalizeUsername(user.username),
    name: user.name,
    role: user.role,
    branchIds: user.branchIds,
    verifier,
    verifiedAt: new Date().toISOString(),
  };
  await secureSet(profileKey(user.username), JSON.stringify(profile));
  return true;
}

/** ¿Este usuario ya puede entrar sin conexión en este teléfono? */
export async function hasOfflineProfile(username: string): Promise<boolean> {
  return parseProfile(await secureGet(profileKey(username))) !== null;
}

/** Deja ver el estado de la pantalla antes de bloquear el hilo con scrypt. */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 60));

export async function loginOffline(store: LocalStore, username: string, password: string, nowMs: number = Date.now()): Promise<Session> {
  const profile = parseProfile(await secureGet(profileKey(username)));
  if (!profile) throw new AuthError('sin_perfil', 'Este usuario aún no ha iniciado sesión con internet en este teléfono. Conéctate la primera vez.');

  const lock = parseLock(await secureGet(lockKey(username)));
  if (isLocked(lock, nowMs)) {
    const min = Math.ceil(lockRemainingMs(lock, nowMs) / 60_000);
    throw new AuthError('bloqueado', `Demasiados intentos fallidos. Espera ${min} min o inicia sesión con internet.`);
  }

  const usable = isProfileUsable(profile, nowMs, OFFLINE_LOGIN_MAX_DAYS);
  if (!usable.ok) throw new AuthError('caducado', usable.reason ?? 'El acceso sin conexión caducó.');

  await yieldToUi();
  let ok = false;
  try {
    ok = verifyPassword(password, profile.verifier);
  } catch {
    ok = false;
  }
  if (!ok) {
    await secureSet(lockKey(username), JSON.stringify(registerFailure(lock, nowMs)));
    throw new AuthError('credenciales', 'Usuario o contraseña incorrectos.');
  }
  await secureSet(lockKey(username), JSON.stringify(EMPTY_LOCK));

  // Los datos descargados más recientes mandan sobre el perfil: si el gerente desactivó al usuario
  // o cambió su rol/sucursales y el teléfono ya lo sabe, se respeta.
  let role: Role = profile.role;
  let branchIds = profile.branchIds;
  const row = await store.db.get<{ role: Role; branch_ids_json: string; active: number }>('SELECT role, branch_ids_json, active FROM users_local WHERE id = ?', [profile.userId]);
  if (row) {
    if (row.active === 0) throw new AuthError('inactivo', 'Este usuario fue desactivado. Consulta con el gerente.');
    role = row.role;
    try {
      const parsed = JSON.parse(row.branch_ids_json) as unknown;
      if (Array.isArray(parsed)) branchIds = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      /* se conserva lo del perfil */
    }
  }
  assertRole(role);

  return {
    user: { id: profile.userId, name: profile.name, username: profile.username, role, branchIds },
    token: null,
    expiresAt: new Date(nowMs + OFFLINE_SESSION_HOURS * 3_600_000).toISOString(),
    loginAt: new Date(nowMs).toISOString(),
    mode: 'offline',
  };
}

/** Copia el verificador a users_local (si la fila ya se descargó) para que también lo use el resto de la app. */
export async function mirrorVerifierToStore(store: LocalStore, user: AuthUser): Promise<void> {
  const profile = parseProfile(await secureGet(profileKey(user.username)));
  if (profile) await store.setUserVerifier(user.id, profile.verifier);
}

// ───────────── Persistencia de la sesión ─────────────
export async function loadSession(): Promise<Session | null> {
  return secureGetJson<Session>(KEYS.session);
}

export async function saveSession(s: Session): Promise<void> {
  await secureSetJson(KEYS.session, s);
}

export async function clearSession(): Promise<void> {
  await secureDelete(KEYS.session);
}

export function sessionIsValid(s: Session | null, nowMs: number): s is Session {
  if (!s || !s.user || typeof s.expiresAt !== 'string') return false;
  const exp = Date.parse(s.expiresAt);
  return Number.isFinite(exp) && nowMs < exp;
}
