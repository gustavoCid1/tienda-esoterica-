/**
 * Tokens de seguridad (v2) en el escritorio: lógica PURA del formulario (duración, longitud, cuerpo de la petición)
 * y textos en español. El código del token se genera y se guarda SOLO en el servidor; aquí nunca se crea.
 */
import { TOKEN_CODE_MAX_LENGTH, TOKEN_MAX_MINUTES, TOKEN_MIN_MINUTES } from '@amara/shared';
import type { ActionAuthorization, TokenPurpose } from '@amara/shared';

export const PURPOSE_LABEL: Record<TokenPurpose, string> = {
  cierre_caja: 'Cerrar caja',
  devolucion: 'Devoluciones',
  cancelacion: 'Cancelaciones',
  limpias: 'Limpias',
};

export const ALL_PURPOSES: readonly TokenPurpose[] = ['cierre_caja', 'devolucion', 'cancelacion', 'limpias'];

export type DurationUnit = 'minutos' | 'horas';

/** El servidor acepta de 6 a 10 caracteres (por omisión 8). */
export const TOKEN_LENGTH_MIN_UI = 6;
export const TOKEN_LENGTH_DEFAULT_UI = 8;

export type DurationResult = { ok: true; minutes: number } | { ok: false; error: string };

/** Convierte lo escrito ("90", minutos u horas) en minutos enteros dentro de 1 minuto a 7 días. */
export function durationToMinutes(text: string, unit: DurationUnit): DurationResult {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return { ok: false, error: 'Escribe la duración.' };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'Usa solo números, por ejemplo 30 o 1.5.' };
  const n = Number(t);
  const minutes = Math.round(unit === 'horas' ? n * 60 : n);
  if (!Number.isFinite(minutes) || minutes < TOKEN_MIN_MINUTES) return { ok: false, error: 'La duración mínima es 1 minuto.' };
  if (minutes > TOKEN_MAX_MINUTES) return { ok: false, error: 'La duración máxima es 7 días (168 horas).' };
  return { ok: true, minutes };
}

/** "45 min", "2 h", "1 h 30 min", "2 días 3 h". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'día' : 'días'}`);
  if (hours > 0) parts.push(`${hours} h`);
  if (mins > 0 && days === 0) parts.push(`${mins} min`);
  return parts.join(' ');
}

/** Longitud válida del código: entero entre 6 y 10. */
export function clampLength(n: number): number {
  if (!Number.isFinite(n)) return TOKEN_LENGTH_DEFAULT_UI;
  return Math.min(TOKEN_CODE_MAX_LENGTH, Math.max(TOKEN_LENGTH_MIN_UI, Math.floor(n)));
}

export interface TokenFormInput {
  label: string;
  purposes: TokenPurpose[];
  durationText: string;
  unit: DurationUnit;
  /** null = cualquier sucursal del administrador. */
  branchId: string | null;
  /** '' = sin límite de usos. */
  maxUsesText: string;
  length: number;
  forUserId: string | null;
}

export interface TokenCreateBody {
  label: string;
  purposes: TokenPurpose[];
  durationMinutes: number;
  branchId: string | null;
  maxUses: number | null;
  length: number;
  forUserId: string | null;
}

export type TokenFormResult = { ok: true; body: TokenCreateBody } | { ok: false; error: string };

/** Valida el formulario y arma el cuerpo de la petición. */
export function buildTokenBody(f: TokenFormInput): TokenFormResult {
  const label = f.label.trim().replace(/\s+/g, ' ');
  if (label.length < 2) return { ok: false, error: 'Escribe un nombre para el token (por ejemplo "Cierre de Ana").' };
  if (label.length > 80) return { ok: false, error: 'El nombre del token es demasiado largo (máximo 80 letras).' };
  const purposes = ALL_PURPOSES.filter((p) => f.purposes.includes(p));
  if (purposes.length === 0) return { ok: false, error: 'Elige al menos un propósito.' };
  const d = durationToMinutes(f.durationText, f.unit);
  if (!d.ok) return d;
  let maxUses: number | null = null;
  const mu = f.maxUsesText.trim();
  if (mu !== '') {
    if (!/^\d+$/.test(mu) || Number(mu) < 1 || Number(mu) > 10_000) return { ok: false, error: 'Los usos máximos deben ser un número entero de 1 en adelante (o déjalo vacío).' };
    maxUses = Number(mu);
  }
  return { ok: true, body: { label, purposes, durationMinutes: d.minutes, branchId: f.branchId || null, maxUses, length: clampLength(f.length), forUserId: f.forUserId || null } };
}

/** Texto de una autorización para tickets y avisos ("Contraseña de administrador (Ana)" / "Token Cierre de Ana"). */
export function describeAuthorization(a: ActionAuthorization | null | undefined, who: string | null, tokenLabel?: string | null): string {
  if (!a) return 'Sin registro';
  if (a.kind === 'admin_password') return who ? `Contraseña de administrador (${who})` : 'Contraseña de administrador';
  const label = tokenLabel ? `Token "${tokenLabel}"` : 'Token de seguridad';
  return who ? `${label} (emitido por ${who})` : label;
}

/** Estado mostrado de un token del servidor. */
export const STATUS_LABEL: Record<string, string> = {
  vigente: 'Vigente',
  vencido: 'Vencido',
  revocado: 'Revocado',
  agotado: 'Agotado',
  pendiente: 'Aún no vigente',
};
