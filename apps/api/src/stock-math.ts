/**
 * Aritmética de existencias SIN acceso a base de datos (pura y probada).
 * La existencia visible es siempre la suma de los movimientos; la fila de `stock` es una
 * copia calculada con $inc para leerla rápido.
 */

export type ManualMovementType = 'entrada' | 'salida' | 'ajuste' | 'conteo';

export class StockInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockInputError';
  }
}

/**
 * Convierte lo que captura el usuario en el delta (con signo) que se registra.
 *  - entrada/salida: cantidad positiva.
 *  - ajuste: con signo, distinto de cero.
 *  - conteo: cantidad contada; se registra la DIFERENCIA contra la existencia actual,
 *    nunca se pisa la existencia (así el historial explica cómo se llegó al número).
 */
export function movementDelta(type: ManualMovementType, qty: number, currentQty: number): number {
  if (!Number.isInteger(qty)) throw new StockInputError('La cantidad debe ser un entero');
  switch (type) {
    case 'entrada':
      if (qty <= 0) throw new StockInputError('La entrada debe ser mayor a cero');
      return qty;
    case 'salida':
      if (qty <= 0) throw new StockInputError('La salida debe ser mayor a cero');
      return -qty;
    case 'ajuste':
      if (qty === 0) throw new StockInputError('El ajuste no puede ser cero');
      return qty;
    case 'conteo':
      if (qty < 0) throw new StockInputError('La cantidad contada no puede ser negativa');
      return qty - currentQty;
  }
}

/** ¿El delta es coherente con el tipo? (las operaciones sincronizadas ya traen el delta calculado) */
export function deltaMatchesType(type: ManualMovementType, delta: number): boolean {
  if (!Number.isInteger(delta)) return false;
  if (type === 'entrada') return delta > 0;
  if (type === 'salida') return delta < 0;
  if (type === 'ajuste') return delta !== 0;
  return true; // conteo: la diferencia puede ser cero
}

export interface StockKey {
  variantId: string;
  branchId: string;
}
export interface StockQty extends StockKey {
  qty: number;
}
export interface StockDrift extends StockKey {
  /** Valor en la fila de existencias (null si no existía la fila). */
  was: number | null;
  /** Valor que resulta de sumar los movimientos. */
  shouldBe: number;
}

const keyOf = (k: StockKey) => `${k.variantId}|${k.branchId}`;

/**
 * Compara la suma de movimientos (verdad) contra las filas de existencias (copia).
 * Una fila sin ningún movimiento equivale a suma 0.
 */
export function diffStock(sums: StockQty[], rows: StockQty[]): StockDrift[] {
  const sumMap = new Map(sums.map((s) => [keyOf(s), s]));
  const rowMap = new Map(rows.map((r) => [keyOf(r), r]));
  const drifts: StockDrift[] = [];
  for (const s of sums) {
    const row = rowMap.get(keyOf(s));
    if (!row) {
      if (s.qty !== 0) drifts.push({ variantId: s.variantId, branchId: s.branchId, was: null, shouldBe: s.qty });
    } else if (row.qty !== s.qty) {
      drifts.push({ variantId: s.variantId, branchId: s.branchId, was: row.qty, shouldBe: s.qty });
    }
  }
  for (const r of rows) {
    if (!sumMap.has(keyOf(r)) && r.qty !== 0) drifts.push({ variantId: r.variantId, branchId: r.branchId, was: r.qty, shouldBe: 0 });
  }
  return drifts;
}
