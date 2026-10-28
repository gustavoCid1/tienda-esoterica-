/** Implementación de `SyncRepo` sobre MongoDB. Toda inserción idempotente usa _id único y trata E11000 como "ya existía". */
import type { CashMovement, Grant, Sale, SaleAdjustment } from '@amara/shared';
import { col } from './db.ts';
import { incStock, insertMovement } from './stock.ts';
import type {
  AuditRec,
  CashData,
  CashSessionRec,
  ConflictRec,
  StoredAdjustment,
  StoredMovement,
  StoredSale,
  SyncEventRec,
  SyncRepo,
  TerminalRec,
  UserRec,
  VariantRec,
} from './sync-apply.ts';

const isDup = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

async function insertIdempotent(collection: Parameters<typeof col>[0], doc: { id: string } & Record<string, unknown>): Promise<boolean> {
  try {
    await col(collection).insertOne({ _id: doc.id, ...doc });
    return true;
  } catch (e) {
    if (isDup(e)) return false;
    throw e;
  }
}

/** Quita _id de Mongo para devolver el tipo de dominio (que ya trae `id`). */
const strip = <T>(d: any): T => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest } as T;
};

export function createMongoSyncRepo(): SyncRepo {
  return {
    insertEvent: (ev: SyncEventRec) => insertIdempotent('sync_events', ev as any),
    async getEvent(opId) {
      const d = await col('sync_events').findOne({ _id: opId });
      return d ? strip<SyncEventRec>(d) : null;
    },
    async finishEvent(opId, patch) {
      const { id: _ignored, ...set } = patch as Record<string, unknown>;
      await col('sync_events').updateOne({ _id: opId }, { $set: set });
    },
    async listStuckEvents(receivedBeforeIso, limit) {
      const docs = await col('sync_events')
        .find({ $or: [{ status: 'error' }, { status: 'procesando', receivedAt: { $lt: receivedBeforeIso } }] })
        .sort({ receivedAt: 1 })
        .limit(limit)
        .toArray();
      return docs.map((d) => strip<SyncEventRec>(d));
    },
    async hasPendingEvents(terminalId, exceptOpId) {
      const n = await col('sync_events').countDocuments({ terminalId, status: { $in: ['procesando', 'error'] }, _id: { $ne: exceptOpId } }, { limit: 1 });
      return n > 0;
    },

    async getUser(id) {
      const u = await col('users').findOne({ _id: id }, { projection: { name: 1, role: 1, active: 1, branchIds: 1 } });
      if (!u) return null;
      const rec: UserRec = { id: u._id, name: u.name, role: u.role, active: !!u.active, branchIds: u.branchIds ?? [] };
      return rec;
    },
    async getTerminal(id) {
      const t = await col('terminals').findOne({ _id: id }, { projection: { branchId: 1, code: 1 } });
      return t ? ({ id: t._id, branchId: t.branchId, code: t.code } as TerminalRec) : null;
    },
    async listGrants(sellerId, branchId) {
      const docs = await col('grants').find({ sellerId, branchId }).sort({ startsAt: -1 }).limit(200).toArray();
      return docs.map((d) => strip<Grant>(d));
    },
    async getVariant(id) {
      const v = await col('variants').findOne({ _id: id }, { projection: { priceCents: 1, costCents: 1 } });
      return v ? ({ id: v._id, priceCents: v.priceCents, costCents: v.costCents } as VariantRec) : null;
    },

    async getSale(id) {
      const d = await col('sales').findOne({ _id: id });
      return d ? strip<Sale>(d) : null;
    },
    insertSale: (sale: StoredSale) => insertIdempotent('sales', sale as any),
    async folioTaken(folio, exceptSaleId) {
      return (await col('sales').findOne({ folio, _id: { $ne: exceptSaleId } }, { projection: { _id: 1 } })) !== null;
    },
    async setSaleCancelled(saleId) {
      // Único cambio permitido sobre una venta: pasar de completada a cancelada (el detalle queda en el ajuste).
      await col('sales').updateOne({ _id: saleId, status: 'completada' }, { $set: { status: 'cancelada' } });
    },
    async listAdjustmentsForSale(saleId) {
      const docs = await col('sale_adjustments').find({ saleId }).toArray();
      return docs.map((d) => strip<SaleAdjustment>(d));
    },
    insertAdjustment: (adj: StoredAdjustment) => insertIdempotent('sale_adjustments', adj as any),

    insertMovement: (m: StoredMovement) => insertMovement(m),
    incStock: (variantId, branchId, delta, location) => incStock(variantId, branchId, delta, location),

    async getCashSession(id) {
      const d = await col('cash_sessions').findOne({ _id: id });
      return d ? strip<CashSessionRec>(d) : null;
    },
    async insertCashSession(s) {
      try {
        await col('cash_sessions').insertOne({ _id: s.id, ...s });
        return 'inserted';
      } catch (e) {
        if (!isDup(e)) throw e;
        const exists = await col('cash_sessions').findOne({ _id: s.id }, { projection: { _id: 1 } });
        return exists ? 'exists' : 'terminal_busy'; // el índice único parcial por terminal abierta
      }
    },
    insertCashMovement: (m: CashMovement & { receivedAt: string; syncOpId: string }) => insertIdempotent('cash_movements', m as any),
    async cashDataForSession(sessionId): Promise<CashData> {
      const [sales, adjustments, movements] = await Promise.all([
        col('sales').find({ cashSessionId: sessionId }).project({ cashSessionId: 1, payments: 1 }).toArray(),
        col('sale_adjustments').find({ cashSessionId: sessionId }).project({ cashSessionId: 1, payments: 1 }).toArray(),
        col('cash_movements').find({ sessionId }).project({ sessionId: 1, type: 1, amountCents: 1 }).toArray(),
      ]);
      return { sales: sales as any, adjustments: adjustments as any, movements: movements as any };
    },
    async closeCashSession(sessionId, patch) {
      const r = await col('cash_sessions').updateOne(
        { _id: sessionId, $or: [{ status: 'abierta' }, { duplicateOpen: true, closeOpId: { $exists: false } }] },
        { $set: patch },
      );
      return r.matchedCount === 1;
    },

    insertConflict: (c: ConflictRec) => insertIdempotent('sync_conflicts', c as any),
    async audit(a: AuditRec) {
      const doc = {
        _id: a.id, id: a.id, at: a.at, userId: a.userId ?? null, action: a.action, entity: a.entity ?? null,
        entityId: a.entityId ?? null, branchId: a.branchId ?? null, terminalId: a.terminalId ?? null, detail: a.detail ?? null,
      };
      try {
        await col('audit_log').insertOne(doc);
      } catch (e) {
        if (!isDup(e)) throw e;
      }
    },
  };
}
