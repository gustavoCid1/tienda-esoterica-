import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Grant } from '@amara/shared';
import { CODE128_PATTERNS, code128BValues, code128BWidths, code128Layout, Code128Error } from '../src/lib/code128.ts';
import { evaluateEntryAccess } from '../src/lib/entry-guard.ts';
import type { EntryAccessInput } from '../src/lib/entry-guard.ts';
import { registerFailure, isLocked, lockRemainingMs, EMPTY_LOCK, parseLock } from '../src/lib/lockout.ts';
import { isProfileUsable, profileKey, lockKey, parseProfile } from '../src/lib/offline-login.ts';
import { parseMoneyInput, parseIntInput } from '../src/lib/money-input.ts';
import { summarizePayments, validateNewPayment, toPaymentInputs } from '../src/lib/payments.ts';
import { addToCart, cartTotalCents, cartUnits, newCart, parseDraft, removeLine, setQty, toDraft } from '../src/lib/cart.ts';
import { candidateCodes, ScanDebouncer } from '../src/lib/scan-codes.ts';
import { evaluatePairingPayload, isPrivateHost } from '../src/lib/pairing.ts';
import { parseCashExpected, parseStatsResponse, StatsParseError } from '../src/lib/stats-parse.ts';
import { escapeHtml, ticketCopiesHtml, ticketLines } from '../src/lib/ticket-render.ts';
import { encodePairingPayload } from '@amara/shared';

// ───────────── Code 128 ─────────────
test('Code128: la tabla cumple las propiedades del estándar', () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  const seen = new Set<string>();
  CODE128_PATTERNS.forEach((p, v) => {
    assert.ok(!seen.has(p), `patrón repetido en ${v}`);
    seen.add(p);
    const w = [...p].map(Number);
    if (v < 106) {
      assert.equal(w.length, 6, `símbolo ${v}`);
      assert.equal(w.reduce((a, b) => a + b, 0), 11, `suma 11 en ${v}`);
      assert.equal((w[0]! + w[2]! + w[4]!) % 2, 0, `barras pares en ${v}`);
    } else {
      assert.equal(w.length, 7);
      assert.equal(w.reduce((a, b) => a + b, 0), 13);
    }
    assert.ok(w.every((n) => n >= 1 && n <= 4));
  });
});

test('Code128: suma de verificación e inicio/paro', () => {
  // "AMA1": A=33, M=45, A=33, 1=17 ; 104 + 33*1 + 45*2 + 33*3 + 17*4 = 394 ; 394 % 103 = 85
  const v = code128BValues('AMA1');
  assert.deepEqual(v, [104, 33, 45, 33, 17, 85, 106]);
  // Ancho total: 6 símbolos de 11 + paro de 13 = 79 módulos
  assert.equal(code128BWidths('AMA1').reduce((a, b) => a + b, 0), 6 * 11 + 13);
  const l = code128Layout('AMA1');
  assert.equal(l.totalModules, 79 + 20);
  assert.equal(l.bars[0]!.x, 10);
  // Primer símbolo (inicio B = 211214): primera barra de 2 módulos.
  assert.equal(l.bars[0]!.width, 2);
});

test('Code128: rechaza vacío y caracteres no imprimibles', () => {
  assert.throws(() => code128BValues(''), Code128Error);
  assert.throws(() => code128BValues('Ñandú'), Code128Error);
  assert.doesNotThrow(() => code128BValues('AMA00000001'));
});

// ───────────── Entradas con permiso temporal ─────────────
const NOW = Date.parse('2026-10-22T18:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const grant = (over: Partial<Grant> = {}): Grant => ({
  id: 'g1', sellerId: 'u1', branchId: 'b1', functions: ['inventario.entrada'],
  startsAt: iso(NOW - 3600_000), expiresAt: iso(NOW + 30 * 60_000), revokedAt: null, grantedBy: 'm1', ...over,
});
const base = (over: Partial<EntryAccessInput> = {}): EntryAccessInput => ({
  role: 'vendedor', userId: 'u1', branchId: 'b1', grants: [grant()], grantsFetchedAt: iso(NOW - 5 * 60_000),
  nowMs: NOW, lastServerTimeIso: iso(NOW - 5 * 60_000), clockHighWaterIso: iso(NOW - 60_000), ...over,
});

test('Entradas: gerente siempre; vendedor con permiso vigente', () => {
  assert.equal(evaluateEntryAccess(base({ role: 'gerente', grants: [] })).allowed, true);
  const r = evaluateEntryAccess(base());
  assert.equal(r.allowed, true);
  if (r.allowed) {
    assert.equal(r.viaGrant, true);
    assert.equal(r.minutesLeft, 30);
    assert.equal(r.warnings.length, 0);
  }
});

test('Entradas: bloqueos (vencido, otra sucursal, revocado, sin permiso, desarrollador)', () => {
  const code = (i: EntryAccessInput) => { const r = evaluateEntryAccess(i); return r.allowed ? 'ok' : r.code; };
  assert.equal(code(base({ grants: [grant({ expiresAt: iso(NOW - 1000) })] })), 'permiso_vencido');
  assert.equal(code(base({ grants: [grant({ expiresAt: iso(NOW) })] })), 'permiso_vencido'); // el límite es exclusivo
  assert.equal(code(base({ grants: [grant({ branchId: 'otra' })] })), 'sin_permiso_vigente');
  assert.equal(code(base({ grants: [grant({ revokedAt: iso(NOW - 1000) })] })), 'sin_permiso_vigente');
  assert.equal(code(base({ grants: [] })), 'sin_permiso_vigente');
  assert.equal(code(base({ grants: [grant({ startsAt: iso(NOW + 1000) })] })), 'sin_permiso_vigente');
  assert.equal(code(base({ role: 'desarrollador' })), 'sin_permiso');
  assert.equal(code(base({ grants: [grant({ sellerId: 'otro' })] })), 'sin_permiso_vigente');
});

test('Entradas: NO se puede comprobar => bloquea', () => {
  const code = (i: EntryAccessInput) => { const r = evaluateEntryAccess(i); return r.allowed ? 'ok' : r.code; };
  assert.equal(code(base({ lastServerTimeIso: null })), 'sin_sincronizar');
  assert.equal(code(base({ nowMs: NaN })), 'hora_invalida');
  // Reloj atrasado respecto al servidor.
  assert.equal(code(base({ nowMs: NOW - 3600_000, lastServerTimeIso: iso(NOW) })), 'reloj_atrasado');
  // Reloj atrasado respecto a lo que la propia app ya vio.
  assert.equal(code(base({ clockHighWaterIso: iso(NOW + 3600_000) })), 'reloj_atrasado');
  // Permisos descargados hace más de 24 h.
  assert.equal(code(base({ grantsFetchedAt: iso(NOW - 25 * 3600_000), lastServerTimeIso: iso(NOW - 25 * 3600_000) })), 'permisos_viejos');
  assert.equal(code(base({ grantsFetchedAt: null })), 'permisos_viejos');
});

test('Entradas: aviso si los permisos llevan más de 1 h sin actualizarse', () => {
  const r = evaluateEntryAccess(base({ grantsFetchedAt: iso(NOW - 3 * 3600_000), lastServerTimeIso: iso(NOW - 3 * 3600_000) }));
  assert.equal(r.allowed, true);
  if (r.allowed) assert.equal(r.warnings.length, 1);
});

// ───────────── Bloqueo / perfil sin conexión ─────────────
test('Bloqueo escalonado de intentos', () => {
  let s = EMPTY_LOCK;
  for (let i = 0; i < 4; i++) s = registerFailure(s, 1000);
  assert.equal(isLocked(s, 1000), false);
  s = registerFailure(s, 1000); // 5.º fallo
  assert.equal(isLocked(s, 1000), true);
  assert.equal(lockRemainingMs(s, 1000), 60_000);
  assert.equal(isLocked(s, 1000 + 60_000), false);
  s = registerFailure(s, 100_000); // 6.º
  assert.equal(lockRemainingMs(s, 100_000), 120_000);
  assert.deepEqual(parseLock('basura'), EMPTY_LOCK);
  assert.deepEqual(parseLock(JSON.stringify(s)), s);
});

test('Perfil offline: caducidad y llaves válidas para SecureStore', () => {
  const t = iso(NOW);
  assert.equal(isProfileUsable({ verifiedAt: t }, NOW + 5 * 86_400_000, 30).ok, true);
  assert.equal(isProfileUsable({ verifiedAt: t }, NOW + 31 * 86_400_000, 30).ok, false);
  assert.equal(isProfileUsable({ verifiedAt: t }, NOW - 3600_000, 30).ok, false);
  assert.equal(isProfileUsable({ verifiedAt: 'x' }, NOW, 30).ok, false);
  assert.match(profileKey('  Gerente.Uno '), /^amara\.profile\.[0-9a-f]+$/);
  assert.equal(profileKey('A'), profileKey('a'));
  assert.match(lockKey('a'), /^amara\.lock\.[0-9a-f]+$/);
  assert.equal(parseProfile('{"userId":1}'), null);
  assert.ok(parseProfile(JSON.stringify({ userId: 'u', username: 'x', name: 'X', role: 'vendedor', branchIds: [], verifier: 'scrypt$1$1$1$aa$bb', verifiedAt: t })));
});

// ───────────── Dinero, pagos y carrito ─────────────
test('Importes escritos', () => {
  assert.equal(parseMoneyInput('125'), 12500);
  assert.equal(parseMoneyInput('125.5'), 12550);
  assert.equal(parseMoneyInput('$1,250.00'), 125000);
  assert.equal(parseMoneyInput('1250'), 125000);
  assert.equal(parseMoneyInput('.5'), 50);
  assert.equal(parseMoneyInput(''), null);
  assert.equal(parseMoneyInput('abc'), null);
  assert.equal(parseMoneyInput('-5'), null);
  assert.equal(parseMoneyInput('1.234'), null);
  assert.equal(parseIntInput('3'), 3);
  assert.equal(parseIntInput('0'), null);
  assert.equal(parseIntInput('0', { allowZero: true }), 0);
  assert.equal(parseIntInput('-2', { allowNegative: true }), -2);
  assert.equal(parseIntInput('2.5'), null);
});

test('Pagos: cambio, restante y reglas', () => {
  const cash = { method: 'efectivo' as const, amountCents: 18000, tenderedCents: 20000 };
  const s = summarizePayments(18000, [cash]);
  assert.deepEqual(s, { paidCents: 18000, remainingCents: 0, changeCents: 2000, complete: true });
  assert.equal(summarizePayments(18000, []).complete, false);
  assert.equal(summarizePayments(18000, [{ method: 'tarjeta', amountCents: 5000 }]).remainingCents, 13000);
  assert.equal(validateNewPayment(18000, [cash], { method: 'efectivo', amountCents: 1 }), 'El pago excede lo que falta por cobrar.');
  assert.match(validateNewPayment(18000, [{ method: 'efectivo', amountCents: 100 }], { method: 'efectivo', amountCents: 100 })!, /Solo se admite un pago en efectivo/);
  assert.match(validateNewPayment(1000, [], { method: 'efectivo', amountCents: 1000, tenderedCents: 500 })!, /menor/);
  assert.match(validateNewPayment(1000, [], { method: 'tarjeta', amountCents: 1000, tenderedCents: 2000 })!, /Solo el efectivo/);
  assert.equal(validateNewPayment(1000, [], { method: 'tarjeta', amountCents: 1000 }), null);
  assert.deepEqual(toPaymentInputs([cash, { method: 'tarjeta', amountCents: 5 }]), [
    { method: 'efectivo', amountCents: 18000, tenderedCents: 20000 },
    { method: 'tarjeta', amountCents: 5 },
  ]);
});

test('Carrito: agregar 1 unidad, sumar, cambiar y borrar; borrador', () => {
  let c = newCart('11111111-1111-4111-8111-111111111111');
  const vela = { variantId: 'v1', productName: 'Vela', label: 'Chica', priceCents: 9000 };
  c = addToCart(c, vela);
  c = addToCart(c, vela);
  c = addToCart(c, { variantId: 'v2', productName: 'Incienso', label: 'Caja', priceCents: 2500 });
  assert.equal(c.lines.length, 2);
  assert.equal(c.lines[0]!.qty, 2);
  assert.equal(cartTotalCents(c), 20500);
  assert.equal(cartUnits(c), 3);
  assert.equal(setQty(c, 'v1', 5).lines[0]!.qty, 5);
  assert.equal(setQty(c, 'v1', 0).lines.length, 1);
  assert.equal(removeLine(c, 'v2').lines.length, 1);
  assert.equal(addToCart(c, vela, 0), c);
  const d = parseDraft(JSON.stringify(toDraft(c)))!;
  assert.equal(d.saleId, c.saleId); // el mismo saleId sobrevive: reintentar no duplica
  assert.equal(d.lines.length, 2);
  assert.equal(parseDraft('no json'), null);
  assert.equal(parseDraft(JSON.stringify({ saleId: 'x', lines: [{ variantId: 'a', qty: 0 }, { variantId: 'b', qty: 2 }] }))!.lines.length, 1);
});

// ───────────── Lectura de códigos ─────────────
test('Códigos candidatos (UPC-A/EAN-13) y antirrebote', () => {
  assert.deepEqual(candidateCodes(' 7501234567890 '), ['7501234567890']);
  assert.deepEqual(candidateCodes('0012345678905'), ['0012345678905', '012345678905']);
  assert.deepEqual(candidateCodes('012345678905'), ['012345678905', '0012345678905']);
  assert.deepEqual(candidateCodes('   '), []);
  const d = new ScanDebouncer(1500);
  assert.equal(d.accept('A', 0), true);
  assert.equal(d.accept('A', 1000), false);
  assert.equal(d.accept('B', 1100), true);
  assert.equal(d.accept('B', 2700), true);
  d.reset();
  assert.equal(d.accept('B', 2701), true);
});

// ───────────── QR de vinculación ─────────────
test('Vinculación: valida formato, caducidad y red local', () => {
  const mk = (over: object = {}) => encodePairingPayload({ v: 1, host: '192.168.1.20', port: 47880, secret: 'abc', expiresAt: iso(NOW + 60_000), terminalId: 'T1', ...over } as any);
  assert.equal(evaluatePairingPayload(mk(), NOW).ok, true);
  assert.equal(evaluatePairingPayload('hola', NOW).ok, false);
  assert.match((evaluatePairingPayload(mk({ expiresAt: iso(NOW - 1) }), NOW) as any).error, /caducó/);
  assert.match((evaluatePairingPayload(mk({ host: '8.8.8.8' }), NOW) as any).error, /red local/);
  assert.match((evaluatePairingPayload(mk({ port: 99999 }), NOW) as any).error, /puerto/);
  assert.equal(isPrivateHost('10.0.0.5'), true);
  assert.equal(isPrivateHost('172.16.0.1'), true);
  assert.equal(isPrivateHost('172.32.0.1'), false);
  assert.equal(isPrivateHost('caja-pc.local'), true);
  assert.equal(isPrivateHost('evil.example.com'), false);
  assert.equal(isPrivateHost('999.1.1.1'), false);
});

// ───────────── Respuestas del servidor ─────────────
test('Estadísticas: acepta {summary} o el resumen directo y rechaza basura', () => {
  const summary = {
    grossCents: 33000, cancelledCents: 15000, refundedCents: 0, netCents: 18000, ticketCount: 2, cancelledCount: 1, refundCount: 0, avgTicketCents: 18000,
    byMethod: { efectivo: { grossCents: 18000, refundedCents: 0, netCents: 18000 }, tarjeta: { grossCents: 15000, refundedCents: 15000, netCents: 0 } },
  };
  const a = parseStatsResponse({ summary, generatedAt: '2026-10-22T18:00:00.000Z' });
  assert.equal(a.summary.netCents, 18000);
  assert.equal(a.updatedAt, '2026-10-22T18:00:00.000Z');
  assert.equal(a.summary.byMethod.transferencia.grossCents, 0); // métodos ausentes = 0
  assert.equal(parseStatsResponse(summary).updatedAt, null);
  assert.throws(() => parseStatsResponse({ foo: 1 }), StatsParseError);
  assert.throws(() => parseStatsResponse({ grossCents: 1.5, netCents: 1 }), StatsParseError);
  assert.throws(() => parseStatsResponse(null), StatsParseError);
  assert.equal(parseCashExpected({ breakdown: { expectedCents: 123 } }), 123);
  assert.equal(parseCashExpected({ session: { breakdown: { expectedCents: 5 } } }), 5);
  assert.equal(parseCashExpected(null), null);
  assert.equal(parseCashExpected({ session: null }), null);
});

// ───────────── Ticket ─────────────
test('Ticket: texto, HTML con 2 copias y escape', () => {
  const t = {
    business: 'Esotérica <Amara>', branchName: 'Centro', folio: 'AMA-AP1-261022-0001', createdAt: '2026-10-22T18:00:00.000Z', userName: 'Ana',
    items: [{ name: 'Vela "ritual"', label: 'Chica', qty: 2, unitPriceCents: 9000, netCents: 18000 }],
    subtotalCents: 18000, discountCents: 0, totalCents: 18000,
    payments: [{ method: 'efectivo', amountCents: 18000, tenderedCents: 20000, changeCents: 2000 }], status: 'completada',
  };
  const lines = ticketLines(t).map((l) => l.text).join('\n');
  assert.match(lines, /Folio: AMA-AP1-261022-0001/);
  assert.match(lines, /TOTAL: \$180\.00/);
  assert.match(lines, /Cambio: \$20\.00/);
  const html = ticketCopiesHtml(t);
  assert.equal((html.match(/COPIA CLIENTE/g) ?? []).length, 1);
  assert.equal((html.match(/COPIA TIENDA/g) ?? []).length, 1);
  assert.ok(!html.includes('<Amara>'));
  assert.ok(html.includes('&lt;Amara&gt;'));
  assert.ok(html.includes('Vela &quot;ritual&quot;'));
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});
