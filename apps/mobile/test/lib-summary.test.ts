import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mxDayBounds, mxTodayKey, summarizeSales } from '@amara/shared';
import { readyStore, gerente, vendedor, B1, T1, V_CH, V_GR } from '../../../packages/database/test/helpers.ts';
import { buildLocalView, buildServerView, chooseView, methodRows, netExplanation } from '../src/lib/summary-model.ts';
import { addDays, formatDayRange, isTodayRange, presetRange, validateRange } from '../src/lib/date-range.ts';

const ctx = (branchId: string | null = B1) => ({ fromDay: '2026-10-22', toDay: '2026-10-22', branchId, branchLabel: 'Centro', consolidated: branchId === null });

test('resumen OFFLINE con LocalStore real: vendido, cancelaciones, devoluciones y métodos por separado', async () => {
  const { store, clock } = await readyStore();
  // Venta 1: 2 velas chicas = 18000, efectivo.
  const s1 = await store.registerSale({ saleId: 'a0000000-0000-4000-8000-000000000001', actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 2 }], payments: [{ method: 'efectivo', amountCents: 18000, tenderedCents: 20000 }] });
  // Venta 2: 1 vela grande = 15000, tarjeta.
  const s2 = await store.registerSale({ saleId: 'a0000000-0000-4000-8000-000000000002', actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 1 }], payments: [{ method: 'tarjeta', amountCents: 15000 }] });
  // Se cancela la venta 2 (gerente).
  await store.cancelSale({ saleId: s2.sale.id, actor: gerente, terminalId: T1, reason: 'Cliente se arrepintió' });
  clock.advance(60_000);

  const day = mxTodayKey(clock.now());
  const { from, to } = mxDayBounds(day);
  const local = await store.summary({ from, to, branchId: B1 });
  const view = buildLocalView(local.summary, ctx(), { nowIso: clock.now().toISOString(), pendingOps: local.pendingOps, lastSyncOkAt: local.lastSyncOkAt });

  assert.equal(view.source, 'local');
  assert.equal(view.summary.grossCents, 33000); // total vendido
  assert.equal(view.summary.cancelledCents, 15000); // cancelaciones aparte
  assert.equal(view.summary.refundedCents, 0); // devoluciones aparte
  assert.equal(view.summary.netCents, 18000);
  assert.equal(view.summary.ticketCount, 2);
  const rows = Object.fromEntries(methodRows(view.summary).map((r) => [r.method, r]));
  assert.equal(rows.efectivo!.grossCents, 18000);
  assert.equal(rows.tarjeta!.grossCents, 15000);
  assert.equal(rows.tarjeta!.refundedCents, 15000);
  assert.equal(rows.tarjeta!.netCents, 0);
  assert.ok(view.pendingOps >= 2);
  // Avisos obligatorios sin conexión.
  const text = view.notices.map((n) => n.text).join(' | ');
  assert.match(text, /DATOS LOCALES/);
  assert.match(text, /INCOMPLETO/);
  assert.match(text, /pendientes/);
  assert.match(text, /nunca ha sincronizado|Última sincronización/);
  void s1;
});

test('el efectivo esperado NO es lo vendido (cálculo de caja aparte)', async () => {
  const { store } = await readyStore();
  await store.registerSale({ saleId: 'a0000000-0000-4000-8000-000000000003', actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: [{ method: 'tarjeta', amountCents: 9000 }] });
  const open = await store.currentSession(T1);
  const { breakdown } = await store.cashBreakdown(open.id);
  assert.equal(breakdown.expectedCents, 100000); // solo el fondo: la tarjeta no es efectivo físico
});

test('al reconectar gana el servidor y NUNCA se suma al local (sin doble conteo)', async () => {
  const { store, clock } = await readyStore();
  await store.registerSale({ saleId: 'a0000000-0000-4000-8000-000000000004', actor: vendedor, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 1 }], payments: [{ method: 'efectivo', amountCents: 9000 }] });
  const { from, to } = mxDayBounds(mxTodayKey(clock.now()));
  const local = await store.summary({ from, to, branchId: B1 });
  const localView = buildLocalView(local.summary, ctx(), { nowIso: clock.now().toISOString(), pendingOps: local.pendingOps, lastSyncOkAt: null });

  // El servidor ya incluye la venta de este teléfono más una de otra terminal.
  const serverSummary = summarizeSales(
    [
      { id: 'x1', branchId: B1, createdAt: clock.now().toISOString(), totalCents: 9000, payments: [{ method: 'efectivo', amountCents: 9000 }], items: [] },
      { id: 'x2', branchId: B1, createdAt: clock.now().toISOString(), totalCents: 5000, payments: [{ method: 'tarjeta', amountCents: 5000 }], items: [] },
    ],
    [],
  );
  const serverView = buildServerView(serverSummary, ctx(), { updatedAt: clock.now().toISOString(), pendingOps: 0 });
  const chosen = chooseView(serverView, localView)!;
  assert.equal(chosen.source, 'servidor');
  assert.equal(chosen.summary.grossCents, 14000); // 9000 + 5000, NO 9000 + 14000
  assert.equal(chooseView(null, localView)!.source, 'local');
  assert.equal(chooseView(null, null), null);
});

test('servidor con pendientes locales: avisa que no están incluidas', () => {
  const s = summarizeSales([], []);
  const v = buildServerView(s, ctx(), { updatedAt: '2026-10-22T18:00:00.000Z', pendingOps: 2 });
  assert.equal(v.notices.length, 1);
  assert.match(v.notices[0]!.text, /2 operaciones/);
  assert.equal(buildServerView(s, ctx(), { updatedAt: 'x', pendingOps: 0 }).notices.length, 0);
});

test('explicación de ventas netas', () => {
  const s = summarizeSales(
    [{ id: '1', branchId: B1, createdAt: '2026-10-22T18:00:00.000Z', totalCents: 10000, payments: [{ method: 'efectivo', amountCents: 10000 }], items: [] }],
    [{ id: 'a', saleId: '1', branchId: B1, type: 'devolucion', createdAt: '2026-10-22T19:00:00.000Z', amountCents: 2500, payments: [{ method: 'efectivo', amountCents: 2500 }], items: [] }],
  );
  const lines = netExplanation(s);
  assert.match(lines[0]!, /\$100\.00 - cancelaciones \$0\.00 - devoluciones \$25\.00 = \$75\.00/);
  assert.equal(lines.length, 2);
  // Inconsistencia reportada por un servidor defectuoso.
  const bad = { ...s, netCents: 1 };
  assert.equal(netExplanation(bad).length, 3);
});

test('rangos de fechas', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(presetRange('ayer', '2026-10-22'), { from: '2026-10-21', to: '2026-10-21' });
  assert.deepEqual(presetRange('7dias', '2026-10-22'), { from: '2026-10-16', to: '2026-10-22' });
  assert.deepEqual(presetRange('mes', '2026-10-22'), { from: '2026-10-01', to: '2026-10-22' });
  assert.equal(validateRange('2026-10-22', '2026-10-21'), 'La fecha inicial no puede ser posterior a la final.');
  assert.match(validateRange('2026-13-01', '2026-13-02')!, /AAAA-MM-DD/);
  assert.match(validateRange('2024-01-01', '2026-10-22')!, /366/);
  assert.equal(validateRange('2026-10-01', '2026-10-22'), null);
  assert.ok(isTodayRange('2026-10-22', '2026-10-22', '2026-10-22'));
  assert.equal(formatDayRange('2026-10-01', '2026-10-22'), '01/10/2026 al 22/10/2026');
  assert.equal(formatDayRange('2026-10-22', '2026-10-22'), '22/10/2026');
});
