/**
 * Formulario y lectura de respuestas de los tokens de seguridad (solo gerente, en línea).
 * Lógica PURA (test/tokens-form.test.ts). El código del token NUNCA se calcula aquí: lo genera el servidor
 * (POST /security/tokens) y se muestra UNA sola vez.
 */
import type { TokenPurpose } from '@amara/shared';
import { PURPOSE_NAME } from './documents.ts';

export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 7 * 24 * 60;
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 10;
export const DEFAULT_CODE_LENGTH = 8;
/** El servidor acepta 6 a 10 en `length` (schemas.ts); la interfaz respeta ese rango. */
export const SERVER_MIN_CODE_LENGTH = 6;

export type DurationUnit = 'minutos' | 'horas';

export const TOKEN_PURPOSE_OPTIONS: { id: TokenPurpose; label: string; hint: string }[] = [
  { id: 'cierre_caja', label: PURPOSE_NAME.cierre_caja, hint: 'Permite cerrar la caja a un vendedor.' },
  { id: 'devolucion', label: PURPOSE_NAME.devolucion, hint: 'Permite registrar una devolución.' },
  { id: 'cancelacion', label: PURPOSE_NAME.cancelacion, hint: 'Permite cancelar un ticket.' },
  { id: 'limpias', label: PURPOSE_NAME.limpias, hint: 'Permite entrar a Limpias a un vendedor.' },
];

/** Texto -> número aceptando coma decimal ("1,5"); null si no es un número finito positivo. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Duración capturada -> minutos enteros (1.5 h = 90 min). null si no es válida. */
export function durationToMinutes(amount: string, unit: DurationUnit): number | null {
  const n = parseNumber(amount);
  if (n === null || n <= 0) return null;
  return Math.round(unit === 'horas' ? n * 60 : n);
}

export interface TokenFormInput {
  label: string;
  purposes: TokenPurpose[];
  durationText: string;
  unit: DurationUnit;
  codeLengthText: string;
  maxUsesText: string;
  /** null = cualquier sucursal del administrador. */
  branchId: string | null;
}

export interface TokenCreateBody {
  label: string;
  purposes: TokenPurpose[];
  durationMinutes: number;
  length: number;
  branchId?: string;
  maxUses?: number;
}

/** Valida el formulario y arma el cuerpo de POST /security/tokens. */
export function buildTokenBody(f: TokenFormInput): { ok: true; body: TokenCreateBody } | { ok: false; error: string } {
  const label = f.label.trim();
  if (label.length < 2) return { ok: false, error: 'Escribe para qué es el token (por ejemplo "Cierre de Ana").' };
  if (label.length > 80) return { ok: false, error: 'El nombre del token es demasiado largo (máximo 80 caracteres).' };
  if (f.purposes.length === 0) return { ok: false, error: 'Elige al menos un propósito.' };
  const minutes = durationToMinutes(f.durationText, f.unit);
  if (minutes === null) return { ok: false, error: 'Escribe la duración como un número mayor a cero.' };
  if (minutes < MIN_DURATION_MIN) return { ok: false, error: 'La duración mínima es 1 minuto.' };
  if (minutes > MAX_DURATION_MIN) return { ok: false, error: 'La duración máxima es 7 días.' };
  let length = DEFAULT_CODE_LENGTH;
  if (f.codeLengthText.trim() !== '') {
    const n = Number(f.codeLengthText.trim());
    if (!Number.isInteger(n) || n < SERVER_MIN_CODE_LENGTH || n > MAX_CODE_LENGTH) {
      return { ok: false, error: `El código debe tener entre ${SERVER_MIN_CODE_LENGTH} y ${MAX_CODE_LENGTH} caracteres.` };
    }
    length = n;
  }
  const body: TokenCreateBody = { label, purposes: [...f.purposes], durationMinutes: minutes, length };
  if (f.branchId) body.branchId = f.branchId;
  if (f.maxUsesText.trim() !== '') {
    const n = Number(f.maxUsesText.trim());
    if (!Number.isInteger(n) || n < 1 || n > 10_000) return { ok: false, error: 'El máximo de usos debe ser un entero de 1 a 10000 (o déjalo vacío).' };
    body.maxUses = n;
  }
  return { ok: true, body };
}

export interface CreatedToken {
  id: string;
  code: string;
  expiresAt: string;
}

/** Respuesta de POST /security/tokens. Sin `code` no hay nada que mostrar: se devuelve null. */
export function parseCreatedToken(json: unknown): CreatedToken | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.code !== 'string' || !o.code || typeof o.expiresAt !== 'string') return null;
  return { id: o.id, code: o.code, expiresAt: o.expiresAt };
}

export interface TokenRow {
  id: string;
  label: string;
  purposes: TokenPurpose[];
  branchId: string | null;
  forUserId: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number | null;
  usedCount: number;
  status: string | null;
}

const PURPOSES: readonly string[] = ['cierre_caja', 'devolucion', 'cancelacion', 'limpias'];

/** Respuesta de GET /security/tokens: `{ items }` o un arreglo. Descarta filas incompletas. */
export function parseTokenList(json: unknown): TokenRow[] {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' && Array.isArray((json as { items?: unknown }).items) ? ((json as { items: unknown[] }).items) : [];
  const out: TokenRow[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.expiresAt !== 'string') continue;
    out.push({
      id: o.id,
      label: typeof o.label === 'string' ? o.label : '',
      purposes: (Array.isArray(o.purposes) ? o.purposes : []).filter((p): p is TokenPurpose => typeof p === 'string' && PURPOSES.includes(p)),
      branchId: typeof o.branchId === 'string' ? o.branchId : null,
      forUserId: typeof o.forUserId === 'string' ? o.forUserId : null,
      createdBy: typeof o.createdBy === 'string' ? o.createdBy : '',
      createdByName: typeof o.createdByName === 'string' ? o.createdByName : null,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      expiresAt: o.expiresAt,
      revokedAt: typeof o.revokedAt === 'string' ? o.revokedAt : null,
      maxUses: typeof o.maxUses === 'number' ? o.maxUses : null,
      usedCount: typeof o.usedCount === 'number' ? o.usedCount : 0,
      status: typeof o.status === 'string' ? o.status : null,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const STATUS_LABEL: Record<string, string> = {
  vigente: 'Vigente',
  vencido: 'Vencido',
  revocado: 'Revocado',
  agotado: 'Agotado',
  pendiente: 'Aún no vigente',
};
