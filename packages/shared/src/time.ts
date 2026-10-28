/**
 * Manejo de fechas en America/Mexico_City.
 *
 * México eliminó el horario de verano en octubre de 2022, por lo que la zona
 * America/Mexico_City es UTC-06:00 todo el año. Se usa un desfase fijo para que
 * el cálculo sea idéntico en servidor, Windows y Android (Hermes no siempre
 * trae datos completos de zonas horarias). Si México volviera a cambiar de
 * horario, solo hay que modificar MX_OFFSET_MIN.
 */
export const MX_OFFSET_MIN = -360;
export const MX_TIMEZONE = 'America/Mexico_City';

/** "2026-10-22" correspondiente a un instante UTC, en hora de México. */
export function mxDayKey(iso: string | Date): string {
  const ms = (typeof iso === 'string' ? new Date(iso) : iso).getTime();
  return new Date(ms + MX_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

export function mxMonthKey(iso: string | Date): string {
  return mxDayKey(iso).slice(0, 7);
}

export function mxTodayKey(now: Date = new Date()): string {
  return mxDayKey(now);
}

/** Inicio (inclusive) y fin (exclusivo) UTC de un día calendario de México. */
export function mxDayBounds(dayKey: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`Fecha inválida: ${dayKey}`);
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - MX_OFFSET_MIN * 60000;
  return { from: new Date(start).toISOString(), to: new Date(start + 86400000).toISOString() };
}

/** Intervalo [desde, hasta] de días (ambos inclusive) → límites UTC [from, to). */
export function mxRangeBounds(fromDay: string, toDay: string): { from: string; to: string } {
  return { from: mxDayBounds(fromDay).from, to: mxDayBounds(toDay).to };
}

/** Formato legible de fecha/hora en México: "22/10/2026 01:09". */
export function formatMxDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MX_OFFSET_MIN * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
