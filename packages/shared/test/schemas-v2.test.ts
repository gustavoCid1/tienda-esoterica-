import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionAuthorizationSchema, cashCloseSchema, extraCategoriesSchema, securityTokenCreateSchema, securityVerifySchema, terminalSchema } from '../src/schemas.ts';

const U = '11111111-1111-4111-8111-111111111111';

test('autorización: solo "quién autorizó", sin contraseña ni código', () => {
  assert.ok(actionAuthorizationSchema.safeParse({ kind: 'admin_password', adminUserId: U }).success);
  assert.ok(actionAuthorizationSchema.safeParse({ kind: 'token', tokenId: U }).success);
  assert.ok(!actionAuthorizationSchema.safeParse({ kind: 'token' }).success);
  assert.ok(!actionAuthorizationSchema.safeParse({ kind: 'otra', tokenId: U }).success);
  // las claves extra (p. ej. una contraseña) se descartan: nunca se conservan
  const parsed = actionAuthorizationSchema.parse({ kind: 'admin_password', adminUserId: U, adminPassword: 'secreta123' });
  assert.deepEqual(parsed, { kind: 'admin_password', adminUserId: U });
});

test('crear token: duración de 1 minuto a 7 días, código de 6 a 10, propósitos válidos', () => {
  const base = { label: 'Cierre tarde', purposes: ['cierre_caja'], durationMinutes: 60 };
  assert.ok(securityTokenCreateSchema.safeParse(base).success);
  assert.ok(securityTokenCreateSchema.safeParse({ ...base, durationMinutes: 1 }).success);
  assert.ok(securityTokenCreateSchema.safeParse({ ...base, durationMinutes: 7 * 24 * 60 }).success);
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, durationMinutes: 0 }).success);
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, durationMinutes: 7 * 24 * 60 + 1 }).success);
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, purposes: [] }).success);
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, purposes: ['otra'] }).success);
  assert.ok(securityTokenCreateSchema.safeParse({ ...base, length: 10 }).success);
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, length: 11 }).success, 'máximo 10 caracteres');
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, length: 5 }).success);
  assert.ok(securityTokenCreateSchema.safeParse({ ...base, branchId: null, forUserId: null, maxUses: null }).success);
  assert.ok(!securityTokenCreateSchema.safeParse({ ...base, maxUses: 0 }).success);
});

test('verificar: o un código o una contraseña de gerente, nunca ambos ni ninguno', () => {
  const base = { purpose: 'cierre_caja', branchId: U };
  assert.ok(securityVerifySchema.safeParse({ ...base, code: 'ABCD2345' }).success);
  assert.ok(securityVerifySchema.safeParse({ ...base, adminPassword: 'x', adminUsername: 'gerente' }).success);
  assert.ok(!securityVerifySchema.safeParse(base).success);
  assert.ok(!securityVerifySchema.safeParse({ ...base, code: 'A', adminPassword: 'x' }).success);
  assert.ok(!securityVerifySchema.safeParse({ code: 'A', purpose: 'otra', branchId: U }).success);
});

test('terminal v2: kind obligatorio, code/name/assignedTo opcionales', () => {
  assert.ok(terminalSchema.safeParse({ branchId: U, kind: 'movil', assignedTo: 'Lupita' }).success);
  assert.ok(terminalSchema.safeParse({ branchId: U, kind: 'escritorio', code: 'P2', name: 'Caja 2' }).success);
  assert.ok(!terminalSchema.safeParse({ branchId: U, assignedTo: 'Lupita' }).success);
  assert.ok(!terminalSchema.safeParse({ branchId: U, kind: 'tablet' }).success);
});

test('cierre de caja acepta authorization; categorías de extras se validan', () => {
  assert.ok(cashCloseSchema.safeParse({ countedCents: 1000, authorization: { kind: 'token', tokenId: U } }).success);
  assert.ok(cashCloseSchema.safeParse({ countedCents: 1000 }).success);
  assert.ok(extraCategoriesSchema.safeParse({ categories: ['Veladoras'] }).success);
  assert.ok(extraCategoriesSchema.safeParse({ categories: [] }).success);
  assert.ok(!extraCategoriesSchema.safeParse({ categories: [''] }).success);
});
