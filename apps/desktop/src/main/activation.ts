/**
 * Activación de la terminal: vincula esta PC con una sucursal y una terminal de la API.
 *
 * Flujo normal (con internet): el GERENTE escribe su usuario y contraseña; se listan sucursales
 * y terminales (GET /admin/branches, /admin/terminals); al elegir una se pide el token de la
 * terminal (POST /admin/terminals/:id/token). El token se guarda CIFRADO (safeStorage) y sirve
 * para sincronizar (/sync/push, /sync/pull). Nunca se guarda la contraseña del gerente.
 *
 * SUPUESTO sin verificar: la forma exacta de las respuestas de /admin/* no está en docs/API.md;
 * `asList`/`pick*` aceptan variantes (id | _id, arreglo | {items}). Ver docs/PENDIENTES-desktop.md.
 * Alternativa: activación manual pegando el token y los identificadores.
 */
import type { LocalStore } from '@amara/database';
import { normalizeApiUrl } from '../shared/settings.ts';
import type { ActivationOptions, DeviceState } from '../shared/ipc.ts';
import { apiRequest } from './api-client.ts';
import { auditLocal } from './audit.ts';
import { AppError } from './errors.ts';
import type { SecretStore } from './secrets.ts';
import type { SettingsStore } from './settings.ts';

const PENDING_TTL_MS = 10 * 60_000;

function asList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['items', 'data', 'branches', 'terminals']) if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}
const idOf = (o: Record<string, unknown>): string => String(o.id ?? o._id ?? '');
const s = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

export class ActivationService {
  private pending: { apiUrl: string; token: string; options: ActivationOptions; at: number } | null = null;

  constructor(private d: { store: LocalStore; settings: SettingsStore; secrets: SecretStore; afterActivation: () => Promise<void> }) {}

  async deviceState(): Promise<DeviceState> {
    const dev = await this.d.store.getDeviceInfo();
    const apiUrl = this.d.settings.get().apiUrl;
    if (!dev) return { activated: false, apiUrl, branch: null, terminal: null };
    const row = await this.d.store.db.get<{ name: string }>('SELECT name FROM branches WHERE id = ?', [dev.branchId]);
    return {
      activated: true,
      apiUrl,
      branch: { id: dev.branchId, code: dev.branchCode, name: row?.name ?? dev.branchCode },
      terminal: { id: dev.terminalId, code: dev.terminalCode },
    };
  }

  async options(apiUrlRaw: string, username: string, password: string): Promise<ActivationOptions> {
    const apiUrl = normalizeApiUrl(apiUrlRaw);
    if (!apiUrl) throw new AppError('url_invalida', 'Escribe la dirección del servidor (por ejemplo https://amara.midominio.com).');
    let login: { token: string; user: { role: string } };
    try {
      login = await apiRequest(apiUrl, '/auth/login', { body: { username: username.trim(), password }, timeoutMs: 10_000 });
    } catch (e) {
      throw new AppError('api', `No se pudo iniciar sesión en el servidor: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (login.user.role !== 'gerente') throw new AppError('rol', 'Solo un gerente puede activar una terminal.');
    const [rawB, rawT] = await Promise.all([
      apiRequest<unknown>(apiUrl, '/admin/branches', { token: login.token }),
      apiRequest<unknown>(apiUrl, '/admin/terminals', { token: login.token }),
    ]);
    const branches = asList(rawB)
      .map((b) => ({ id: idOf(b), code: s(b.code), name: s(b.name) || s(b.code) }))
      .filter((b) => b.id && b.code);
    const terminals = asList(rawT)
      .filter((t) => !t.revoked && (t.kind === undefined || t.kind === 'escritorio'))
      .map((t) => ({ id: idOf(t), code: s(t.code), name: s(t.name) || s(t.code), branchId: s(t.branchId) }))
      .filter((t) => t.id && t.code);
    if (branches.length === 0 || terminals.length === 0) {
      throw new AppError('sin_datos', 'El servidor no tiene sucursales o terminales de escritorio dadas de alta. Créalas primero en el panel web.');
    }
    const options = { branches, terminals };
    this.pending = { apiUrl, token: login.token, options, at: Date.now() };
    return options;
  }

  async activate(branchId: string, terminalId: string): Promise<DeviceState> {
    const p = this.pending;
    if (!p || Date.now() - p.at > PENDING_TTL_MS) {
      this.pending = null;
      throw new AppError('sesion_activacion', 'Pasaron más de 10 minutos: vuelve a escribir el usuario y la contraseña del gerente.');
    }
    const branch = p.options.branches.find((b) => b.id === branchId);
    const terminal = p.options.terminals.find((t) => t.id === terminalId);
    if (!branch || !terminal) throw new AppError('seleccion', 'Elige una sucursal y una terminal de la lista.');
    if (terminal.branchId && terminal.branchId !== branch.id) throw new AppError('seleccion', 'Esa terminal pertenece a otra sucursal.');
    await this.guardChange(terminal.id);

    let tokenRes: { token?: string; terminalToken?: string };
    try {
      tokenRes = await apiRequest(p.apiUrl, `/admin/terminals/${encodeURIComponent(terminal.id)}/token`, { method: 'POST', token: p.token, body: {} });
    } catch (e) {
      throw new AppError('api', `El servidor no entregó el token de la terminal: ${e instanceof Error ? e.message : String(e)}`);
    }
    const token = tokenRes.token ?? tokenRes.terminalToken;
    if (!token) throw new AppError('api', 'La respuesta del servidor no incluyó el token de la terminal.');
    return this.finish(p.apiUrl, token, { branchId: branch.id, branchCode: branch.code, branchName: branch.name, terminalId: terminal.id, terminalCode: terminal.code });
  }

  async manual(i: { apiUrl: string; token: string; branchId: string; branchCode: string; branchName: string; terminalId: string; terminalCode: string }): Promise<DeviceState> {
    const apiUrl = normalizeApiUrl(i.apiUrl);
    if (!apiUrl) throw new AppError('url_invalida', 'La dirección del servidor no es válida.');
    if (!i.token.trim() || !i.branchId.trim() || !i.branchCode.trim() || !i.terminalId.trim() || !i.terminalCode.trim()) {
      throw new AppError('datos_faltantes', 'Completa todos los campos.');
    }
    await this.guardChange(i.terminalId.trim());
    return this.finish(apiUrl, i.token.trim(), {
      branchId: i.branchId.trim(), branchCode: i.branchCode.trim().toUpperCase(), branchName: i.branchName.trim() || i.branchCode.trim(),
      terminalId: i.terminalId.trim(), terminalCode: i.terminalCode.trim().toUpperCase(),
    });
  }

  /** No se cambia de terminal/sucursal con operaciones pendientes: saldrían con datos de otra terminal. */
  private async guardChange(newTerminalId: string): Promise<void> {
    const cur = await this.d.store.getDeviceInfo();
    if (cur && cur.terminalId !== newTerminalId && (await this.d.store.pendingCount()) > 0) {
      throw new AppError('pendientes', 'Hay operaciones sin sincronizar. Sincroniza primero antes de cambiar de terminal.');
    }
  }

  private async finish(apiUrl: string, token: string, v: { branchId: string; branchCode: string; branchName: string; terminalId: string; terminalCode: string }): Promise<DeviceState> {
    this.d.secrets.setTerminalToken(token);
    await this.d.store.setDeviceInfo({ branchId: v.branchId, branchCode: v.branchCode, terminalId: v.terminalId, terminalCode: v.terminalCode });
    // Nombre de la sucursal para mostrar (el primer pull lo confirma).
    await this.d.store.db.run(
      "INSERT INTO branches (id, code, name, status, locations_json) VALUES (?,?,?, 'activa', '[]') ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name",
      [v.branchId, v.branchCode, v.branchName],
    );
    this.d.settings.save({ apiUrl });
    this.pending = null;
    await auditLocal(this.d.store, { action: 'terminal.activar', branchId: v.branchId, terminalId: v.terminalId, detail: { branchCode: v.branchCode, terminalCode: v.terminalCode } });
    try {
      await this.d.afterActivation(); // primer pull: catálogo, existencias y usuarios
    } catch {
      /* si no hay red ahora, el ciclo periódico lo reintenta */
    }
    return this.deviceState();
  }
}
