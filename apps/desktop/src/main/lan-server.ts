/**
 * Servidor LAN: el teléfono se vincula como ESCÁNER de la PC (sin internet, misma red Wi-Fi).
 *
 * Seguridad (ver packages/shared/src/lan-auth.ts):
 *  1. La PC genera un secreto de un solo uso y lo muestra SOLO como QR en pantalla; caduca en
 *     5 minutos, sirve para UN teléfono y puede cancelarse antes.
 *  2. El teléfono demuestra conocerlo con HMAC (POST /pair); ambos derivan la llave del
 *     dispositivo, que NUNCA viaja por la red. La PC la guarda cifrada (safeStorage).
 *  3. Cada petición lleva firma HMAC + marca de tiempo + nonce: verifyLanRequest rechaza
 *     firmas viejas (>60 s), repetidas (NonceCache) y dispositivos revocados.
 *  El HTTP va sin TLS: nadie puede FALSIFICAR lecturas sin la llave, pero el contenido es visible
 *  en la red local; por eso aquí solo viajan códigos de producto y folios, nada secreto.
 *
 * Rutas: POST /pair, GET /ping, POST /scan, POST /replicate, POST /print.
 * Las lecturas se APLICAN en la pantalla según el modo visible en la PC (VENTA/INVENTARIO).
 */
import http from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { DeviceInfo, LocalStore } from '@amara/database';
import { LAN_PORT, encodePairingPayload } from '@amara/shared';
import type { HmacHex, PairingPayload, SyncOp } from '@amara/shared';
import { NonceCache, verifyLanRequest, verifyPairing } from '@amara/sync';
import type { LanHeaders } from '@amara/sync';
import type { LanState, RemoteScan } from '../shared/ipc.ts';
import type { PrintService } from './printing.ts';
import type { SecretStore } from './secrets.ts';

export const hmacHex: HmacHex = (key, message) => createHmac('sha256', key).update(message).digest('hex');

const PAIRING_TTL_MS = 5 * 60_000;
const MAX_BODY = 1_000_000;
const MAX_PAIR_FAILURES = 5;

class HttpFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpFail(413, 'Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

const hdr = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Direcciones IPv4 de la PC en la red local; las privadas (192.168.x, 10.x, 172.16-31.x) primero. */
export function localHostCandidates(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  const priv = (a: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return out.sort((a, b) => Number(priv(b)) - Number(priv(a)));
}

export interface LanDeps {
  store: LocalStore;
  secrets: SecretStore;
  print: PrintService;
  getDevice: () => Promise<DeviceInfo | undefined>;
  isEnabled: () => boolean;
  /** ¿Hay un usuario con sesión iniciada en la PC? Sin sesión las lecturas se rechazan. */
  isSessionActive: () => boolean;
  onScan: (s: RemoteScan) => void;
  onStateChange: () => void;
  onReplicated: () => void;
}

export class LanServer {
  private server: http.Server | null = null;
  private listening = false;
  private error: string | null = null;
  private nonces = new NonceCache();
  private pairing: { secret: string; expiresAt: number; host: string; payloadText: string } | null = null;
  private pairingTimer: ReturnType<typeof setTimeout> | null = null;
  private pairFailures: number[] = [];

  constructor(private d: LanDeps) {}

  state(): LanState {
    if (this.pairing && this.pairing.expiresAt <= Date.now()) this.clearPairing();
    return {
      enabled: this.d.isEnabled(),
      listening: this.listening,
      port: LAN_PORT,
      error: this.error,
      pairing: this.pairing ? { expiresAt: new Date(this.pairing.expiresAt).toISOString(), payloadText: this.pairing.payloadText, host: this.pairing.host } : null,
      devices: this.d.secrets.listDevices(),
      hostCandidates: localHostCandidates(),
    };
  }

  async start(): Promise<void> {
    if (this.server || !this.d.isEnabled()) return;
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((e) => {
        const status = e instanceof HttpFail ? e.status : 500;
        if (!res.headersSent) send(res, status, { error: e instanceof HttpFail ? e.message : 'Error interno' });
        else res.end();
      });
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    this.server = server;
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.error = e.code === 'EADDRINUSE' ? `El puerto ${LAN_PORT} ya está en uso por otro programa.` : `No se pudo abrir el servidor del teléfono: ${e.message}`;
        this.listening = false;
        this.server = null;
        resolve();
      });
      server.listen(LAN_PORT, '0.0.0.0', () => {
        this.listening = true;
        this.error = null;
        resolve();
      });
    });
    this.d.onStateChange();
  }

  async stop(): Promise<void> {
    this.clearPairing();
    const s = this.server;
    this.server = null;
    this.listening = false;
    if (s) await new Promise<void>((r) => s.close(() => r()));
    this.d.onStateChange();
  }

  /** Genera el código de vinculación (QR). Caduca en 5 min, un solo uso, se puede cancelar. */
  async startPairing(host: string): Promise<LanState> {
    if (!this.d.isEnabled() || !this.listening) throw new Error('El servidor del teléfono no está activo. Actívalo en Ajustes.');
    if (!localHostCandidates().includes(host)) throw new Error('Elige una de las direcciones de red de esta PC.');
    const device = await this.d.getDevice();
    if (!device) throw new Error('La terminal no está activada.');
    const secret = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    const payload: PairingPayload = { v: 1, host, port: LAN_PORT, secret, expiresAt: new Date(expiresAt).toISOString(), terminalId: device.terminalId };
    this.clearPairing();
    this.pairing = { secret, expiresAt, host, payloadText: encodePairingPayload(payload) };
    this.pairFailures = [];
    this.pairingTimer = setTimeout(() => {
      this.clearPairing();
      this.d.onStateChange();
    }, PAIRING_TTL_MS + 500);
    this.d.onStateChange();
    return this.state();
  }

  cancelPairing(): LanState {
    this.clearPairing();
    this.d.onStateChange();
    return this.state();
  }

  revoke(deviceId: string): LanState {
    this.d.secrets.removeDevice(deviceId);
    this.d.onStateChange();
    return this.state();
  }

  private clearPairing(): void {
    this.pairing = null;
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = null;
  }

  // ───────────────────────────── peticiones ─────────────────────────────

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    const body = await readBody(req);

    if (method === 'POST' && path === '/pair') return this.pair(body, res);

    const deviceId = hdr(req.headers['x-amara-device']);
    const headers: Partial<Record<keyof LanHeaders, string>> = {
      'x-amara-device': deviceId,
      'x-amara-ts': hdr(req.headers['x-amara-ts']),
      'x-amara-nonce': hdr(req.headers['x-amara-nonce']),
      'x-amara-sig': hdr(req.headers['x-amara-sig']),
    };
    const verdict = verifyLanRequest({
      hmac: hmacHex,
      deviceKey: deviceId ? this.d.secrets.getDeviceKey(deviceId) : undefined,
      headers,
      method,
      path,
      body,
      nonces: this.nonces,
      nowMs: Date.now(),
    });
    if (!verdict.ok) return send(res, 401, { error: verdict.reason });
    const id = deviceId!;
    this.d.secrets.touchDevice(id, new Date().toISOString());

    const device = await this.d.getDevice();
    if (!device) return send(res, 409, { error: 'La terminal no está activada' });
    const name = this.d.secrets.listDevices().find((x) => x.id === id)?.name ?? 'Teléfono';

    if (method === 'GET' && path === '/ping') return send(res, 200, { ok: true, terminal: device.terminalCode });
    if (method !== 'POST') return send(res, 404, { error: 'Ruta no encontrada' });

    let json: any;
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      return send(res, 400, { error: 'JSON inválido' });
    }

    if (path === '/scan') return this.scan(json, device, name, res);
    if (path === '/replicate') return this.replicate(json, device, res);
    if (path === '/print') {
      if (typeof json.folio !== 'string' || json.folio.length > 60) return send(res, 400, { error: 'Folio inválido' });
      const r = await this.d.print.printTicket(json.folio, { reprint: false });
      return send(res, 200, { printed: r.ok, error: r.error });
    }
    return send(res, 404, { error: 'Ruta no encontrada' });
  }

  private async pair(body: string, res: http.ServerResponse): Promise<void> {
    const now = Date.now();
    this.pairFailures = this.pairFailures.filter((t) => now - t < 60_000);
    const p = this.pairing;
    if (!p || p.expiresAt <= now) return send(res, 403, { error: 'El código QR venció o ya se usó. Genera uno nuevo en la PC.' });
    if (this.pairFailures.length >= MAX_PAIR_FAILURES) {
      this.clearPairing();
      this.d.onStateChange();
      return send(res, 429, { error: 'Demasiados intentos; el código se canceló.' });
    }
    let j: { deviceId?: unknown; deviceName?: unknown; ts?: unknown; proof?: unknown };
    try {
      j = JSON.parse(body);
    } catch {
      return send(res, 400, { error: 'JSON inválido' });
    }
    const deviceId = typeof j.deviceId === 'string' ? j.deviceId : '';
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(deviceId) || typeof j.ts !== 'number' || typeof j.proof !== 'string') {
      this.pairFailures.push(now);
      return send(res, 400, { error: 'Datos de vinculación inválidos' });
    }
    const v = verifyPairing({ hmac: hmacHex, secret: p.secret, deviceId, ts: j.ts, proof: j.proof, nowMs: now });
    if (!v.ok || !v.deviceKey) {
      this.pairFailures.push(now);
      return send(res, 403, { error: 'Prueba de vinculación incorrecta' });
    }
    const rawName = typeof j.deviceName === 'string' ? j.deviceName : '';
    const name = rawName.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'Teléfono';
    this.d.secrets.addDevice(deviceId, name, v.deviceKey, new Date().toISOString());
    this.clearPairing(); // un solo uso
    this.d.onStateChange();
    send(res, 200, { ok: true });
  }

  private async scan(j: { code?: unknown; mode?: unknown }, device: DeviceInfo, deviceName: string, res: http.ServerResponse): Promise<void> {
    const code = typeof j.code === 'string' ? j.code.trim() : '';
    if (!code || code.length > 200) return send(res, 400, { error: 'Código inválido' });
    if (!this.d.isSessionActive()) return send(res, 409, { error: 'No hay una sesión iniciada en la PC' });
    const hits = await this.d.store.findByCode(code, device.branchId);
    this.d.onScan({ code, deviceName, found: hits.length > 0 });
    send(res, 200, { received: true, found: hits.length > 0, productName: hits[0]?.productName });
  }

  private async replicate(j: { ops?: unknown }, device: DeviceInfo, res: http.ServerResponse): Promise<void> {
    if (!Array.isArray(j.ops) || j.ops.length > 50) return send(res, 400, { error: 'Operaciones inválidas' });
    const accepted: string[] = [];
    for (const raw of j.ops as SyncOp[]) {
      // Solo se aceptan ventas de ESTA sucursal; el resto lo sincroniza el propio teléfono.
      if (!raw || raw.type !== 'sale.create' || raw.branchId !== device.branchId || typeof raw.opId !== 'string') continue;
      try {
        await this.d.store.ingestRemoteSale(raw);
        accepted.push(raw.opId);
      } catch {
        /* venta inválida: no se acepta, el teléfono conserva la suya */
      }
    }
    if (accepted.length > 0) this.d.onReplicated();
    send(res, 200, { accepted });
  }
}
