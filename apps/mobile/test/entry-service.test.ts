import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyStore, pullPayload, gerente, vendedor, B1, T1, V_CH, Clock } from '../../../packages/database/test/helpers.ts';
import { loadEntryAccess, touchClockHighWater } from '../src/services/entry.ts';

/** Integración con un LocalStore real (SQLite en memoria): permisos temporales descargados por pull. */
async function setup(grant?: { startsAt: string; expiresAt: string; revokedAt?: string | null }) {
  const clock = new Clock('2026-10-22T16:00:00.000Z');
  const ctx = await readyStore({ clock });
  const payload = pullPayload();
  payload.serverTime = '2026-10-22T16:00:00.000Z';
  if (grant) {
    payload.grants = [{ id: 'g1', sellerId: vendedor.userId, branchId: B1, functions: ['inventario.entrada'], startsAt: grant.startsAt, expiresAt: grant.expiresAt, revokedAt: grant.revokedAt ?? null, grantedBy: gerente.userId }];
  }
  await ctx.store.applyPull(payload);
  return ctx;
}
const at = (iso: string) => Date.parse(iso);

test('vendedor con permiso vigente puede; al vencer se bloquea (hora local)', async () => {
  const { store } = await setup({ startsAt: '2026-10-22T15:00:00.000Z', expiresAt: '2026-10-22T16:30:00.000Z' });
  const ok = await loadEntryAccess(store, vendedor, B1, at('2026-10-22T16:05:00.000Z'));
  assert.equal(ok.allowed, true);
  const late = await loadEntryAccess(store, vendedor, B1, at('2026-10-22T16:31:00.000Z'));
  assert.equal(late.allowed, false);
  if (!late.allowed) assert.equal(late.code, 'permiso_vencido');
});

test('sin permisos descargados o revocado: bloquea', async () => {
  const none = await setup();
  const r1 = await loadEntryAccess(none.store, vendedor, B1, at('2026-10-22T16:05:00.000Z'));
  assert.equal(r1.allowed, false);
  const revoked = await setup({ startsAt: '2026-10-22T15:00:00.000Z', expiresAt: '2026-10-22T18:00:00.000Z', revokedAt: '2026-10-22T16:01:00.000Z' });
  const r2 = await loadEntryAccess(revoked.store, vendedor, B1, at('2026-10-22T16:05:00.000Z'));
  assert.equal(r2.allowed, false);
});

test('nunca sincronizado (sin last_pull_at): no se puede comprobar => bloquea', async () => {
  const { store } = await setup({ startsAt: '2026-10-22T15:00:00.000Z', expiresAt: '2026-10-22T18:00:00.000Z' });
  await store.db.run("DELETE FROM meta WHERE key = 'last_pull_at'");
  const r = await loadEntryAccess(store, vendedor, B1, at('2026-10-22T16:05:00.000Z'));
  assert.equal(r.allowed, false);
  if (!r.allowed) assert.equal(r.code, 'sin_sincronizar');
});

test('reloj atrasado (marca de agua) => bloquea; tras verificar con el servidor se reinicia', async () => {
  const { store } = await setup({ startsAt: '2026-10-22T15:00:00.000Z', expiresAt: '2026-10-22T20:00:00.000Z' });
  await touchClockHighWater(store, at('2026-10-22T19:00:00.000Z')); // la app vio las 19:00
  const back = await loadEntryAccess(store, vendedor, B1, at('2026-10-22T16:10:00.000Z')); // ahora "son" las 16:10
  assert.equal(back.allowed, false);
  if (!back.allowed) assert.equal(back.code, 'reloj_atrasado');
  await touchClockHighWater(store, at('2026-10-22T16:10:00.000Z'), true); // el servidor confirmó esta hora
  assert.equal((await loadEntryAccess(store, vendedor, B1, at('2026-10-22T16:10:00.000Z'))).allowed, true);
});

test('gerente no necesita permiso; la marca de agua no retrocede sin force', async () => {
  const { store } = await setup();
  assert.equal((await loadEntryAccess(store, gerente, B1, at('2026-10-22T16:05:00.000Z'))).allowed, true);
  await touchClockHighWater(store, at('2026-10-22T19:00:00.000Z'));
  await touchClockHighWater(store, at('2026-10-22T10:00:00.000Z'));
  assert.equal(await store.getMeta('clock_high_water'), '2026-10-22T19:00:00.000Z');
});

test('la entrada del vendedor sin permiso la rechaza también LocalStore (defensa en profundidad)', async () => {
  const { store } = await setup();
  await assert.rejects(
    store.registerMovement({ id: 'f0000000-0000-4000-8000-000000000001', actor: vendedor, branchId: B1, terminalId: T1, variantId: V_CH, type: 'entrada', qty: 5, reason: 'Compra' }),
    /permiso vigente/,
  );
});
