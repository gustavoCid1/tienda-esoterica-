import { toCents } from '@amara/shared';

/** Convierte lo escrito ("125", "125.5", "$1,250.00") a centavos; null si está vacío o es inválido. */
export function parseMoneyInput(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\$?\s*\d{1,3}(,?\d{3})*(\.\d{0,2})?$|^\$?\s*\.\d{1,2}$/.test(t)) return null;
  try {
    const c = toCents(t);
    return Number.isSafeInteger(c) && c >= 0 ? c : null;
  } catch {
    return null;
  }
}

/** Entero positivo escrito por el usuario ("3") o null. */
export function parseIntInput(text: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}): number | null {
  const t = text.trim();
  const re = opts.allowNegative ? /^-?\d{1,9}$/ : /^\d{1,9}$/;
  if (!re.test(t)) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n)) return null;
  if (n === 0 && !opts.allowZero) return null;
  return n;
}
