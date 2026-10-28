/**
 * Existencias en MongoDB.
 *
 * Sin transacciones multi-documento (M0 podría no soportarlas), la consistencia se obtiene así:
 *  1. Se inserta el MOVIMIENTO con _id único (idempotente: reintentar no duplica).
 *  2. Solo si se insertó, se aplica $inc ATÓMICO a la fila de `stock`.
 *  3. Si el proceso muere entre 1 y 2, `reconcileStock` recalcula la existencia sumando movimientos.
 * Regla: JAMÁS se modifica una existencia sin dejar un movimiento.
 */
import type { InventoryMovement } from '@amara/shared';
import { col } from './db.ts';
import { diffStock } from './stock-math.ts';
import type { StockDrift, StockQty } from './stock-math.ts';

export { movementDelta, deltaMatchesType, diffStock, StockInputError } from './stock-math.ts';
export type { StockDrift, StockQty, ManualMovementType } from './stock-math.ts';

export type StoredMovement = InventoryMovement & { opId: string | null };

/** _id determinista: dos $inc concurrentes sobre una fila nueva no crean filas duplicadas. */
export const stockId = (variantId: string, branchId: string) => `${variantId}:${branchId}`;

const isDup = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

/** $inc atómico (con upsert). Devuelve la existencia resultante. NO crea el movimiento: usa `recordMovement`. */
export async function incStock(variantId: string, branchId: string, delta: number, location?: string | null): Promise<number> {
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (location) set.location = location;
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await col('stock').findOneAndUpdate(
        { _id: stockId(variantId, branchId) },
        { $inc: { qty: delta }, $set: set, $setOnInsert: { variantId, branchId } },
        { upsert: true, returnDocument: 'after' },
      );
      return Number(doc?.qty ?? 0);
    } catch (e) {
      // Carrera de dos upserts sobre la misma fila nueva: el segundo reintento ya la encuentra.
      if (attempt < 2 && isDup(e)) continue;
      throw e;
    }
  }
}

export async function getStockQty(variantId: string, branchId: string): Promise<number> {
  const d = await col('stock').findOne({ _id: stockId(variantId, branchId) }, { projection: { qty: 1 } });
  return Number(d?.qty ?? 0);
}

/** Inserta el movimiento; false si ya existía (mismo _id). No toca existencias. */
export async function insertMovement(m: StoredMovement): Promise<boolean> {
  try {
    await col('inventory_movements').insertOne({ _id: m.id, ...m });
    return true;
  } catch (e) {
    if (isDup(e)) return false;
    throw e;
  }
}

/** Movimiento + $inc. `qty` es null si el movimiento ya existía (no se volvió a aplicar). */
export async function recordMovement(m: StoredMovement): Promise<{ inserted: boolean; qty: number | null }> {
  const inserted = await insertMovement(m);
  if (!inserted) return { inserted: false, qty: null };
  const qty = await incStock(m.variantId, m.branchId, m.delta, m.location);
  return { inserted: true, qty };
}

export interface ReconcileResult {
  checked: number;
  drifts: StockDrift[];
  fixed: number;
  skipped: number;
}

/**
 * Recalcula existencias desde los movimientos. Corrige con compare-and-set sobre el valor observado:
 * si una venta modifica la fila mientras se reconcilia, esa corrección se omite (queda en `skipped`)
 * y se detecta en la siguiente pasada. Conviene ejecutarlo con poca actividad.
 */
export async function reconcileStock(opts: { branchIds?: string[]; dryRun?: boolean } = {}): Promise<ReconcileResult> {
  const match = opts.branchIds ? { branchId: { $in: opts.branchIds } } : {};
  const sumsRaw = await col('inventory_movements')
    .aggregate<{ _id: { variantId: string; branchId: string }; qty: number }>([
      { $match: match },
      { $group: { _id: { variantId: '$variantId', branchId: '$branchId' }, qty: { $sum: '$delta' } } },
    ])
    .toArray();
  const sums: StockQty[] = sumsRaw.map((r) => ({ variantId: r._id.variantId, branchId: r._id.branchId, qty: r.qty }));
  const rowsRaw = await col('stock').find(match).project({ variantId: 1, branchId: 1, qty: 1 }).toArray();
  const rows: StockQty[] = rowsRaw.map((r) => ({ variantId: r.variantId, branchId: r.branchId, qty: Number(r.qty ?? 0) }));

  const drifts = diffStock(sums, rows);
  let fixed = 0;
  let skipped = 0;
  if (!opts.dryRun) {
    const now = new Date().toISOString();
    for (const d of drifts) {
      const id = stockId(d.variantId, d.branchId);
      if (d.was === null) {
        try {
          await col('stock').insertOne({ _id: id, variantId: d.variantId, branchId: d.branchId, qty: d.shouldBe, updatedAt: now });
          fixed++;
        } catch (e) {
          if (isDup(e)) skipped++;
          else throw e;
        }
      } else {
        const r = await col('stock').updateOne({ _id: id, qty: d.was }, { $set: { qty: d.shouldBe, updatedAt: now } });
        if (r.modifiedCount === 1) fixed++;
        else skipped++;
      }
    }
  }
  return { checked: sums.length, drifts, fixed, skipped };
}
