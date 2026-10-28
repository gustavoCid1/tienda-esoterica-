/**
 * Permisos por ruta con supertest SIN MongoDB: todas las comprobaciones ocurren ANTES de leer la base
 * (la autenticación se sustituye por un doble que toma el rol de una cabecera). Si alguna ruta llegara a
 * tocar la base sin permiso, la prueba fallaría con 500 ("Base de datos no conectada").
 */
import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Role } from '@amara/shared';
import { createApp } from '../src/app.ts';

const BR = '11111111-1111-4111-8111-111111111111';
const fakeAuth: RequestHandler = (req, _res, next) => {
  const role = req.header('x-test-role');
  if (role) req.user = { id: 'u-test', username: 'test', name: 'Test', role: role as Role, branchIds: [BR] };
  if (req.header('x-test-terminal')) req.terminal = { id: 'term-1', code: 'T1', branchId: BR };
  next();
};
const api = request(createApp({ authenticate: fakeAuth, corsOrigins: ['http://localhost:5173'] }));
const as = (role: Role) => ({ 'x-test-role': role });

const STATS_GET = ['/stats/today', '/stats/summary', '/stats/months', '/stats/dashboard', '/stats/reports/daily', '/stats/reports/weekly', '/stats/reports/monthly', '/stats/cualquier-cosa-futura',
  // v2
  '/stats/low-stock', '/stats/top-products-series', '/stats/product-series?productId=x'];

describe('estadísticas y reportes: solo gerente', () => {
  for (const role of ['vendedor', 'desarrollador'] as const) {
    for (const path of STATS_GET) {
      it(`${role} recibe 403 en GET ${path}`, async () => {
        const res = await api.get(path).set(as(role));
        expect(res.status).toBe(403);
        expect(res.body.error).toBeTruthy();
      });
    }
    it(`${role} recibe 403 en las preferencias del tablero`, async () => {
      expect((await api.get('/prefs/dashboard').set(as(role))).status).toBe(403);
      expect((await api.put('/prefs/dashboard').set(as(role)).send({ compact: true })).status).toBe(403);
    });
  }
});

describe('el desarrollador no ve finanzas ni datos de negocio', () => {
  const paths = [
    '/sales', '/sales/mine', '/sales/abc', '/cash/sessions', '/cash/current?terminalId=t', '/catalog/products', '/catalog/pull', '/inventory',
    '/inventory/movements', '/admin/users', '/admin/branches', '/admin/terminals', '/admin/grants', '/admin/conflicts', '/admin/audit',
  ];
  for (const p of paths) {
    it(`GET ${p} → 403`, async () => {
      expect((await api.get(p).set(as('desarrollador'))).status).toBe(403);
    });
  }
  it('no puede registrar movimientos de inventario', async () => {
    const res = await api.post('/inventory/movements').set(as('desarrollador')).send({ id: BR, variantId: BR, branchId: BR, type: 'entrada', qty: 1, reason: 'prueba' });
    expect(res.status).toBe(403);
  });
});

describe('vendedor: sin administración, caja ni archivo', () => {
  const gets = ['/cash/sessions', '/admin/users', '/admin/audit', '/admin/backups', '/admin/conflicts', '/admin/diagnostics', '/sales'];
  for (const p of gets) {
    it(`GET ${p} → 403`, async () => {
      expect((await api.get(p).set(as('vendedor'))).status).toBe(403);
    });
  }
  it('no puede hacer corte, apertura de caja ni movimientos de caja', async () => {
    expect((await api.post('/cash/close').set(as('vendedor')).send({ countedCents: 0, terminalId: 't' })).status).toBe(403);
    expect((await api.post('/cash/open').set(as('vendedor')).send({ terminalId: 't', branchId: BR, openingCents: 0 })).status).toBe(403);
    expect((await api.post('/cash/movements').set(as('vendedor')).send({})).status).toBe(403);
  });
  it('no puede cancelar, devolver, transferir, crear productos ni administrar', async () => {
    expect((await api.post('/sales/x/cancel').set(as('vendedor')).send({ reason: 'abc' })).status).toBe(403);
    expect((await api.post('/sales/x/return').set(as('vendedor')).send({})).status).toBe(403);
    expect((await api.post('/inventory/transfers').set(as('vendedor')).send({})).status).toBe(403);
    expect((await api.post('/inventory/reconcile').set(as('vendedor')).send({})).status).toBe(403);
    expect((await api.post('/catalog/products').set(as('vendedor')).send({})).status).toBe(403);
    expect((await api.post('/admin/users').set(as('vendedor')).send({})).status).toBe(403);
    expect((await api.post('/admin/grants').set(as('vendedor')).send({})).status).toBe(403);
    expect((await api.post('/admin/terminals/x/token').set(as('vendedor')).send({})).status).toBe(403);
  });
  it('el vendedor solo puede intentar entradas; salidas y ajustes son 403 sin consultar la base', async () => {
    const body = { id: BR, variantId: BR, branchId: BR, qty: 1, reason: 'prueba' };
    expect((await api.post('/inventory/movements').set(as('vendedor')).send({ ...body, type: 'salida' })).status).toBe(403);
    expect((await api.post('/inventory/movements').set(as('vendedor')).send({ ...body, type: 'ajuste' })).status).toBe(403);
    expect((await api.post('/inventory/movements').set(as('vendedor')).send({ ...body, type: 'conteo' })).status).toBe(403);
  });
});

describe('acciones sensibles exigen x-reauth', () => {
  const post = (p: string, body: object = {}) => api.post(p).set(as('gerente')).send(body);
  it('corte de caja sin reautenticación → 401', async () => {
    expect((await post('/cash/close', { countedCents: 0, terminalId: 't' })).status).toBe(401);
  });
  it('cancelar y devolver ventas sin reautenticación → 401', async () => {
    expect((await post('/sales/x/cancel', { reason: 'abc' })).status).toBe(401);
    expect((await post('/sales/x/return', {})).status).toBe(401);
  });
  it('crear usuarios y emitir/revocar tokens de terminal sin reautenticación → 401', async () => {
    expect((await post('/admin/users', {})).status).toBe(401);
    expect((await post('/admin/terminals/x/token')).status).toBe(401);
    expect((await post('/admin/terminals/x/revoke')).status).toBe(401);
  });
  it('un reauth inválido sigue siendo 401', async () => {
    const res = await api.post('/cash/close').set(as('gerente')).set('x-reauth', 'no-es-un-token').send({ countedCents: 0, terminalId: 't' });
    expect(res.status).toBe(401);
  });
});

describe('tokens de terminal solo pasan en /sync', () => {
  const term = { 'x-test-terminal': '1' };
  for (const p of ['/catalog/products', '/catalog/pull', '/inventory', '/sales', '/cash/sessions', '/stats/today', '/admin/users', '/prefs/dashboard']) {
    it(`GET ${p} con token de terminal → 403`, async () => {
      expect((await api.get(p).set(term)).status).toBe(403);
    });
  }
  it('POST /sync/push con token de OTRA terminal → 403', async () => {
    const res = await api.post('/sync/push').set(term).send({ terminalId: 'otra-terminal', ops: [] });
    expect(res.status).toBe(403);
  });
  it('/sync sin credenciales → 401', async () => {
    expect((await api.post('/sync/push').send({ terminalId: 'x', ops: [] })).status).toBe(401);
  });
  it('el desarrollador con sesión tampoco sincroniza', async () => {
    expect((await api.post('/sync/push').set(as('desarrollador')).send({ terminalId: 'x', ops: [] })).status).toBe(403);
    expect((await api.get(`/sync/pull?branchId=${BR}`).set(as('desarrollador'))).status).toBe(403);
  });
});

describe('autenticación real y errores', () => {
  const real = request(createApp({ corsOrigins: [] }));
  it('GET /health es pública', async () => {
    const res = await real.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.time).toBe('string');
    expect(typeof res.body.version).toBe('string');
  });
  it('sin Bearer → 401 en rutas protegidas', async () => {
    for (const p of ['/stats/today', '/inventory', '/auth/me', '/auth/permissions']) {
      expect((await real.get(p)).status).toBe(401);
    }
  });
  it('token basura → 401', async () => {
    expect((await real.get('/stats/today').set('Authorization', 'Bearer basura')).status).toBe(401);
  });
  it('login con cuerpo inválido → 400 sin tocar la base', async () => {
    expect((await real.post('/auth/login').send({})).status).toBe(400);
  });
  it('JSON roto → 400', async () => {
    const res = await real.post('/auth/login').set('content-type', 'application/json').send('{no es json');
    expect(res.status).toBe(400);
  });
  it('ruta inexistente → 404 en JSON', async () => {
    const res = await real.get('/nada');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
  it('CORS: solo orígenes configurados', async () => {
    const allowed = await api.get('/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await api.get('/health').set('Origin', 'https://malicioso.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});


describe('v2: tokens de seguridad, configuración de extras y resumen de hoy', () => {
  const AUTH = { kind: 'admin_password', adminUserId: 'g' };
  for (const role of ['vendedor', 'desarrollador'] as const) {
    it(`${role} no administra tokens ni la configuración de extras (403 sin tocar la base)`, async () => {
      expect((await api.get('/security/tokens').set(as(role))).status).toBe(403);
      expect((await api.post('/security/tokens').set(as(role)).send({})).status).toBe(403);
      expect((await api.post('/security/tokens/x/revoke').set(as(role)).send({})).status).toBe(403);
      expect((await api.put('/settings/extra-categories').set(as(role)).send({ categories: ['A'] })).status).toBe(403);
    });
    it(`${role} no ve el resumen de tickets de hoy`, async () => {
      expect((await api.get('/sales/today-summary').set(as(role))).status).toBe(403);
    });
  }
  it('el desarrollador no cierra caja, cancela ni devuelve, ni con autorización', async () => {
    expect((await api.post('/cash/close').set(as('desarrollador')).send({ countedCents: 0, terminalId: 't', authorization: AUTH })).status).toBe(403);
    expect((await api.post('/sales/x/cancel').set(as('desarrollador')).send({ reason: 'abc', authorization: AUTH })).status).toBe(403);
    expect((await api.post('/sales/x/return').set(as('desarrollador')).send({ authorization: AUTH })).status).toBe(403);
  });
  it('el vendedor SIN authorization sigue en 403 al cerrar, cancelar y devolver', async () => {
    expect((await api.post('/cash/close').set(as('vendedor')).send({ countedCents: 0, terminalId: 't' })).status).toBe(403);
    expect((await api.post('/sales/x/cancel').set(as('vendedor')).send({ reason: 'abc' })).status).toBe(403);
    expect((await api.post('/sales/x/return').set(as('vendedor')).send({})).status).toBe(403);
  });
  it('crear un token exige reautenticación del gerente → 401', async () => {
    expect((await api.post('/security/tokens').set(as('gerente')).send({ label: 'Cierre', purposes: ['cierre_caja'], durationMinutes: 60 })).status).toBe(401);
  });
  it('/security/verify valida el cuerpo antes de tocar la base (código o contraseña, uno solo)', async () => {
    const ok = { purpose: 'cierre_caja', branchId: BR };
    expect((await api.post('/security/verify').set(as('vendedor')).send(ok)).status).toBe(400);
    expect((await api.post('/security/verify').set(as('vendedor')).send({ ...ok, code: 'ABC', adminPassword: 'x' })).status).toBe(400);
    expect((await api.post('/security/verify').set(as('vendedor')).send({ ...ok, code: 'ABC', purpose: 'otro' })).status).toBe(400);
  });
  it('una terminal con token no administra tokens ni lee la configuración', async () => {
    const term = { 'x-test-terminal': '1' };
    expect((await api.get('/security/tokens').set(term)).status).toBe(403);
    expect((await api.post('/security/tokens/x/revoke').set(term).send({})).status).toBe(403);
    expect((await api.get('/settings/extra-categories').set(term)).status).toBe(403);
  });
  it('el vendedor no puede crear terminales ni emitir su token', async () => {
    expect((await api.post('/admin/terminals').set(as('vendedor')).send({ kind: 'movil', branchId: BR })).status).toBe(403);
    expect((await api.patch('/admin/terminals/x').set(as('vendedor')).send({ assignedTo: 'Ana' })).status).toBe(403);
  });
});
