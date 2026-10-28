/**
 * Fechas del negocio (America/Mexico_City, UTC-6 fijo; ver @amara/shared time.ts).
 * Todas las claves de día son "AAAA-MM-DD". Funciones puras (probadas en dates.test.ts).
 */
import { MX_OFFSET_MIN, mxTodayKey } from '@amara/shared';

export { mxTodayKey };

/** Suma días a una clave de día (aritmética de calendario, sin zonas horarias). */
export function addDays(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`Fecha inválida: ${dayKey}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Día de la semana: 0 = lunes ... 6 = domingo. */
export function weekdayIndex(dayKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`Fecha inválida: ${dayKey}`);
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(); // 0 = domingo
  return (dow + 6) % 7;
}

export interface DayRange {
  from: string;
  to: string;
}

/** Semana (lunes a domingo) que contiene el día dado. */
export function weekRange(dayKey: string): DayRange {
  const start = addDays(dayKey, -weekdayIndex(dayKey));
  return { from: start, to: addDays(start, 6) };
}

/** Mes calendario que contiene el día dado. */
export function monthRange(dayKey: string): DayRange {
  const [y, mo] = dayKey.split('-').map(Number) as [number, number];
  const first = `${y}-${String(mo).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}

/** Mes calendario anterior al del día dado. */
export function previousMonthRange(dayKey: string): DayRange {
  const first = monthRange(dayKey).from;
  return monthRange(addDays(first, -1));
}

export type RangePreset = 'hoy' | 'semana' | 'mes' | 'mes_anterior' | 'ultimos_30';

/** Rango de un atajo; para "hoy/semana/mes" el fin es hoy (no el fin del período) en los tableros. */
export function presetRange(preset: RangePreset, today: string): DayRange {
  switch (preset) {
    case 'hoy':
      return { from: today, to: today };
    case 'semana':
      return { from: weekRange(today).from, to: today };
    case 'mes':
      return { from: monthRange(today).from, to: today };
    case 'mes_anterior':
      return previousMonthRange(today);
    case 'ultimos_30':
      return { from: addDays(today, -29), to: today };
  }
}

/** ¿El rango es válido (fechas bien formadas y desde <= hasta)? */
export function isValidRange(from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
}

/**
 * Valor de <input type="datetime-local"> ("2026-10-22T14:30"), interpretado en hora de México,
 * a ISO UTC con "Z" (formato que exige grantCreateSchema). null si no es válido.
 */
export function mxLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - MX_OFFSET_MIN * 60000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO UTC -> valor para <input type="datetime-local"> en hora de México. */
export function isoToMxLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MX_OFFSET_MIN * 60000);
  return d.toISOString().slice(0, 16);
}

/** Fecha/hora actual de México como valor de datetime-local. */
export function nowMxLocal(now: Date = new Date()): string {
  return isoToMxLocal(now.toISOString());
}
