/**
 * ¿Puede esta persona registrar una ENTRADA de mercancía ahora, en este teléfono?
 * Lógica PURA y conservadora: ante la duda, BLOQUEA.
 *
 *  - Gerente (inventario.mover): siempre puede.
 *  - Vendedor: solo con un permiso temporal VIGENTE. Sin conexión no se puede saber si el gerente lo
 *    revocó después de la última descarga, ni confiar ciegamente en el reloj. Por eso se bloquea si:
 *      a) el teléfono nunca ha sincronizado (no hay referencia de hora del servidor),
 *      b) la hora del teléfono es inválida o está ATRASADA respecto a la última hora del servidor o a la
 *         última hora que la propia app vio (alguien retrasó el reloj para "alargar" un permiso),
 *      c) los permisos se descargaron hace más de GRANT_MAX_STALE_MS (no se puede comprobar revocación).
 *  - El servidor vuelve a validar el permiso al sincronizar (la hora local solo decide en el teléfono).
 */
import { can, findActiveGrant } from '@amara/shared';
import type { Grant, Role } from '@amara/shared';
import { CLOCK_TOLERANCE_MS, humanAge } from './staleness.ts';

export const GRANT_FUNCTION = 'inventario.entrada';
/** Pasado este tiempo sin descargar permisos, ya no se confía en ellos sin conexión. */
export const GRANT_MAX_STALE_MS = 24 * 60 * 60_000;
/** Pasado este tiempo se muestra aviso (pero aún se permite). */
export const GRANT_WARN_STALE_MS = 60 * 60_000;

export type EntryDenyCode =
  | 'sin_permiso'
  | 'sin_permiso_vigente'
  | 'permiso_vencido'
  | 'hora_invalida'
  | 'sin_sincronizar'
  | 'reloj_atrasado'
  | 'permisos_viejos';

export interface EntryAccessInput {
  role: Role;
  userId: string;
  branchId: string;
  /** Permisos temporales guardados en el teléfono (grants_local). */
  grants: Grant[];
  /** Cuándo se descargaron esos permisos (máximo fetched_at) o null. */
  grantsFetchedAt: string | null;
  /** Hora del teléfono AHORA (ms). */
  nowMs: number;
  /** Hora del servidor en el último pull (meta last_pull_at) o null si nunca. */
  lastServerTimeIso: string | null;
  /** Mayor hora del teléfono vista por la app (meta clock_high_water) o null. */
  clockHighWaterIso: string | null;
}

export type EntryAccess =
  | { allowed: true; viaGrant: boolean; grant?: Grant; expiresAt?: string; minutesLeft?: number; warnings: string[] }
  | { allowed: false; code: EntryDenyCode; message: string };

const deny = (code: EntryDenyCode, message: string): EntryAccess => ({ allowed: false, code, message });

export function evaluateEntryAccess(i: EntryAccessInput): EntryAccess {
  if (can(i.role, 'inventario.mover')) return { allowed: true, viaGrant: false, warnings: [] };
  if (i.role !== 'vendedor') return deny('sin_permiso', 'Tu rol no puede registrar entradas de mercancía.');

  if (!Number.isFinite(i.nowMs)) return deny('hora_invalida', 'No se pudo leer la hora del teléfono; no se puede comprobar la vigencia del permiso.');

  const server = i.lastServerTimeIso ? Date.parse(i.lastServerTimeIso) : NaN;
  if (!Number.isFinite(server)) {
    return deny('sin_sincronizar', 'Este teléfono aún no ha sincronizado con el servidor, así que no se puede comprobar tu permiso temporal. Conéctate y sincroniza.');
  }
  if (i.nowMs < server - CLOCK_TOLERANCE_MS) {
    return deny('reloj_atrasado', 'La hora del teléfono es anterior a la última hora del servidor. Corrige la fecha y hora para poder comprobar la vigencia del permiso.');
  }
  const high = i.clockHighWaterIso ? Date.parse(i.clockHighWaterIso) : NaN;
  if (Number.isFinite(high) && i.nowMs < high - CLOCK_TOLERANCE_MS) {
    return deny('reloj_atrasado', 'La hora del teléfono parece haberse atrasado. Corrige la fecha y hora para poder comprobar la vigencia del permiso.');
  }

  const fetched = i.grantsFetchedAt ? Date.parse(i.grantsFetchedAt) : NaN;
  const grantAge = Number.isFinite(fetched) ? i.nowMs - fetched : Infinity;
  if (grantAge > GRANT_MAX_STALE_MS) {
    return deny('permisos_viejos', 'Los permisos de este teléfono tienen más de 24 horas sin actualizarse; no se puede comprobar que sigan vigentes. Sincroniza con conexión.');
  }

  const nowIso = new Date(i.nowMs).toISOString();
  const grant = findActiveGrant(i.grants, i.userId, GRANT_FUNCTION, i.branchId, nowIso);
  if (!grant) {
    const mine = i.grants.filter((g) => g.sellerId === i.userId && g.branchId === i.branchId && g.functions.includes(GRANT_FUNCTION));
    const lastExpired = mine.filter((g) => g.expiresAt <= nowIso).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
    if (lastExpired) return deny('permiso_vencido', 'Tu permiso temporal para entradas ya venció. Pide al gerente que te autorice de nuevo.');
    return deny('sin_permiso_vigente', 'No tienes un permiso temporal vigente para ingresar mercancía en esta sucursal. Pídeselo al gerente.');
  }

  const warnings: string[] = [];
  if (grantAge > GRANT_WARN_STALE_MS) {
    warnings.push(`Los permisos se actualizaron hace ${humanAge(grantAge)}. Si el gerente lo revocó después, este teléfono aún no lo sabe; el servidor lo revisará al sincronizar.`);
  }
  const minutesLeft = Math.max(0, Math.floor((Date.parse(grant.expiresAt) - i.nowMs) / 60_000));
  return { allowed: true, viaGrant: true, grant, expiresAt: grant.expiresAt, minutesLeft, warnings };
}
