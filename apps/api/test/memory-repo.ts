/** Repositorio en memoria para probar sync-apply sin MongoDB. Imita las garantías de unicidad por _id. */
import type { CachedSecurityToken, CashMovement, Grant, Sale, SaleAdjustment } from '@amara/shared';
import type {
  AuditRec, CashData, CashSessionRec, ConflictRec, StoredAdjustment, StoredMovement, StoredSale, SyncEventRec, SyncRepo, TerminalRec, UserRec, VariantRec,
} from '../src/sync-apply.ts';

export class MemoryRepo implements SyncRepo {
  events = new Map<string, SyncEventRec>();
  users = new Map<string, UserRec>();
  terminals = new Map<string, TerminalRec>();
  grants: Grant[] = [];
  variants = new Map<string, VariantRec>();
  sales = new Map<string, StoredSale>();
  adjustments = new Map<string, StoredAdjustment>();
  movements = new Map<string, StoredMovement>();
  stock = new Map<string, number>();
  sessions = new Map<string, CashSessionRec>();
  cashMovements = new Map<string, CashMovement & { receivedAt: string; syncOpId: string }>();
  conflicts = new Map<string, ConflictRec>();
  audits = new Map<string, AuditRec>();
  /** v2 */
  tokens = new Map<string, CachedSecurityToken>();
  tokenUses = new Set<string>();

  /** Inyección de fallos: lanza la próxima vez que se llame al método indicado. */
  failOnce: Partial<Record<'incStock', Error>> = {};

  qty(variantId: string, branchId: string) {
    return this.stock.get(`${variantId}|${branchId}`) ?? 0;
  }

  async insertEvent(ev: SyncEventRec) {
    if (this.events.has(ev.id)) return false;
    this.events.set(ev.id, { ...ev });
    return true;
  }
  async getEvent(opId: string) {
    return this.events.get(opId) ?? null;
  }
  async finishEvent(opId: string, patch: Partial<SyncEventRec>) {
    const cur = this.events.get(opId);
    if (cur) this.events.set(opId, { ...cur, ...patch });
  }
  async listStuckEvents(before: string, limit: number) {
    return [...this.events.values()].filter((e) => e.status === 'error' || (e.status === 'procesando' && e.receivedAt < before)).slice(0, limit);
  }
  async hasPendingEvents(terminalId: string, except: string) {
    return [...this.events.values()].some((e) => e.terminalId === terminalId && e.id !== except && (e.status === 'procesando' || e.status === 'error'));
  }

  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getTerminal(id: string) {
    return this.terminals.get(id) ?? null;
  }
  async listGrants(sellerId: string, branchId: string) {
    return this.grants.filter((g) => g.sellerId === sellerId && g.branchId === branchId);
  }
  async getVariant(id: string) {
    return this.variants.get(id) ?? null;
  }

  async getSecurityToken(id: string) {
    return this.tokens.get(id) ?? null;
  }
  async hasTokenUse(tokenId: string, opId: string) {
    return this.tokenUses.has(`${tokenId}:${opId}`);
  }
  async consumeToken(tokenId: string, opId: string) {
    const key = `${tokenId}:${opId}`;
    if (this.tokenUses.has(key)) return 'already' as const;
    const t = this.tokens.get(tokenId);
    if (!t || (t.maxUses !== null && t.usedCount >= t.maxUses)) return 'exhausted' as const;
    this.tokenUses.add(key);
    t.usedCount += 1;
    return 'consumed' as const;
  }

  async getSale(id: string) {
    return (this.sales.get(id) as Sale | undefined) ?? null;
  }
  async insertSale(sale: StoredSale) {
    if (this.sales.has(sale.id)) return false;
    this.sales.set(sale.id, structuredClone(sale));
    return true;
  }
  async folioTaken(folio: string, except: string) {
    return [...this.sales.values()].some((s) => s.folio === folio && s.id !== except);
  }
  async setSaleCancelled(saleId: string) {
    const s = this.sales.get(saleId);
    if (s && s.status === 'completada') s.status = 'cancelada';
  }
  async listAdjustmentsForSale(saleId: string) {
    return [...this.adjustments.values()].filter((a) => a.saleId === saleId) as SaleAdjustment[];
  }
  async insertAdjustment(adj: StoredAdjustment) {
    if (this.adjustments.has(adj.id)) return false;
    this.adjustments.set(adj.id, structuredClone(adj));
    return true;
  }

  async insertMovement(m: StoredMovement) {
    if (this.movements.has(m.id)) return false;
    this.movements.set(m.id, { ...m });
    return true;
  }
  async incStock(variantId: string, branchId: string, delta: number) {
    const err = this.failOnce.incStock;
    if (err) {
      delete this.failOnce.incStock;
      throw err;
    }
    const key = `${variantId}|${branchId}`;
    const next = (this.stock.get(key) ?? 0) + delta;
    this.stock.set(key, next);
    return next;
  }

  async getCashSession(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async insertCashSession(s: CashSessionRec) {
    if (this.sessions.has(s.id)) return 'exists' as const;
    if (s.status === 'abierta' && [...this.sessions.values()].some((x) => x.terminalId === s.terminalId && x.status === 'abierta')) return 'terminal_busy' as const;
    this.sessions.set(s.id, { ...s });
    return 'inserted' as const;
  }
  async insertCashMovement(m: CashMovement & { receivedAt: string; syncOpId: string }) {
    if (this.cashMovements.has(m.id)) return false;
    this.cashMovements.set(m.id, m);
    return true;
  }
  async cashDataForSession(sessionId: string): Promise<CashData> {
    return {
      sales: [...this.sales.values()].filter((s) => s.cashSessionId === sessionId),
      adjustments: [...this.adjustments.values()].filter((a) => a.cashSessionId === sessionId),
      movements: [...this.cashMovements.values()].filter((m) => m.sessionId === sessionId),
    };
  }
  closed = new Map<string, Record<string, unknown>>();
  async closeCashSession(sessionId: string, patch: Record<string, unknown>) {
    const s = this.sessions.get(sessionId);
    if (!s || (s.status !== 'abierta' && !(s.duplicateOpen && !s.closeOpId))) return false;
    this.sessions.set(sessionId, { ...s, ...(patch as Partial<CashSessionRec>) });
    this.closed.set(sessionId, patch);
    return true;
  }

  async insertConflict(c: ConflictRec) {
    if (this.conflicts.has(c.id)) return false;
    this.conflicts.set(c.id, c);
    return true;
  }
  async audit(a: AuditRec) {
    if (!this.audits.has(a.id)) this.audits.set(a.id, a);
  }

  conflictKinds() {
    return [...this.conflicts.values()].map((c) => c.kind);
  }
}
