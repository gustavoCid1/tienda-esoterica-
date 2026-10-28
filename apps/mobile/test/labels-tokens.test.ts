import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LABEL_OPTIONS, LABEL_SIZES, MAX_COPIES_PER_ITEM, barcodeSvg, expandLabels, labelsDocument, mmToPoints, qrSvg } from '../src/lib/labels.ts';
import type { LabelItem, LabelOptions } from '../src/lib/labels.ts';
import { buildTokenBody, durationToMinutes, parseCreatedToken, parseTokenList } from '../src/lib/tokens-form.ts';
import type { TokenFormInput } from '../src/lib/tokens-form.ts';
import { distinctCategories, employeesForBranch, isSelectedCategory, mySales, parseExtraCategories, parseTodaySummary, summarizeToday, toggleCategory } from '../src/lib/misc-v2.ts';

const fakeQr = (text: string): boolean[][] => [[true, false, true], [false, true, false], [true, false, text.length > 0]];
const item = (over: Partial<LabelItem> = {}): LabelItem => ({ name: 'Vela ritual', variantLabel: 'Chica', priceCents: 9000, code: 'AMA00000001', qrValue: 'amara:v1:abc', copies: 1, ...over });
const opts = (o: Partial<LabelOptions> = {}): LabelOptions => ({ ...DEFAULT_LABEL_OPTIONS, ...o });

// ───────────── Etiquetas ─────────────
test('etiquetas: nombre, precio y QR se pueden ocultar de forma independiente', () => {
  const all = labelsDocument([item()], opts(), fakeQr).html;
  assert.match(all, /Vela ritual/);
  assert.match(all, /\$90\.00/);
  assert.match(all, /class="qr"/);
  assert.match(all, /class="bc"/);

  const noName = labelsDocument([item()], opts({ showName: false }), fakeQr).html;
  assert.ok(!noName.includes('Vela ritual'));
  assert.match(noName, /\$90\.00/);

  const noPrice = labelsDocument([item()], opts({ showPrice: false }), fakeQr).html;
  assert.ok(!noPrice.includes('$90.00'));

  const noQr = labelsDocument([item()], opts({ showQr: false }), fakeQr).html;
  assert.ok(!noQr.includes('class="qr"'));
  assert.match(noQr, /class="bc"/);

  const noBar = labelsDocument([item()], opts({ showBarcode: false }), fakeQr).html;
  assert.ok(!noBar.includes('class="bc"'));
});

test('etiquetas: copias, tope, tamaño de página y escape de HTML', () => {
  assert.equal(expandLabels([item({ copies: 3 }), item({ copies: 0 }), item({ copies: 2 })]).length, 5);
  assert.equal(expandLabels([item({ copies: 1000 })]).length, MAX_COPIES_PER_ITEM);
  assert.equal(expandLabels(Array.from({ length: 10 }, () => item({ copies: 99 }))).length, 400, 'tope total de la hoja');
  const doc = labelsDocument([item({ copies: 2 })], opts({ size: 'r60x40' }), fakeQr);
  assert.equal(doc.count, 2);
  assert.equal(doc.pageWidthPt, mmToPoints(60));
  assert.equal(doc.pageHeightPt, mmToPoints(40));
  const hoja = labelsDocument([item()], opts({ size: 'hoja' }), fakeQr);
  assert.equal(hoja.pageWidthPt, mmToPoints(215.9));
  assert.equal(LABEL_SIZES.length, 4);
  const evil = labelsDocument([item({ name: '<script>alert(1)</script>' })], opts(), fakeQr).html;
  assert.ok(!evil.includes('<script>'));
  assert.match(evil, /&lt;script&gt;/);
});

test('etiquetas: el código de barras y el QR son vectores válidos; un código no ASCII no lo rompe', () => {
  assert.match(barcodeSvg('AMA00000001'), /^<svg class="bc" viewBox="0 0 \d+ 10"/);
  assert.equal(barcodeSvg('Ñandú'), '');
  assert.equal(qrSvg([]), '');
  const q = qrSvg([[true, false], [false, true]]);
  assert.match(q, /viewBox="0 0 2 2"/);
  assert.match(q, /M0 0h1v1h-1zM1 1h1v1h-1z/);
  // Un generador de QR que falla no tumba la etiqueta.
  const html = labelsDocument([item()], opts(), () => {
    throw new Error('x');
  }).html;
  assert.ok(!html.includes('class="qr"'));
  assert.match(html, /class="bc"/);
});

// ───────────── Tokens ─────────────
const form = (over: Partial<TokenFormInput> = {}): TokenFormInput => ({ label: 'Cierre de Ana', purposes: ['cierre_caja'], durationText: '2', unit: 'horas', codeLengthText: '', maxUsesText: '', branchId: null, ...over });

test('tokens: duración en minutos u horas, de 1 minuto a 7 días', () => {
  assert.equal(durationToMinutes('90', 'minutos'), 90);
  assert.equal(durationToMinutes('1,5', 'horas'), 90);
  assert.equal(durationToMinutes('0', 'horas'), null);
  assert.equal(durationToMinutes('abc', 'horas'), null);
  const ok = buildTokenBody(form());
  assert.ok(ok.ok && ok.body.durationMinutes === 120 && ok.body.length === 8);
  assert.ok(buildTokenBody(form({ durationText: '8', unit: 'horas' })).ok);
  const max = buildTokenBody(form({ durationText: '7', unit: 'horas' }));
  assert.ok(max.ok);
  assert.ok(!buildTokenBody(form({ durationText: '169', unit: 'horas' })).ok, 'más de 7 días');
  assert.ok(buildTokenBody(form({ durationText: '168', unit: 'horas' })).ok, 'exactamente 7 días');
  assert.ok(!buildTokenBody(form({ durationText: '', unit: 'minutos' })).ok);
});

test('tokens: validaciones del formulario y cuerpo enviado', () => {
  assert.ok(!buildTokenBody(form({ label: 'a' })).ok);
  assert.ok(!buildTokenBody(form({ purposes: [] })).ok);
  assert.ok(!buildTokenBody(form({ codeLengthText: '11' })).ok, 'máximo 10 caracteres');
  assert.ok(!buildTokenBody(form({ codeLengthText: '3' })).ok);
  assert.ok(!buildTokenBody(form({ maxUsesText: '0' })).ok);
  const r = buildTokenBody(form({ codeLengthText: '10', maxUsesText: '3', branchId: 'b1', purposes: ['limpias', 'devolucion'] }));
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.body, { label: 'Cierre de Ana', purposes: ['limpias', 'devolucion'], durationMinutes: 120, length: 10, branchId: 'b1', maxUses: 3 });
  assert.ok(!('password' in (r.ok ? r.body : {})), 'el cuerpo no lleva contraseñas');
});

test('tokens: el código solo se acepta si el servidor lo devolvió al crear', () => {
  assert.deepEqual(parseCreatedToken({ id: 't1', code: 'ABCD2345', expiresAt: '2026-10-22T17:00:00.000Z', note: 'x' }), { id: 't1', code: 'ABCD2345', expiresAt: '2026-10-22T17:00:00.000Z' });
  assert.equal(parseCreatedToken({ id: 't1', expiresAt: 'x' }), null);
  assert.equal(parseCreatedToken(null), null);
  const list = parseTokenList({ items: [{ id: 'a', label: 'A', purposes: ['limpias', 'raro'], expiresAt: 'z', createdAt: '2026-10-01', status: 'vigente' }, { id: 'b', createdAt: '2026-10-02', expiresAt: 'w' }, { nada: 1 }] });
  assert.deepEqual(list.map((t) => t.id), ['b', 'a']);
  assert.deepEqual(list[1]!.purposes, ['limpias']);
});

// ───────────── Extras, empleados, hoy ─────────────
test('extras: categorías únicas sin distinguir acentos y alternar selección', () => {
  assert.deepEqual(distinctCategories(['Imágenes', 'imagenes', ' Veladoras ', '', 'Velas']), ['Imágenes', 'Veladoras', 'Velas']);
  let sel = ['Veladoras'];
  sel = toggleCategory(sel, 'Imágenes');
  assert.equal(isSelectedCategory(sel, 'imagenes'), true);
  sel = toggleCategory(sel, 'IMÁGENES');
  assert.deepEqual(sel, ['Veladoras']);
  assert.deepEqual(parseExtraCategories({ categories: ['A', ' a ', 'B'] }), ['A', 'B']);
  assert.equal(parseExtraCategories({}), null);
});

test('empleados: activos de la sucursal, vendedores y gerentes; siempre incluye al usuario actual', () => {
  const rows = [
    { id: 'u1', name: 'Zoila', role: 'vendedor', active: 1, branch_ids_json: '["b1"]' },
    { id: 'u2', name: 'Ana', role: 'gerente', active: 1, branch_ids_json: '["b1","b2"]' },
    { id: 'u3', name: 'Otra sucursal', role: 'vendedor', active: 1, branch_ids_json: '["b2"]' },
    { id: 'u4', name: 'Inactivo', role: 'vendedor', active: 0, branch_ids_json: '["b1"]' },
    { id: 'u5', name: 'Dev', role: 'desarrollador', active: 1, branch_ids_json: '["b1"]' },
    { id: 'u6', name: 'Rota', role: 'vendedor', active: 1, branch_ids_json: 'no-json' },
  ];
  assert.deepEqual(employeesForBranch(rows, 'b1', { id: 'u1', name: 'Zoila', role: 'vendedor' }).map((e) => e.name), ['Ana', 'Zoila']);
  assert.deepEqual(employeesForBranch([], 'b1', { id: 'me', name: 'Yo', role: 'vendedor' }).map((e) => e.id), ['me']);
});

test('tickets de hoy: solo lo vendido, total sin canceladas y "mis ventas" por empleado', () => {
  const items = parseTodaySummary({
    items: [
      { saleId: 's1', folio: 'F1', createdAt: '2026-10-22T16:00:00.000Z', status: 'completada', type: 'venta', sellerId: 'u1', sellerName: 'Zoila', totalCents: 9000, items: [{ name: 'Vela', label: 'Chica', qty: 1, unitPriceCents: 9000, netCents: 9000, kind: 'producto' }] },
      { saleId: 's2', folio: 'F2', status: 'cancelada', totalCents: 5000, sellerId: 'u2', items: [] },
      { saleId: 's3', folio: 'F3', status: 'completada', type: 'limpia', totalCents: 20000, sellerId: 'u1', items: [{ name: 'Vela', label: '', qty: 1, unitPriceCents: 20000, netCents: 20000, kind: 'extra', extraNote: 'Servicio' }] },
      { folio: 'sin id' },
    ],
  });
  assert.equal(items.length, 3);
  const v = summarizeToday(items);
  assert.equal(v.totalCents, 29000);
  assert.equal(v.count, 3);
  assert.deepEqual(mySales(items, 'u1').map((i) => i.folio), ['F1', 'F3']);
  assert.equal(items[2]!.type, 'limpia');
  assert.equal(items[2]!.items[0]!.extraNote, 'Servicio');
  // Lo que la lista expone NO incluye pagos ni el ticket impreso.
  assert.ok(!('payments' in items[0]!));
});
