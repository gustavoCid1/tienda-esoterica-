/**
 * Autenticación del enlace teléfono ↔ PC en red local (sin internet).
 *
 * Diseño:
 *  1. La PC genera un secreto de un solo uso (32 bytes aleatorios) con caducidad
 *     y lo muestra SOLO como código QR en pantalla (canal visual; no viaja por la red).
 *  2. El teléfono lo escanea y demuestra conocerlo con HMAC(secreto, deviceId|ts).
 *  3. Ambos derivan la llave del dispositivo = HMAC(secreto, "dev|" + deviceId).
 *     La llave jamás se transmite. La PC la guarda; el teléfono la guarda en SecureStore.
 *  4. Cada petición lleva firma HMAC(llave, ts|método|ruta|cuerpo) y marca de tiempo;
 *     la PC rechaza firmas viejas (>60 s), repetidas (nonce) y dispositivos revocados.
 * El HTTP en LAN va sin TLS: el contenido es visible en la red, pero nadie puede
 * FALSIFICAR lecturas ni órdenes sin la llave. No envíes aquí datos secretos.
 *
 * `hmacHex` se inyecta (node:crypto en PC, @noble/hashes en móvil) para que este
 * módulo sea puro y verificable con pruebas.
 */
export type HmacHex = (key: string, message: string) => string;

export interface PairingPayload {
  v: 1;
  /** IP o nombre de la PC en la LAN. */
  host: string;
  port: number;
  /** Secreto de un solo uso (base64url/hex). */
  secret: string;
  /** Caducidad del QR (ISO). */
  expiresAt: string;
  terminalId: string;
}

export function encodePairingPayload(p: PairingPayload): string {
  return `amara-pair:${JSON.stringify(p)}`;
}

export function decodePairingPayload(text: string): PairingPayload | null {
  if (!text.startsWith('amara-pair:')) return null;
  try {
    const p = JSON.parse(text.slice('amara-pair:'.length));
    if (p && p.v === 1 && typeof p.host === 'string' && typeof p.port === 'number' && typeof p.secret === 'string') {
      return p as PairingPayload;
    }
  } catch {
    /* QR no válido */
  }
  return null;
}

export function pairingProof(hmac: HmacHex, secret: string, deviceId: string, ts: number): string {
  return hmac(secret, `pair|${deviceId}|${ts}`);
}

export function deriveDeviceKey(hmac: HmacHex, secret: string, deviceId: string): string {
  return hmac(secret, `dev|${deviceId}`);
}

export function signRequest(
  hmac: HmacHex,
  deviceKey: string,
  ts: number,
  nonce: string,
  method: string,
  path: string,
  body: string,
): string {
  return hmac(deviceKey, `${ts}|${nonce}|${method.toUpperCase()}|${path}|${body}`);
}

/** Comparación en tiempo constante de cadenas hex. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const LAN_MAX_SKEW_MS = 60_000;
export const LAN_PORT = 47880;
