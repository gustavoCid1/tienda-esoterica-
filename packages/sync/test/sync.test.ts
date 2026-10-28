import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { newId } from '@amara/shared';
import type { SyncOp, SyncResult } from '@amara/shared';
import type { PullPayload } from '@amara/database';
import { runSyncCycle, NonceCache, verifyLanRequest, verifyPairing, LanClient, SyncHttpError } from '../src/index.ts';
import type { SyncApi, PushRequest, PushResponse, PullQuery } from '../src/index.ts';
import { B1, T1, V_CH, vendedor, gerente, readyStore, pullPayload } from '../../database/test/helpers.ts';

/** Servidor simulado: aplica cada opId una sola vez y mantiene su propio inventario. */
class FakeServer implements SyncApi {
  applied = new Set<string>();
  stock = new Map<string, number>([[`${V_CH}|${B1}`, 10]]);
  sales: string[] = [];
  down = false;
  /** Si es true, aplica el push pero "se cae la red" antes de responder. */
  dropResponseOnce = false;

  async push(req: PushRequest): Promise<PushResponse> {
    if (this.down) throw new TypeError('fetch failed');
    const results: SyncResult[] = [];
    for (const op of req.ops) {
      if (this.applied.has(op.opId)) {
        results.push({ opId: op.opId, status: 'duplicate', receivedAt: new Date().toISOString() });
        continue;
      }
      this.applied.add(op.opId);
      let status: SyncResult['status'] = 'applied';
      let conflictKind: string | undefined;
      if (op.type === 'sale.create') {
        const sale = (op.payload as any).sale;
        this.sales.push(sale.id);
        for (const it of sale.items) {
          const k = `${it.variantId}|${sale.branchId}`;
          const next = (this.stock.get(k) ?? 0) - it.qty;
          this.stock.set(k, next);
          if (next < 0) {
            status = 'conflict';
            conflictKind = 'stock_negativo';
          }
        }
      }
      results.push({ opId: op.opId, status, conflictKind, receivedAt: new Date().toISOString() });
    }
    if (this.dropResponseOnce) {
      this.dropResponseOnce = false;
      throw new TypeError('network lost after apply');
    }
    return { results, serverTime: new Date().toISOString() };
  }

  async pull(_q: PullQuery): Promise<PullPayload> {
    if (this.down) throw new TypeError('fetch failed');
    const base = pullPayload();
    base.serverTime = new Date().toISOString();
    base.stock = [...this.stock].map(([k, qty]) => {
      const [variantId, branchId] = k.split('|') as [string, string];
      return { variantId, branchId, qty };
    });
    return base;
  }
}

const sell = (store: any, qty = 1, actor = vendedor) =>
  store.registerSale({ saleId: newId(), actor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty }], payments: [{ method: 'efectivo', amountCents: 9000 * qty, tenderedCents: 9000 * qty }] });

test('sin internet: la venta se guarda y la cola queda pendiente; al volver se sincroniza sin duplicar', async () => {
  const { store } = await readyStore();
  const server = new FakeServer();
  server.down = true;
  const s1 = await sell(store);
  const s2 = await sell(store, 2);
  const off = await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(off.online, false);
  assert.equal(off.pulled, false);
  assert.ok(off.remaining >= 2);
  assert.equal(await store.stockQty(V_CH, B1), 7, 'el teléfono/PC sigue con su inventario local actualizado');

  server.down = false;
  const on = await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(on.online, true);
  assert.equal(on.remaining, 0);
  assert.equal(on.pulled, true);
  assert.deepEqual(server.sales.sort(), [s1.sale.id, s2.sale.id].sort());
  assert.equal(server.stock.get(`${V_CH}|${B1}`), 7);
  assert.equal(await store.stockQty(V_CH, B1), 7, 'local y servidor coinciden, sin doble descuento');

  const again = await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(again.sent, 0);
  assert.equal(server.sales.length, 2);
});

test('se corta la red DESPUÉS de que el servidor aplicó: el reintento no duplica', async () => {
  const { store } = await readyStore();
  const server = new FakeServer();
  await sell(store);
  server.dropResponseOnce = true;
  const first = await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(first.online, false);
  assert.equal(server.sales.length, 1, 'el servidor ya aplicó la venta');
  assert.equal(await store.stockQty(V_CH, B1), 9);
  const second = await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(second.duplicates, 2, 'apertura de caja + venta: ambas ya estaban aplicadas');
  assert.equal(server.sales.length, 1);
  assert.equal(server.stock.get(`${V_CH}|${B1}`), 9);
  assert.equal(await store.stockQty(V_CH, B1), 9);
});

test('conflicto de existencias: se aplica la venta y queda documentado para el gerente', async () => {
  const { store } = await readyStore();
  const server = new FakeServer();
  server.stock.set(`${V_CH}|${B1}`, 1); // el servidor solo tenía 1 (otra terminal ya vendió)
  await sell(store, 3);
  const r = await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(r.conflicts, 1);
  const open = await store.openConflicts();
  assert.equal(open.length, 1);
  assert.equal(open[0].kind, 'stock_negativo');
  assert.equal(server.sales.length, 1, 'la venta NO se elimina');
});

test('venta local durante la caída del servidor y ventas de otra terminal: base nueva + pendientes', async () => {
  const { store } = await readyStore();
  const server = new FakeServer();
  await sell(store);
  await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  server.stock.set(`${V_CH}|${B1}`, 5); // otra terminal vendió 4 más
  server.down = true;
  await sell(store, 1); // venta local mientras no hay conexión
  server.down = false;
  await runSyncCycle(store, server, { branchId: B1, terminalId: T1 });
  assert.equal(server.stock.get(`${V_CH}|${B1}`), 4);
  assert.equal(await store.stockQty(V_CH, B1), 4, 'refleja ventas de ambas terminales');
});

test('error 401 se reporta como authError y no como "sin internet"', async () => {
  const { store } = await readyStore();
  await sell(store);
  const api: SyncApi = {
    push: async () => { throw new SyncHttpError(401, 'Sesión vencida'); },
    pull: async () => { throw new Error('no debe llamarse'); },
  };
  const r = await runSyncCycle(store, api, { branchId: B1, terminalId: T1 });
  assert.equal(r.authError, true);
  assert.equal(r.online, true);
  assert.ok(r.remaining >= 1);
});

// ───────────── LAN ─────────────
const hmac = (k: string, m: string) => createHmac('sha256', k).update(m).digest('hex');

test('LAN: vinculación con QR, firma de peticiones, replay y revocación', async () => {
  const secret = randomUUID() + randomUUID();
  const nowMs = Date.now();
  const payload = { v: 1 as const, host: '127.0.0.1', port: 47880, secret, expiresAt: new Date(nowMs + 300000).toISOString(), terminalId: T1 };

  // PC: valida la prueba y guarda la llave derivada
  let stored: string | undefined;
  const fakePc = async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.pathname === '/pair') {
      const b = JSON.parse(init.body);
      const v = verifyPairing({ hmac, secret, deviceId: b.deviceId, ts: b.ts, proof: b.proof, nowMs: Date.now() });
      if (v.ok) stored = v.deviceKey;
      return new Response(JSON.stringify({ ok: v.ok }), { status: v.ok ? 200 : 403 });
    }
    const body = init.body ?? '';
    const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])) as any;
    const res = verifyLanRequest({ hmac, deviceKey: stored, headers, method: init.method, path: u.pathname, body, nonces: nonces, nowMs: Date.now() });
    if (!res.ok) return new Response(JSON.stringify({ error: res.reason }), { status: 401 });
    return new Response(JSON.stringify({ received: true, found: true, productName: 'Vela' }), { status: 200 });
  };
  const nonces = new NonceCache();

  const { deviceKey } = await LanClient.pair({ payload, deviceId: 'tel-1', deviceName: 'Teléfono', hmac, fetchImpl: fakePc as any });
  assert.equal(deviceKey, stored, 'ambos lados derivan la misma llave sin transmitirla');

  const client = new LanClient({ host: '127.0.0.1', port: 47880, deviceId: 'tel-1', deviceKey, hmac, fetchImpl: fakePc as any, randomNonce: () => randomUUID() });
  assert.equal((await client.scan('7501234567890', 'venta')).found, true);

  // Un dispositivo con llave incorrecta es rechazado
  const intruder = new LanClient({ host: '127.0.0.1', port: 47880, deviceId: 'tel-1', deviceKey: 'x'.repeat(64), hmac, fetchImpl: fakePc as any, randomNonce: () => randomUUID() });
  await assert.rejects(intruder.scan('1', 'venta'), /401/);

  // Replay: misma petición firmada reenviada
  const sentNonce = 'nonce-fijo';
  const fixed = new LanClient({ host: '127.0.0.1', port: 47880, deviceId: 'tel-1', deviceKey, hmac, fetchImpl: fakePc as any, randomNonce: () => sentNonce });
  await fixed.scan('1', 'venta');
  await assert.rejects(fixed.scan('1', 'venta'), /401/);

  // Revocación: la PC olvida la llave
  stored = undefined;
  await assert.rejects(client.scan('1', 'venta'), /401/);

  // QR vencido o secreto incorrecto
  const bad = verifyPairing({ hmac, secret: 'otro', deviceId: 'tel-2', ts: Date.now(), proof: 'abc', nowMs: Date.now() });
  assert.equal(bad.ok, false);
  void gerente;
});
