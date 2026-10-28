/** Formato y captura de importes en la interfaz. Todo el dinero viaja en centavos enteros. */
import { formatMXN, formatMxDateTime, toCents } from '@amara/shared';

export const money = formatMXN;
export const dateTime = formatMxDateTime;

/**
 * "123.45", "$1,234.5", ".5" -> centavos. Devuelve null si está vacío y NaN si no es un importe válido.
 * (Se evita Number() directo para no aceptar "1e3", "0x10" ni textos raros.)
 */
export function parsePesos(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (t === '') return null;
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return Number.NaN;
  return toCents(t);
}

/** Pesos con dos decimales para precargar un campo ("1234.50"). */
export function pesosText(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

export const MOVEMENT_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  conteo: 'Conteo físico',
};
