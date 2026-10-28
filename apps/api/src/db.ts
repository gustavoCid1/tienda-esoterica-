/**
 * Conexión a MongoDB Atlas e índices.
 * Todos los documentos usan _id = UUID (string) generado por el dispositivo que los crea
 * y repiten el valor en `id` para facilitar los informes compartidos.
 *
 * NOTA sobre transacciones: el diseño NO depende de transacciones multi-documento
 * (no pude confirmar su disponibilidad en el plan gratuito M0). La consistencia se logra con:
 *  - _id único = idempotencia (insertar dos veces el mismo movimiento/venta falla con E11000),
 *  - existencias como $inc atómico + movimientos como fuente de verdad,
 *  - `reconcileStock()` recalcula existencias desde los movimientos si algo quedó a medias.
 */
import { MongoClient } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import { config } from './config.ts';

let client: MongoClient | undefined;
let db: Db | undefined;

export const COLLECTIONS = [
  'users', 'branches', 'terminals', 'products', 'variants', 'stock', 'inventory_movements', 'transfers',
  'sales', 'sale_adjustments', 'cash_sessions', 'cash_movements', 'grants', 'sync_events', 'sync_conflicts',
  'audit_log', 'settings', 'backups_log', 'dashboard_prefs', 'counters',
] as const;

export async function connect(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(config.dbName);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Base de datos no conectada');
  return db;
}

export const col = <T extends object = any>(name: (typeof COLLECTIONS)[number]): Collection<T> => getDb().collection<T>(name);

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}

export async function ensureIndexes(): Promise<void> {
  const d = getDb();
  const idx = (name: string, specs: [any, any?][]) => Promise.all(specs.map(([k, o]) => d.collection(name).createIndex(k, o)));
  await Promise.all([
    idx('users', [[{ username: 1 }, { unique: true }]]),
    idx('branches', [[{ code: 1 }, { unique: true }]]),
    idx('terminals', [[{ code: 1 }, { unique: true }], [{ branchId: 1 }]]),
    idx('products', [[{ sku: 1 }, { unique: true }], [{ name: 1 }], [{ updatedAt: 1 }], [{ category: 1 }]]),
    idx('variants', [
      [{ internalCode: 1 }, { unique: true }],
      [{ barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } }],
      [{ productId: 1 }],
      [{ updatedAt: 1 }],
    ]),
    idx('stock', [[{ variantId: 1, branchId: 1 }, { unique: true }], [{ branchId: 1 }]]),
    idx('inventory_movements', [[{ variantId: 1, branchId: 1, createdAt: -1 }], [{ refId: 1 }], [{ branchId: 1, createdAt: -1 }], [{ opId: 1 }]]),
    idx('transfers', [[{ createdAt: -1 }]]),
    idx('sales', [[{ branchId: 1, createdAt: -1 }], [{ folio: 1 }], [{ userId: 1, createdAt: -1 }], [{ cashSessionId: 1 }], [{ createdAt: -1 }]]),
    idx('sale_adjustments', [[{ saleId: 1 }], [{ branchId: 1, createdAt: -1 }], [{ cashSessionId: 1 }]]),
    // Una sola caja abierta por terminal, garantizado por la base de datos.
    idx('cash_sessions', [
      [{ terminalId: 1 }, { unique: true, partialFilterExpression: { status: 'abierta' } }],
      [{ branchId: 1, openedAt: -1 }],
    ]),
    idx('cash_movements', [[{ sessionId: 1 }]]),
    idx('grants', [[{ sellerId: 1, branchId: 1, expiresAt: 1 }]]),
    idx('sync_events', [[{ receivedAt: -1 }], [{ terminalId: 1 }], [{ status: 1, receivedAt: 1 }]]),
    idx('sync_conflicts', [[{ status: 1, createdAt: -1 }], [{ branchId: 1, status: 1 }]]),
    idx('audit_log', [[{ at: -1 }], [{ entity: 1, entityId: 1 }]]),
    idx('dashboard_prefs', [[{ userId: 1 }, { unique: true }]]),
  ]);
}
