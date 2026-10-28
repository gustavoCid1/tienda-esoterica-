/**
 * Enlace teléfono ↔ PC por red local (ver @amara/shared lan-auth para el diseño de seguridad).
 * - LanClient: lado teléfono. Firma cada petición con la llave del dispositivo.
 * - verifyLanRequest: lado PC. Valida firma, ventana de tiempo, nonce y revocación.
 */
import { LAN_MAX_SKEW_MS, deriveDeviceKey, pairingProof, safeEqual, signRequest } from '@amara/shared';
import type { HmacHex, PairingPayload, SyncOp } from '@amara/shared';

export interface LanHeaders {
  'x-amara-device': string;
  'x-amara-ts': string;
  'x-amara-nonce': string;
  'x-amara-sig': string;
}

export class NonceCache {
  private seen = new Map<string, number>();
  /** Devuelve false si el nonce ya se usó (repetición de petición). */
  check(deviceId: string, nonce: string, nowMs: number): boolean {
    for (const [k, t] of this.seen) if (nowMs - t > LAN_MAX_SKEW_MS * 2) this.seen.delete(k);
    const key = `${deviceId}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs);
    return true;
  }
}

export type LanVerifyResult = { ok: true } | { ok: false; reason: 'dispositivo_desconocido' | 'firma_invalida' | 'caducada' | 'repetida' };

export function verifyLanRequest(p: {
  hmac: HmacHex;
  /** Llave del dispositivo guardada en la PC, o undefined si no está vinculado / fue revocado. */
  deviceKey: string | undefined;
  headers: Partial<Record<keyof LanHeaders, string>>;
  method: string;
  path: string;
  body: string;
  nonces: NonceCache;
  nowMs: number;
}): LanVerifyResult {
  const device = p.headers['x-amara-device'];
  if (!p.deviceKey || !device) return { ok: false, reason: 'dispositivo_desconocido' };
  const ts = Number(p.headers['x-amara-ts']);
  const nonce = p.headers['x-amara-nonce'] ?? '';
  const sig = p.headers['x-amara-sig'] ?? '';
  if (!Number.isFinite(ts) || Math.abs(p.nowMs - ts) > LAN_MAX_SKEW_MS) return { ok: false, reason: 'caducada' };
  const expected = signRequest(p.hmac, p.deviceKey, ts, nonce, p.method, p.path, p.body);
  if (!safeEqual(expected, sig)) return { ok: false, reason: 'firma_invalida' };
  if (!p.nonces.check(device, nonce, p.nowMs)) return { ok: false, reason: 'repetida' };
  return { ok: true };
}

/** La PC valida la prueba de conocimiento del secreto del QR y deriva la llave del dispositivo. */
export function verifyPairing(p: { hmac: HmacHex; secret: string; deviceId: string; ts: number; proof: string; nowMs: number }): { ok: boolean; deviceKey?: string } {
  if (Math.abs(p.nowMs - p.ts) > LAN_MAX_SKEW_MS) return { ok: false };
  if (!safeEqual(pairingProof(p.hmac, p.secret, p.deviceId, p.ts), p.proof)) return { ok: false };
  return { ok: true, deviceKey: deriveDeviceKey(p.hmac, p.secret, p.deviceId) };
}

export class LanClient {
  private base: string;
  private deviceId: string;
  private deviceKey: string;
  private hmac: HmacHex;
  private fetchImpl: typeof fetch;
  private randomNonce: () => string;
  private nowMs: () => number;

  constructor(o: { host: string; port: number; deviceId: string; deviceKey: string; hmac: HmacHex; fetchImpl?: typeof fetch; randomNonce: () => string; nowMs?: () => number }) {
    this.base = `http://${o.host}:${o.port}`;
    this.deviceId = o.deviceId;
    this.deviceKey = o.deviceKey;
    this.hmac = o.hmac;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.randomNonce = o.randomNonce;
    this.nowMs = o.nowMs ?? (() => Date.now());
  }

  /** Vinculación: demuestra conocer el secreto del QR. La llave se deriva localmente, no viaja. */
  static async pair(o: { payload: PairingPayload; deviceId: string; deviceName: string; hmac: HmacHex; fetchImpl?: typeof fetch; nowMs?: () => number }): Promise<{ deviceKey: string }> {
    const f = o.fetchImpl ?? fetch;
    const ts = (o.nowMs ?? (() => Date.now()))();
    const proof = pairingProof(o.hmac, o.payload.secret, o.deviceId, ts);
    const res = await f(`http://${o.payload.host}:${o.payload.port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: o.deviceId, deviceName: o.deviceName, ts, proof }),
    });
    if (!res.ok) throw new Error('La PC rechazó la vinculación (QR vencido o ya usado)');
    return { deviceKey: deriveDeviceKey(o.hmac, o.payload.secret, o.deviceId) };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const ts = this.nowMs();
    const nonce = this.randomNonce();
    const sig = signRequest(this.hmac, this.deviceKey, ts, nonce, method, path, raw);
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-amara-device': this.deviceId, 'x-amara-ts': String(ts), 'x-amara-nonce': nonce, 'x-amara-sig': sig },
      body: method === 'POST' ? raw : undefined,
    });
    if (!res.ok) throw new Error(`PC respondió ${res.status}`);
    return (await res.json()) as T;
  }

  /** Modo A: enviar una lectura a la PC. Devuelve si la PC encontró el producto. */
  scan(code: string, mode: 'venta' | 'inventario'): Promise<{ received: true; found: boolean; productName?: string }> {
    return this.call('POST', '/scan', { code, mode });
  }

  /** Réplica inmediata de operaciones (ventas) a la PC para reducir ventanas sin información. */
  replicate(ops: SyncOp[]): Promise<{ accepted: string[] }> {
    return this.call('POST', '/replicate', { ops });
  }

  /** Pide a la PC imprimir las dos copias de un folio que ella ya conoce. */
  printTicket(folio: string): Promise<{ printed: boolean; error?: string }> {
    return this.call('POST', '/print', { folio });
  }

  ping(): Promise<{ ok: true; terminal: string }> {
    return this.call('GET', '/ping');
  }
}
