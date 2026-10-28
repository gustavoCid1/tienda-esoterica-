/**
 * Tokens de seguridad (gerente): duración, validación del formulario, estado y lectura tolerante
 * de las respuestas. Lógica pura (tokens.test.ts). El código del token NUNCA se calcula ni se
 * guarda aquí: lo genera el servidor y se muestra una sola vez.
 */
import type {
  SecurityTokenRow, TokenCreateBody, TokenCreateResponse, TokenPurpose, TokenStatus,
} from './types-v2.ts';

export const TOKEN_PURPOSES: { id: TokenPurpose; label: string; hint: string }[] = [
  { id: 'cierre_caja', label: 'Cierre de caja', hint: 'Permite cerrar la caja a un vendedor.' },
  { id: 'devolucion', label: 'Devolución', hint: 'Permite registrar una devolución.' },
  { id: 'cancelacion', label: 'Cancelación', hint: 'Permite cancelar una venta.' },
  { id: 'limpias', label: 'Limpias', hint: 'Permite entrar a Limpias a un vendedor.' },
];

export const PURPOSE_LABEL: Record<TokenPurpose, string> = {
  cierre_caja: 'Cierre de caja',
  devolucion: 'Devolución',
  cancelacion: 'Cancelación',
  limpias: 'Limpias',
};

export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 7 * 24 * 60;
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 10;
export const DEFAULT_CODE_LENGTH = 8;

export type DurationUnit = 'minutos' | 'horas';

export function purposeLabel(p: string): string {
  return (PURPOSE_LABEL as Record<string, string>)[p] ?? p;
}

/** Texto -> número aceptando coma decimal ("1,5"); null si no es un número finito. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Duración capturada -> minutos enteros (horas pueden llevar decimales: 1.5 h = 90 min). null si no es válida. */
export function durationToMinutes(amount: string | number, unit: DurationUnit): number | null {
  const n = typeof amount === 'number' ? (Number.isFinite(amount) ? amount : null) : parseNumber(amount);
  if (n === null || n <= 0) return null;
  return Math.round(unit === 'horas' ? n * 60 : n);
}

/** Minutos -> "45 min", "1 h 30 min", "2 h", "1 día", "2 días 3 h". */
export function formatTokenDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) {
    const dayText = `${d} ${d === 1 ? 'día' : 'días'}`;
    return h > 0 ? `${dayText} ${h} h` : m > 0 ? `${dayText} ${m} min` : dayText;
  }
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** Minutos entre dos ISO (redondeo hacia arriba), para mostrar la duración elegida de un token ya creado. */
export function minutesBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return Math.ceil((b - a) / 60000);
}

/** Estado de un token a la hora `nowIso`. La revocación manda, después el vencimiento y por último los usos. */
export function tokenStatus(
  t: Pick<SecurityTokenRow, 'revokedAt' | 'expiresAt' | 'maxUses' | 'usedCount'> & { status?: string },
  nowIso: string,
): TokenStatus {
  if (t.revokedAt) return 'revocado';
  const exp = new Date(t.expiresAt).getTime();
  if (!Number.isNaN(exp)) {
    if (exp <= new Date(nowIso).getTime()) return 'vencido';
  } else if (t.status) {
    const s = t.status.toLowerCase();
    if (s.startsWith('venc')) return 'vencido';
    if (s.startsWith('revoc')) return 'revocado';
  }
  if (t.maxUses !== null && t.maxUses !== undefined && t.usedCount >= t.maxUses) return 'agotado';
  return 'vigente';
}

export const STATUS_LABEL: Record<TokenStatus, string> = {
  vigente: 'Vigente',
  vencido: 'Vencido',
  revocado: 'Revocado',
  agotado: 'Usos agotados',
};

/** "Vence en 2 h 5 min" / "Venció hace 3 h" para la lista. */
export function expiryText(expiresAt: string, nowIso: string): string {
  const diff = Math.round((new Date(expiresAt).getTime() - new Date(nowIso).getTime()) / 60000);
  if (Number.isNaN(diff)) return '';
  return diff > 0 ? `Vence en ${formatTokenDuration(diff)}` : `Venció hace ${formatTokenDuration(-diff)}`;
}

/* ------------------------------------------------------------------ Formulario */

export interface TokenForm {
  label: string;
  purposes: TokenPurpose[];
  amount: string;
  unit: DurationUnit;
  /** '' = cualquier sucursal. */
  branchId: string;
  /** '' = cualquier usuario. */
  forUserId: string;
  /** '' = ilimitado dentro de su vigencia. */
  maxUses: string;
  length: string;
}

export const EMPTY_TOKEN_FORM: TokenForm = {
  label: '',
  purposes: [],
  amount: '30',
  unit: 'minutos',
  branchId: '',
  forUserId: '',
  maxUses: '',
  length: String(DEFAULT_CODE_LENGTH),
};

export type TokenFormErrors = Partial<Record<keyof TokenForm, string>>;

export function togglePurpose(list: TokenPurpose[], p: TokenPurpose): TokenPurpose[] {
  return list.includes(p) ? list.filter((x) => x !== p) : [...list, p];
}

/** Valida y arma el cuerpo de POST /security/tokens. */
export function buildTokenPayload(form: TokenForm): { payload: TokenCreateBody | null; errors: TokenFormErrors } {
  const errors: TokenFormErrors = {};
  const label = form.label.replace(/\s+/g, ' ').trim();
  if (label.length < 2) errors.label = 'Escribe una etiqueta (mínimo 2 letras).';
  else if (label.length > 60) errors.label = 'La etiqueta es demasiado larga (máximo 60).';

  if (form.purposes.length === 0) errors.purposes = 'Elige al menos un propósito.';

  const minutes = durationToMinutes(form.amount, form.unit);
  if (minutes === null) errors.amount = 'Escribe una duración mayor que cero.';
  else if (minutes < MIN_DURATION_MIN) errors.amount = 'La duración mínima es 1 minuto.';
  else if (minutes > MAX_DURATION_MIN) errors.amount = 'La duración máxima es 7 días (168 horas).';

  let maxUses: number | undefined;
  if (form.maxUses.trim() !== '') {
    const n = parseNumber(form.maxUses);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 1000) errors.maxUses = 'Usos máximos: un entero entre 1 y 1000, o déjalo vacío.';
    else maxUses = n;
  }

  let length = DEFAULT_CODE_LENGTH;
  if (form.length.trim() !== '') {
    const n = parseNumber(form.length);
    if (n === null || !Number.isInteger(n) || n < MIN_CODE_LENGTH || n > MAX_CODE_LENGTH) {
      errors.length = `La longitud del código es de ${MIN_CODE_LENGTH} a ${MAX_CODE_LENGTH} caracteres.`;
    } else length = n;
  }

  if (Object.keys(errors).length > 0 || minutes === null) return { payload: null, errors };
  const payload: TokenCreateBody = { label, purposes: form.purposes, durationMinutes: minutes, length };
  if (form.branchId) payload.branchId = form.branchId;
  if (form.forUserId) payload.forUserId = form.forUserId;
  if (maxUses !== undefined) payload.maxUses = maxUses;
  return { payload, errors };
}

/* ---------------------------------------------------------- Respuestas del servidor */

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const PURPOSE_IDS = new Set<string>(TOKEN_PURPOSES.map((p) => p.id));

/** Lista de GET /security/tokens (arreglo o `{ items }`); descarta filas sin id. */
export function normalizeTokenRows(raw: unknown): SecurityTokenRow[] {
  const list = Array.isArray(raw) ? raw : isDict(raw) && Array.isArray(raw.items) ? raw.items : isDict(raw) && Array.isArray(raw.tokens) ? raw.tokens : [];
  const out: SecurityTokenRow[] = [];
  for (const it of list) {
    if (!isDict(it) || !s(it.id)) continue;
    out.push({
      id: s(it.id),
      label: s(it.label) || 'Sin etiqueta',
      purposes: (Array.isArray(it.purposes) ? it.purposes : []).filter((p): p is TokenPurpose => typeof p === 'string' && PURPOSE_IDS.has(p)),
      branchId: s(it.branchId) || null,
      forUserId: s(it.forUserId) || null,
      createdBy: s(it.createdBy),
      createdAt: s(it.createdAt),
      expiresAt: s(it.expiresAt),
      revokedAt: s(it.revokedAt) || null,
      maxUses: typeof it.maxUses === 'number' ? it.maxUses : null,
      usedCount: typeof it.usedCount === 'number' ? it.usedCount : 0,
      status: s(it.status) || undefined,
      createdByName: s(it.createdByName) || null,
      forUserName: s(it.forUserName) || null,
    });
  }
  return out;
}

/** Respuesta de POST /security/tokens. null si no trae código (no se debe mostrar un modal vacío). */
export function normalizeCreateResponse(raw: unknown, fallbackExpiresAt: string): TokenCreateResponse | null {
  const o = isDict(raw) && isDict(raw.token) ? raw.token : raw;
  if (!isDict(o)) return null;
  const code = s(o.code);
  if (!code) return null;
  return { id: s(o.id), code, expiresAt: s(o.expiresAt) || fallbackExpiresAt };
}

/** Texto de los propósitos: "Cierre de caja, Devolución". */
export function purposesText(purposes: string[]): string {
  return purposes.length ? purposes.map(purposeLabel).join(', ') : '-';
}
