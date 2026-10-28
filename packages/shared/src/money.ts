/** Utilidades de dinero. Todo el sistema trabaja en centavos enteros. */

/** Convierte "123.45", "$1,234.5" o 123.45 a centavos enteros. */
export function toCents(value: number | string): number {
  const n = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : value;
  if (!Number.isFinite(n)) throw new Error('Importe inválido');
  // EPSILON evita casos como 1.005 * 100 = 100.49999999999999
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100);
}

/** Formato manual (no depende de Intl, que en Android/Hermes puede variar). */
export function formatMXN(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const pesos = Math.floor(abs / 100);
  const c = abs % 100;
  const miles = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${miles}.${String(c).padStart(2, '0')}`;
}

export function isIntCents(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && Number.isSafeInteger(n);
}
