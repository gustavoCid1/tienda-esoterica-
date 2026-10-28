import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCashBreakdown, cashDifference, sumDenominations } from '../src/cash.ts';
import { summarizeSales, monthlyTotals, type ReportSale, type ReportAdjustment } from '../src/reports.ts';
import { mxDayBounds, mxDayKey, mxMonthKey } from '../src/time.ts';
import { can, isGrantActive, canRegisterEntry } from '../src/permissions.ts';
import { buildFolio, parseQrValue, buildQrValue, newId } from '../src/ids.ts';
import { signRequest, deriveDeviceKey, encodePairingPayload, decodePairingPayload, safeEqual } from '../src/lan-auth.ts';
import { createHmac } from 'node:crypto';
import type { Grant } from '../src/types.ts';

test('efectivo esperado no suma tarjeta ni transferencia', () => {
  const b = computeCashBreakdown(
    100000,
    'S1',
    [
      { cashSessionId: 'S1', payments: [{ method: 'efectivo', amountCents: 30000 }, { method: 'tarjeta', amountCents: 20000 }] },
      { cashSessionId: 'S1', payments: [{ method: 'transferencia', amountCents: 50000 }] },
      { cashSessionId: 'OTRA', payments: [{ method: 'efectivo', amountCents: 99999 }] },
    ],
    [{ cashSessionId: 'S1', payments: [{ method: 'efectivo', amountCents: 5000 }] }],
    [
      { sessionId: 'S1', type: 'entrada', amountCents: 10000 },
      { sessionId: 'S1', type: 'retiro', amountCents: 40000 },
      { sessionId: 'S1', type: 'gasto', amountCents: 2000 },
    ],
  );
  // 1000 + 300 + 100 - 400 - 20 - 50 = 930
  assert.equal(b.expectedCents, 93000);
  assert.equal(b.byMethod.tarjeta, 20000);
  assert.equal(b.byMethod.transferencia, 50000);
  assert.equal(b.byMethod.efectivo, 25000);
  assert.equal(cashDifference(b.expectedCents, 92000), -1000);
});

test('desglose de billetes y monedas', () => {
  assert.equal(sumDenominations({ 'Billete $500': 2, 'Moneda $10': 3, 'Moneda $0.50': 1 }), 100000 + 3000 + 50);
  assert.throws(() => sumDenominations({ 'Billete $7': 1 }));
});

test('fechas de México', () => {
  assert.equal(mxDayKey('2026-10-22T05:59:59.000Z'), '2026-10-21');
  assert.equal(mxDayKey('2026-10-22T06:00:00.000Z'), '2026-10-22');
  const b = mxDayBounds('2026-10-22');
  assert.equal(b.from, '2026-10-22T06:00:00.000Z');
  assert.equal(b.to, '2026-10-23T06:00:00.000Z');
  assert.equal(mxMonthKey('2026-11-01T03:00:00.000Z'), '2026-10');
});

const sale = (id: string, createdAt: string, total: number, method: 'efectivo' | 'tarjeta', branchId = 'B1'): ReportSale => ({
  id, branchId, createdAt, totalCents: total, payments: [{ method, amountCents: total }],
  items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'Grande', qty: 1, unitCostCents: Math.floor(total / 2), netCents: total }],
});

test('resumen: cancelaciones y devoluciones restan por fecha del registro', () => {
  const sales = [sale('1', '2026-10-22T10:00:00.000Z', 10000, 'efectivo'), sale('2', '2026-10-22T11:00:00.000Z', 20000, 'tarjeta'), sale('3', '2026-10-22T12:00:00.000Z', 5000, 'efectivo', 'B2')];
  const adj: ReportAdjustment[] = [
    { id: 'a1', saleId: '2', branchId: 'B1', type: 'cancelacion', createdAt: '2026-10-22T13:00:00.000Z', amountCents: 20000, payments: [{ method: 'tarjeta', amountCents: 20000 }], items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'Grande', qty: 1, unitCostCents: 10000, netCents: 20000 }] },
    { id: 'a2', saleId: '1', branchId: 'B1', type: 'devolucion', createdAt: '2026-10-22T14:00:00.000Z', amountCents: 3000, payments: [{ method: 'efectivo', amountCents: 3000 }], items: [{ variantId: 'v1', productName: 'Vela', variantLabel: 'Grande', qty: 1, unitCostCents: 5000, netCents: 3000, restock: false }] },
  ];
  const s = summarizeSales(sales, adj, { branchId: 'B1' });
  assert.equal(s.grossCents, 30000);
  assert.equal(s.cancelledCents, 20000);
  assert.equal(s.refundedCents, 3000);
  assert.equal(s.netCents, 7000);
  assert.equal(s.ticketCount, 2);
  assert.equal(s.avgTicketCents, 7000); // 1 ticket neto (2 - 1 cancelado)
  assert.equal(s.byMethod.efectivo.netCents, 7000);
  assert.equal(s.byMethod.tarjeta.netCents, 0);
  // costo: 5000 + 10000 - 10000 (cancelada restock) - 0 (devolución dañada no reduce costo)
  assert.equal(s.cogsCents, 5000);
  assert.equal(s.grossProfitCents, 2000);
  const all = summarizeSales(sales, adj);
  assert.equal(all.grossCents, 35000);
});

test('totales por mes y mejor mes', () => {
  const sales = [sale('1', '2026-09-10T10:00:00.000Z', 10000, 'efectivo'), sale('2', '2026-10-10T10:00:00.000Z', 30000, 'efectivo')];
  const { months, best } = monthlyTotals(sales, []);
  assert.deepEqual(months.map((m) => m.month), ['2026-09', '2026-10']);
  assert.equal(best?.month, '2026-10');
});

test('permisos por rol: vendedor sin finanzas, desarrollador sin finanzas', () => {
  assert.equal(can('gerente', 'caja.corte'), true);
  assert.equal(can('vendedor', 'caja.corte'), false);
  assert.equal(can('vendedor', 'estadisticas.ver'), false);
  assert.equal(can('desarrollador', 'estadisticas.ver'), false);
  assert.equal(can('desarrollador', 'ventas.ver_todas'), false);
  assert.equal(can('desarrollador', 'sistema.diagnostico'), true);
  assert.equal(can('vendedor', 'ventas.crear'), true);
  assert.equal(can(undefined, 'ventas.crear'), false);
});

test('permiso temporal: vigencia, sucursal, función y revocación', () => {
  const g: Grant = { id: 'g', sellerId: 'u1', branchId: 'B1', functions: ['inventario.entrada'], startsAt: '2026-10-22T10:00:00.000Z', expiresAt: '2026-10-22T11:00:00.000Z', revokedAt: null, grantedBy: 'm' };
  assert.equal(isGrantActive(g, 'inventario.entrada', 'B1', '2026-10-22T10:30:00.000Z'), true);
  assert.equal(isGrantActive(g, 'inventario.entrada', 'B1', '2026-10-22T11:00:00.000Z'), false); // caducó
  assert.equal(isGrantActive(g, 'inventario.entrada', 'B2', '2026-10-22T10:30:00.000Z'), false);
  assert.equal(isGrantActive(g, 'caja.corte', 'B1', '2026-10-22T10:30:00.000Z'), false);
  assert.equal(isGrantActive({ ...g, revokedAt: '2026-10-22T10:20:00.000Z' }, 'inventario.entrada', 'B1', '2026-10-22T10:30:00.000Z'), false);
  assert.equal(canRegisterEntry('vendedor', 'u1', 'B1', [g], '2026-10-22T10:30:00.000Z').allowed, true);
  assert.equal(canRegisterEntry('vendedor', 'u1', 'B1', [g], '2026-10-22T12:00:00.000Z').allowed, false);
  assert.equal(canRegisterEntry('vendedor', 'u2', 'B1', [g], '2026-10-22T10:30:00.000Z').allowed, false);
  assert.equal(canRegisterEntry('gerente', 'm', 'B1', [], '2026-10-22T10:30:00.000Z').allowed, true);
  assert.equal(canRegisterEntry('desarrollador', 'd', 'B1', [], '2026-10-22T10:30:00.000Z').allowed, false);
});

test('folios, ids y QR', () => {
  assert.equal(buildFolio('A', 'P1', '2026-10-22', 7), 'AMA-AP1-261022-0007');
  const id = newId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(parseQrValue(buildQrValue(id)), id);
  assert.equal(parseQrValue('hola'), null);
});

test('LAN: firma y derivación de llave determinísticas', () => {
  const hmac = (k: string, m: string) => createHmac('sha256', k).update(m).digest('hex');
  const key = deriveDeviceKey(hmac, 'secreto', 'tel-1');
  assert.equal(key, deriveDeviceKey(hmac, 'secreto', 'tel-1'));
  assert.notEqual(key, deriveDeviceKey(hmac, 'secreto', 'tel-2'));
  const s1 = signRequest(hmac, key, 1000, 'n1', 'post', '/scan', '{"code":"1"}');
  const s2 = signRequest(hmac, key, 1000, 'n1', 'POST', '/scan', '{"code":"1"}');
  const s3 = signRequest(hmac, key, 1000, 'n1', 'POST', '/scan', '{"code":"2"}');
  assert.equal(s1, s2);
  assert.notEqual(s1, s3);
  assert.equal(safeEqual(s1, s2), true);
  assert.equal(safeEqual(s1, s3), false);
  const enc = encodePairingPayload({ v: 1, host: '192.168.1.10', port: 47880, secret: 'x', expiresAt: '2026-10-22T10:00:00.000Z', terminalId: 'T1' });
  assert.equal(decodePairingPayload(enc)?.host, '192.168.1.10');
  assert.equal(decodePairingPayload('otra cosa'), null);
});
