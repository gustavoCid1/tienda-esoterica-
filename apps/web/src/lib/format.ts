/** Formateo y conversión de valores para mostrar y capturar. Funciones puras (probadas en format.test.ts). */
import { formatMXN, toCents } from '@amara/shared';

export { formatMXN };

/** Convierte lo que escribe la persona ("1,234.50", "$99") a centavos; null si está vacío o es inválido. */
export function parseMoneyInput(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  // Solo dígitos, separadores de miles, un punto decimal y el signo de pesos.
  if (!/^\$?\s*\d{1,3}(,?\d{3})*(\.\d{1,2})?$|^\$?\s*\d+(\.\d{1,2})?$/.test(t)) return null;
  try {
    return toCents(t);
  } catch {
    return null;
  }
}

/** Centavos -> texto editable "123.45" (sin símbolo ni separador de miles). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Entero >= 0 desde texto; null si no es un entero válido. */
export function parseIntInput(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "2026-10" -> "oct 2026". */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MESES[idx]} ${m[1]}` : key;
}

/** "2026-10" -> "octubre de 2026". */
export function monthLabelLong(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MESES_LARGO[idx]} de ${m[1]}` : key;
}

/** "2026-10-22" -> "22/10/2026". */
export function dayLabel(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dayKey;
}

/** Duración en minutos -> "1 h 30 min". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Cantidad con separador de miles ("1,250"). */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Bytes -> "1.5 MB". */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Diferencia de caja con signo y palabra: faltante / sobrante / cuadra. */
export function describeCashDifference(diffCents: number): string {
  if (diffCents === 0) return 'Cuadra';
  return diffCents < 0 ? `Faltante ${formatMXN(Math.abs(diffCents))}` : `Sobrante ${formatMXN(diffCents)}`;
}

/** Convierte una lista de filas en CSV (RFC 4180), con BOM opcional para Excel en español. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][], bom = true): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = (headers.length ? [headers, ...rows] : rows).map((r) => r.map(esc).join(',')).join('\r\n');
  return (bom ? '﻿' : '') + body;
}
