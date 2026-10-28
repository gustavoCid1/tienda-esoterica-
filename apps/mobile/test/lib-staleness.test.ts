import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStaleness, humanAge } from '../src/lib/staleness.ts';

const NOW = Date.parse('2026-10-22T18:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('humanAge: segundos, minutos, horas y días', () => {
  assert.equal(humanAge(5_000), 'unos segundos');
  assert.equal(humanAge(5 * 60_000), '5 min');
  assert.equal(humanAge(2 * 3600_000 + 10 * 60_000), '2 h 10 min');
  assert.equal(humanAge(3 * 3600_000), '3 h');
  assert.equal(humanAge(24 * 3600_000), '1 día');
  assert.equal(humanAge(3 * 24 * 3600_000), '3 días');
});

test('nunca sincronizado', () => {
  const r = computeStaleness({ lastSyncOkAt: null, nowMs: NOW });
  assert.equal(r.level, 'nunca');
  assert.equal(r.ageMs, null);
  assert.equal(computeStaleness({ lastSyncOkAt: 'basura', nowMs: NOW }).level, 'nunca');
});

test('umbrales: reciente, aviso (1 h) y crítico (24 h)', () => {
  assert.equal(computeStaleness({ lastSyncOkAt: ago(10 * 60_000), nowMs: NOW }).level, 'reciente');
  assert.equal(computeStaleness({ lastSyncOkAt: ago(59 * 60_000), nowMs: NOW }).level, 'reciente');
  assert.equal(computeStaleness({ lastSyncOkAt: ago(60 * 60_000), nowMs: NOW }).level, 'aviso');
  assert.equal(computeStaleness({ lastSyncOkAt: ago(23 * 3600_000), nowMs: NOW }).level, 'aviso');
  assert.equal(computeStaleness({ lastSyncOkAt: ago(24 * 3600_000), nowMs: NOW }).level, 'critico');
});

test('umbrales personalizados', () => {
  const r = computeStaleness({ lastSyncOkAt: ago(10 * 60_000), nowMs: NOW, warnAfterMs: 5 * 60_000, criticalAfterMs: 8 * 60_000 });
  assert.equal(r.level, 'critico');
});

test('pendientes se mencionan en el detalle', () => {
  const r = computeStaleness({ lastSyncOkAt: ago(60_000), nowMs: NOW, pending: 3 });
  assert.match(r.detail, /3 operaciones sin enviar/);
  const one = computeStaleness({ lastSyncOkAt: ago(60_000), nowMs: NOW, pending: 1 });
  assert.match(one.detail, /1 operación sin enviar/);
});

test('sincronización "en el futuro": reloj sospechoso', () => {
  const r = computeStaleness({ lastSyncOkAt: new Date(NOW + 3600_000).toISOString(), nowMs: NOW });
  assert.equal(r.level, 'critico');
  assert.equal(r.clockSuspect, true);
  // Una diferencia pequeña (menos de 5 min) se tolera.
  const ok = computeStaleness({ lastSyncOkAt: new Date(NOW + 60_000).toISOString(), nowMs: NOW });
  assert.equal(ok.clockSuspect, false);
  assert.equal(ok.level, 'reciente');
});
