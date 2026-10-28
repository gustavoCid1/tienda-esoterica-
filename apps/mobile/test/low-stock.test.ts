import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B1, V_CH, V_GR, gerente, readyStore, T1 } from '../../../packages/database/test/helpers.ts';
import { newId } from '@amara/shared';
import {
  EMPTY_ALERT_STATE, alertMessage, alertStateMetaKey, badgeText, countLowStock, isLegacyNegative, lowStockFromHits, normalizeLowStock, parseAlertState,
  planLowStockAlerts, serializeAlertState, severityOf, shownQty,
} from '../src/lib/low-stock.ts';
import type { LowStockItem } from '../src/lib/low-stock.ts';

const item = (over: Partial<LowStockItem> = {}): LowStockItem => ({
  variantId: 'v1', productId: 'p1', productName: 'Vela ritual', label: 'Chica', category: 'Velas', branchId: 'b1', qty: 2, minStock: 3, ...over,
});

test('lectura de /stats/low-stock: acepta {items} o arreglo y ordena por urgencia', () => {
  const list = normalizeLowStock({
    items: [
      { variantId: 'a', productName: 'Bajo', label: 'x', branchId: 'b', qty: 2, minStock: 3 },
      { variantId: 'b', productName: 'Agotado', label: 'x', branchId: 'b', qty: 0, minStock: 3 },
      { variantId: 'c', productName: 'Negativo', label: 'x', branchId: 'b', qty: -2, minStock: 0 },
      { productName: 'Sin variante' },
    ],
  });
  assert.deepEqual(list.map((i) => i.productName), ['Negativo', 'Agotado', 'Bajo']);
  assert.equal(normalizeLowStock([{ variantId: 'z', qty: 1 }]).length, 1);
  assert.deepEqual(normalizeLowStock('nada'), []);
  assert.deepEqual(countLowStock(list), { total: 3, agotados: 2, bajos: 1 });
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(150), '99+');
});

test('nunca se muestran existencias negativas', () => {
  assert.equal(shownQty(-2), 0);
  assert.equal(shownQty(4), 4);
  assert.equal(isLegacyNegative(-1), true);
  assert.equal(isLegacyNegative(0), false);
  assert.equal(severityOf({ qty: -2 }), 'agotado');
  assert.equal(alertMessage([item({ qty: -2 })])!.body.includes('-'), false, 'el texto de la alerta no enseña negativos');
});

test('alertas sin repetir: la primera vez avisa, la segunda no', () => {
  const now = [item(), item({ variantId: 'v2', productName: 'Incienso', qty: 0, minStock: 2 })];
  const p1 = planLowStockAlerts(now, EMPTY_ALERT_STATE);
  assert.equal(p1.fresh.length, 2);
  const p2 = planLowStockAlerts(now, p1.next);
  assert.equal(p2.fresh.length, 0, 'misma situación: no se repite');
  assert.deepEqual(p2.next, p1.next);
});

test('alertas: avisa de nuevo si empeora (bajo -> agotado) o si se recupera y vuelve a caer', () => {
  const bajo = item();
  const p1 = planLowStockAlerts([bajo], EMPTY_ALERT_STATE);
  // Empeora.
  const p2 = planLowStockAlerts([item({ qty: 0 })], p1.next);
  assert.equal(p2.fresh.length, 1);
  // Mejora parcial (agotado -> bajo): no avisa, pero recuerda el nuevo nivel.
  const p3 = planLowStockAlerts([bajo], p2.next);
  assert.equal(p3.fresh.length, 0);
  assert.equal(p3.next.seen['v1|b1'], 'bajo');
  // Se recupera (sale de la lista) y vuelve a caer: avisa otra vez.
  const p4 = planLowStockAlerts([], p3.next);
  assert.deepEqual(p4.next.seen, {});
  const p5 = planLowStockAlerts([bajo], p4.next);
  assert.equal(p5.fresh.length, 1);
});

test('alertas: solo los productos NUEVOS en mínimo se avisan', () => {
  const a = item();
  const p1 = planLowStockAlerts([a], EMPTY_ALERT_STATE);
  const b = item({ variantId: 'v9', productName: 'Pulsera', qty: 1, minStock: 2 });
  const p2 = planLowStockAlerts([a, b], p1.next);
  assert.deepEqual(p2.fresh.map((i) => i.variantId), ['v9']);
  assert.equal(alertMessage(p2.fresh)!.title, 'Producto en mínimo');
});

test('mensaje de la notificación: uno o varios productos', () => {
  assert.equal(alertMessage([]), null);
  const one = alertMessage([item()])!;
  assert.match(one.body, /Vela ritual \(Chica\): quedan 2, mínimo 3/);
  const many = alertMessage([item(), item({ variantId: 'b', productName: 'B' }), item({ variantId: 'c', productName: 'C' }), item({ variantId: 'd', productName: 'D' }), item({ variantId: 'e', productName: 'E' })])!;
  assert.equal(many.title, '5 productos en mínimo');
  assert.match(many.body, /y 2 más/);
});

test('estado guardado: ida y vuelta y tolerancia a basura', () => {
  const st = planLowStockAlerts([item()], EMPTY_ALERT_STATE).next;
  assert.deepEqual(parseAlertState(serializeAlertState(st)), st);
  assert.deepEqual(parseAlertState('{no es json'), EMPTY_ALERT_STATE);
  assert.deepEqual(parseAlertState(JSON.stringify({ v: 1, seen: { a: 'bajo', b: 'raro' } })).seen, { a: 'bajo' });
  assert.deepEqual(parseAlertState(null), EMPTY_ALERT_STATE);
  assert.equal(alertStateMetaKey('u1', 'b1'), 'mobile_alerts_state:u1:b1');
});

test('sin conexión: el mínimo local sale del catálogo real (LocalStore) y se actualiza al vender', async () => {
  const { store } = await readyStore();
  // Existencias del pull: chica 10 (mín. 3), grande 4 (mín. 2): nada en mínimo.
  const none = lowStockFromHits(await store.inventoryList({ branchId: B1, filter: 'todos', limit: 1000 }), B1);
  assert.equal(none.length, 0);
  // Se venden 7 chicas: quedan 3 = en su mínimo.
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_CH, qty: 7 }], payments: [{ method: 'efectivo', amountCents: 63000, tenderedCents: 63000 }] });
  const low = lowStockFromHits(await store.inventoryList({ branchId: B1, filter: 'todos', limit: 1000 }), B1);
  assert.deepEqual(low.map((i) => [i.variantId, i.qty]), [[V_CH, 3]]);
  // La alerta de esa situación se da una sola vez, aunque se calcule varias veces (sincronizar / abrir).
  const p1 = planLowStockAlerts(low, EMPTY_ALERT_STATE);
  const p2 = planLowStockAlerts(lowStockFromHits(await store.inventoryList({ branchId: B1, filter: 'todos', limit: 1000 }), B1), p1.next);
  assert.equal(p1.fresh.length, 1);
  assert.equal(p2.fresh.length, 0);
  // Se vende la grande hasta su mínimo: solo ella es nueva.
  await store.registerSale({ saleId: newId(), actor: gerente, branchId: B1, terminalId: T1, items: [{ variantId: V_GR, qty: 2 }], payments: [{ method: 'efectivo', amountCents: 30000, tenderedCents: 30000 }] });
  const p3 = planLowStockAlerts(lowStockFromHits(await store.inventoryList({ branchId: B1, filter: 'todos', limit: 1000 }), B1), p2.next);
  assert.deepEqual(p3.fresh.map((i) => i.variantId), [V_GR]);
});

test('existencia negativa heredada: aparece en la lista como agotada y se muestra como 0', () => {
  const hit = { variantId: 'v', productId: 'p', productName: 'X', category: '', type: '', label: 'L', unit: '', sku: '', barcode: null, internalCode: '', qrValue: '', costCents: 0, priceCents: 0, minStock: 0, location: null, photo: null, status: 'activo', qty: -2 };
  const l = lowStockFromHits([hit], B1);
  assert.equal(l.length, 1);
  assert.equal(severityOf(l[0]!), 'agotado');
  assert.equal(shownQty(l[0]!.qty), 0);
});
