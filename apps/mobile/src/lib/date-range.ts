/**
 * Rangos de fechas del resumen de ventas. Todo en días calendario de México ("YYYY-MM-DD"),
 * igual que @amara/shared/time. Aritmética con Date.UTC para no depender de la zona del teléfono.
 */
export type RangePreset = 'hoy' | 'ayer' | '7dias' | 'mes' | 'personalizado';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDayKey(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function presetRange(preset: Exclude<RangePreset, 'personalizado'>, todayKey: string): { from: string; to: string } {
  switch (preset) {
    case 'hoy':
      return { from: todayKey, to: todayKey };
    case 'ayer': {
      const y = addDays(todayKey, -1);
      return { from: y, to: y };
    }
    case '7dias':
      return { from: addDays(todayKey, -6), to: todayKey };
    case 'mes':
      return { from: `${todayKey.slice(0, 8)}01`, to: todayKey };
  }
}

export const MAX_RANGE_DAYS = 366;

/** Devuelve un mensaje de error en español o null si el rango es válido. */
export function validateRange(from: string, to: string): string | null {
  if (!isValidDayKey(from) || !isValidDayKey(to)) return 'Escribe las fechas como AAAA-MM-DD (por ejemplo 2026-10-22).';
  if (from > to) return 'La fecha inicial no puede ser posterior a la final.';
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return `El intervalo no puede pasar de ${MAX_RANGE_DAYS} días.`;
  return null;
}

export function isTodayRange(from: string, to: string, todayKey: string): boolean {
  return from === todayKey && to === todayKey;
}

export function formatDayRange(from: string, to: string): string {
  const f = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
  return from === to ? f(from) : `${f(from)} al ${f(to)}`;
}
