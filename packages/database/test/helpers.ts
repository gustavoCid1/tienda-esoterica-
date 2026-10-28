import { DatabaseSync } from 'node:sqlite';
import { createDb, fromSyncSqlite, OPEN_PRAGMAS } from '../src/db.ts';
import { LocalStore } from '../src/local-store.ts';
import type { Actor, PullPayload } from '../src/types.ts';

export const B1 = '11111111-1111-4111-8111-111111111111';
export const B2 = '22222222-2222-4222-8222-222222222222';
export const T1 = 'term-pc-1';
export const P1 = 'aaaaaaa1-0000-4000-8000-000000000001';
export const V_CH = 'bbbbbbb1-0000-4000-8000-000000000001'; // Vela chica
export const V_GR = 'bbbbbbb2-0000-4000-8000-000000000002'; // Vela grande

export const gerente: Actor = { userId: 'cccccccc-0000-4000-8000-000000000001', userName: 'Gerente', role: 'gerente' };
export const vendedor: Actor = { userId: 'cccccccc-0000-4000-8000-000000000002', userName: 'Vendedora', role: 'vendedor' };
export const dev: Actor = { userId: 'cccccccc-0000-4000-8000-000000000003', userName: 'Dev', role: 'desarrollador' };

export class Clock {
  t: number;
  constructor(iso = '2026-10-22T16:00:00.000Z') {
    this.t = new Date(iso).getTime();
  }
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export function pullPayload(): PullPayload {
  return {
    serverTime: '2026-10-22T15:00:00.000Z',
    branches: [
      { id: B1, code: 'A', name: 'Sucursal Centro', status: 'activa', locations: ['Vitrina', 'Bodega'] },
      { id: B2, code: 'B', name: 'Sucursal Norte', status: 'activa', locations: ['Mostrador'] },
    ],
    products: [
      { id: P1, name: 'Vela ritual', type: 'Velas', category: 'Rituales', sku: 'VEL-001', specs: { color: 'dorado' }, status: 'activo', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
    ],
    variants: [
      { id: V_CH, productId: P1, label: 'Chica', unit: 'pieza', barcode: '7501234567890', internalCode: 'AMA00000001', qrValue: `amara:v1:${V_CH}`, costCents: 4000, priceCents: 9000, minStock: 3, location: 'Vitrina', status: 'activo', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: V_GR, productId: P1, label: 'Grande', unit: 'pieza', barcode: null, internalCode: 'AMA00000002', qrValue: `amara:v1:${V_GR}`, costCents: 8000, priceCents: 15000, minStock: 2, location: 'Bodega', status: 'activo', updatedAt: '2026-10-01T00:00:00.000Z' },
    ],
    stock: [
      { variantId: V_CH, branchId: B1, qty: 10 },
      { variantId: V_GR, branchId: B1, qty: 4 },
      { variantId: V_CH, branchId: B2, qty: 2 },
      { variantId: V_GR, branchId: B2, qty: 7 },
    ],
    users: [
      { id: gerente.userId, username: 'gerente', name: 'Gerente', role: 'gerente', branchIds: [B1, B2], active: true },
      { id: vendedor.userId, username: 'vendedora', name: 'Vendedora', role: 'vendedor', branchIds: [B1], active: true },
    ],
    grants: [],
  };
}

export async function newStore(opts: { path?: string; clock?: Clock } = {}) {
  const raw = new DatabaseSync(opts.path ?? ':memory:');
  raw.exec(OPEN_PRAGMAS);
  const clock = opts.clock ?? new Clock();
  const store = new LocalStore(createDb(fromSyncSqlite(raw)), { now: clock.now });
  await store.migrate();
  return { store, raw, clock };
}

/** Tienda lista para vender: catálogo cargado, terminal configurada y caja abierta. */
export async function readyStore(opts: { path?: string; clock?: Clock } = {}) {
  const ctx = await newStore(opts);
  await ctx.store.applyPull(pullPayload());
  await ctx.store.setDeviceInfo({ branchId: B1, branchCode: 'A', terminalId: T1, terminalCode: 'P1' });
  await ctx.store.openCash({ actor: gerente, branchId: B1, terminalId: T1, openingCents: 100000 });
  return ctx;
}
