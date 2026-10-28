/**
 * Perfil para iniciar sesión SIN conexión. Se crea tras un inicio de sesión EN LÍNEA exitoso.
 * Guarda un verificador scrypt (nunca la contraseña) en expo-secure-store.
 */
import type { Role } from '@amara/shared';

export interface OfflineProfile {
  userId: string;
  username: string;
  name: string;
  role: Role;
  branchIds: string[];
  /** Formato scrypt$N$r$p$sal$hash (ver @amara/shared/password). */
  verifier: string;
  /** ISO del último inicio de sesión en línea que lo respaldó. */
  verifiedAt: string;
}

export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

/** Llave de SecureStore (solo A-Z a-z 0-9 . - _ ): se codifica el usuario en hexadecimal. */
export function profileKey(username: string): string {
  const hex = Array.from(new TextEncoder().encode(normalizeUsername(username)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `amara.profile.${hex}`;
}

export function lockKey(username: string): string {
  return profileKey(username).replace('amara.profile.', 'amara.lock.');
}

/** ¿El verificador es lo bastante reciente para aceptarlo sin conexión? */
export function isProfileUsable(p: Pick<OfflineProfile, 'verifiedAt'>, nowMs: number, maxDays: number): { ok: boolean; reason?: string } {
  const t = Date.parse(p.verifiedAt);
  if (!Number.isFinite(t)) return { ok: false, reason: 'El acceso sin conexión de este usuario no es válido. Inicia sesión con internet.' };
  if (nowMs < t - 5 * 60_000) return { ok: false, reason: 'La hora del teléfono es anterior al último inicio de sesión en línea. Corrígela.' };
  const days = (nowMs - t) / 86_400_000;
  if (days > maxDays) return { ok: false, reason: `Hace más de ${maxDays} días que no inicias sesión con internet. Conéctate para renovar el acceso.` };
  return { ok: true };
}

export function parseProfile(raw: string | null | undefined): OfflineProfile | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OfflineProfile>;
    if (typeof v.userId === 'string' && typeof v.username === 'string' && typeof v.name === 'string' && typeof v.verifier === 'string' && typeof v.verifiedAt === 'string' && Array.isArray(v.branchIds) && (v.role === 'gerente' || v.role === 'vendedor' || v.role === 'desarrollador')) {
      return v as OfflineProfile;
    }
  } catch {
    /* JSON dañado */
  }
  return null;
}
