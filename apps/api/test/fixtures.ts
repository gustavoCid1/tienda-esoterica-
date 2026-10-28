import type { Sale, SyncOp } from '@amara/shared';
import { MemoryRepo } from './memory-repo.ts';

export const B1 = 'b1111111-1111-4111-8111-111111111111';
export const B2 = 'b2222222-2222-4222-8222-222222222222';
export const T1 = 't-terminal-1';
export const GER = 'a0000001-0000-4000-8000-000000000001';
export const VEN = 'a0000002-0000-4000-8000-000000000002';
export const DEV = 'a0000003-0000-4000-8000-000000000003';
export const V1 = 'c0000001-0000-4000-8000-000000000001'; // precio 9000, costo 4000
export const V2 = 'c0000002-0000-4000-8000-000000000002'; // precio 15000, costo 8000

export const NOW = new Date('2026-10-22T18:00:00.000Z');
export const now = () => NOW;
export const ctxTerminal = { now, source: 'terminal' as const, terminal: { id: T1, branchId: B1 } };

let n = 0;
export const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function seedRepo(): MemoryRepo {
  const r = new MemoryRepo();
  r.users.set(GER, { id: GER, name: 'Gerente', role: 'gerente', active: true, branchIds: [B1, B2] });
  r.users.set(VEN, { id: VEN, name: 'Vendedora', role: 'vendedor', active: true, branchIds: [B1] });
  r.users.set(DEV, { id: DEV, name: 'Dev', role: 'desarrollador', active: true, branchIds: [B1] });
  r.terminals.set(T1, { id: T1, branchId: B1, code: 'T1' });
  r.variants.set(V1, { id: V1, priceCents: 9000, costCents: 4000 });
  r.variants.set(V2, { id: V2, priceCents: 15000, costCents: 8000 });
  r.stock.set(`${V1}|${B1}`, 10);
  r.stock.set(`${V2}|${B1}`, 1);
  return r;
}

/** Venta válida en efectivo: `qty` piezas de V1 a $90. */
export function makeSale(opts: { id?: string; qty?: number; userId?: string; sessionId?: string | null; variantId?: string; price?: number; discount?: number } = {}): Sale {
  const id = opts.id ?? uid();
  const qty = opts.qty ?? 2;
  const price = opts.price ?? 9000;
  const total = qty * price - (opts.discount ?? 0);
  return {
    id, folio: `AMA-A${T1}-261022-${id.slice(-4)}`, branchId: B1, terminalId: T1, userId: opts.userId ?? VEN, userName: 'Vendedora',
    cashSessionId: opts.sessionId ?? null, createdAt: '2026-10-22T17:00:00.000Z', subtotalCents: qty * price, discountCents: opts.discount ?? 0,
    totalCents: total, tenderedCents: total, changeCents: 0, status: 'completada',
    items: [{ id: `${id}:0`, variantId: opts.variantId ?? V1, productName: 'Vela', variantLabel: 'Chica', sku: 'VEL', code: 'AMA1', qty, unitPriceCents: price, unitCostCents: 4000, lineDiscountCents: 0, netCents: total }],
    payments: [{ method: 'efectivo', amountCents: total, tenderedCents: total, changeCents: 0 }],
  };
}

export const saleOp = (sale: Sale, opId = uid()): SyncOp => ({
  opId, type: 'sale.create', branchId: sale.branchId, terminalId: sale.terminalId, userId: sale.userId, localTs: sale.createdAt, payload: { sale },
});
