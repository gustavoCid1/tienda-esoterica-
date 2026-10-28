/**
 * Tokens de seguridad (v2): funciones PURAS y sin dependencias externas, para que API, escritorio y móvil
 * decidan igual si un código autoriza una acción (cerrar caja, devolver, cancelar, Limpias).
 *
 * Diseño:
 *  - El código tiene entre 4 y 10 caracteres (por omisión 8) de un alfabeto sin ambiguos (sin 0/O, 1/I).
 *  - El servidor lo muestra UNA sola vez al crearlo; solo guarda `salt` + `hash` = sha256("salt:CODIGO").
 *  - Los dispositivos reciben en el `pull` los hashes (nunca el código) y pueden validar SIN conexión.
 *  - Vigencia: creado ≤ ahora < expira, no revocado antes de ahora, mismo propósito y sucursal,
 *    usuario permitido y (si hay máximo) usos restantes.
 *
 * SHA-256 se implementa aquí mismo (no usa node:crypto ni @noble) para funcionar idéntico en Node,
 * Electron y Hermes (React Native).
 */
import type { CachedSecurityToken, SecurityToken, TokenPurpose } from './types.ts';
import { TOKEN_PURPOSES } from './types.ts';
import { safeEqual } from './lan-auth.ts';

/** Alfabeto sin caracteres ambiguos (sin 0, O, 1, I). 32 símbolos: 5 bits por carácter, sin sesgo. */
export const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TOKEN_CODE_DEFAULT_LENGTH = 8;
export const TOKEN_CODE_MIN_LENGTH = 4;
/** Máximo de caracteres del código (contrato v2). */
export const TOKEN_CODE_MAX_LENGTH = 10;
export const TOKEN_MIN_MINUTES = 1;
export const TOKEN_MAX_MINUTES = 7 * 24 * 60;
/** Tolerancia de reloj al comprobar el inicio de vigencia en un dispositivo sin conexión. */
export const TOKEN_CLOCK_SKEW_MS = 5 * 60_000;

// ───────────────────────────── SHA-256 (puro) ─────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Codifica texto en UTF-8 sin depender de TextEncoder (disponible, pero así no hay sorpresas en Hermes). */
function utf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** SHA-256 de un texto UTF-8; devuelve 64 caracteres hexadecimales en minúsculas. */
export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

// ───────────────────────────── Códigos y hashes ─────────────────────────────

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // Último recurso (no criptográfico). En Node 22, Electron y Expo siempre existe crypto.getRandomValues.
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Longitud válida del código: entero entre 4 y 10 (se ajusta, nunca excede 10). */
export function clampTokenCodeLength(len: number): number {
  if (!Number.isFinite(len)) return TOKEN_CODE_DEFAULT_LENGTH;
  return Math.min(TOKEN_CODE_MAX_LENGTH, Math.max(TOKEN_CODE_MIN_LENGTH, Math.floor(len)));
}

/** Código aleatorio de `len` caracteres (por omisión 8, máximo 10) del alfabeto sin ambiguos. */
export function generateTokenCode(len: number = TOKEN_CODE_DEFAULT_LENGTH): string {
  const n = clampTokenCodeLength(len);
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += TOKEN_ALPHABET[bytes[i]! & 31]; // 32 símbolos: & 31 no introduce sesgo
  return out;
}

/** Sal aleatoria de 16 bytes en hexadecimal. */
export function generateTokenSalt(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mayúsculas y sin espacios ni guiones (el ticket puede mostrar "ABCD-EFGH"). */
export function normalizeTokenCode(code: string): string {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/** sha256 hexadecimal de `salt:CODIGO` (el código se normaliza a mayúsculas sin espacios ni guiones). */
export function hashTokenCode(code: string, salt: string): string {
  return sha256Hex(`${salt}:${normalizeTokenCode(code)}`);
}

// ───────────────────────────── Vigencia ─────────────────────────────

export type TokenStatus = 'vigente' | 'vencido' | 'revocado' | 'agotado' | 'pendiente';

type TokenTimes = Pick<SecurityToken, 'createdAt' | 'expiresAt' | 'revokedAt' | 'maxUses' | 'usedCount'>;

/** Estado del token en el instante `atIso` (para listas y mensajes). */
export function tokenStatus(token: TokenTimes, atIso: string): TokenStatus {
  if (token.revokedAt && token.revokedAt <= atIso) return 'revocado';
  if (atIso >= token.expiresAt) return 'vencido';
  if (Date.parse(atIso) < Date.parse(token.createdAt) - TOKEN_CLOCK_SKEW_MS) return 'pendiente';
  if (token.maxUses !== null && token.usedCount >= token.maxUses) return 'agotado';
  return 'vigente';
}

/**
 * ¿Autoriza este token la acción `purpose` en `branchId` a la hora `atIso` (hora de la operación;
 * sin conexión, la hora local del dispositivo)?
 */
export function isTokenActive(
  token: Pick<SecurityToken, 'purposes' | 'branchId' | 'forUserId' | 'createdAt' | 'expiresAt' | 'revokedAt' | 'maxUses' | 'usedCount'>,
  purpose: TokenPurpose,
  branchId: string,
  atIso: string,
  userId?: string,
): boolean {
  return whyTokenInactive(token, purpose, branchId, atIso, userId) === null;
}

export type TokenDenyReason = 'proposito' | 'sucursal' | 'usuario' | 'vencido' | 'revocado' | 'agotado' | 'pendiente';

/** null = el token es válido para esa acción; si no, el primer motivo por el que no sirve. */
export function whyTokenInactive(
  token: Parameters<typeof isTokenActive>[0],
  purpose: TokenPurpose,
  branchId: string,
  atIso: string,
  userId?: string,
): TokenDenyReason | null {
  const st = tokenStatus(token, atIso);
  if (st !== 'vigente') return st;
  if (!token.purposes.includes(purpose)) return 'proposito';
  if (token.branchId !== null && token.branchId !== branchId) return 'sucursal';
  if (token.forUserId !== null && token.forUserId !== userId) return 'usuario';
  return null;
}

export type TokenVerifyResult =
  | { ok: true; token: CachedSecurityToken }
  | { ok: false; reason: 'codigo_vacio' | 'no_coincide' | TokenDenyReason };

/**
 * Verificación SIN conexión: compara el hash del código contra la caché de tokens del dispositivo.
 * Si ningún token coincide, 'no_coincide'. Si coincide pero no sirve para esta acción, devuelve el motivo.
 * Si hay varios tokens con el mismo código (improbable), gana el primero que sí sirve.
 */
export function verifyTokenCodeLocal(
  code: string,
  cachedTokens: CachedSecurityToken[],
  purpose: TokenPurpose,
  branchId: string,
  atIso: string,
  userId?: string,
): TokenVerifyResult {
  const clean = normalizeTokenCode(code);
  if (clean.length === 0) return { ok: false, reason: 'codigo_vacio' };
  let firstReason: TokenDenyReason | null = null;
  for (const t of cachedTokens) {
    if (!safeEqual(hashTokenCode(clean, t.salt), t.hash)) continue;
    const why = whyTokenInactive(t, purpose, branchId, atIso, userId);
    if (why === null) return { ok: true, token: t };
    firstReason ??= why;
  }
  return { ok: false, reason: firstReason ?? 'no_coincide' };
}

/** Texto en español para mostrar al operador. */
export function tokenDenyMessage(reason: 'codigo_vacio' | 'no_coincide' | TokenDenyReason): string {
  switch (reason) {
    case 'codigo_vacio': return 'Escribe el código del token';
    case 'no_coincide': return 'Código incorrecto';
    case 'proposito': return 'Este token no sirve para esta acción';
    case 'sucursal': return 'Este token es de otra sucursal';
    case 'usuario': return 'Este token es para otro usuario';
    case 'vencido': return 'El token ya venció';
    case 'revocado': return 'El token fue revocado';
    case 'agotado': return 'El token ya alcanzó su máximo de usos';
    case 'pendiente': return 'El token aún no está vigente (revisa la hora del dispositivo)';
  }
}

/** Vencimiento a partir de una duración en minutos (1 min a 7 días). */
export function tokenExpiresAt(createdAtIso: string, durationMinutes: number): string {
  if (!Number.isFinite(durationMinutes) || durationMinutes < TOKEN_MIN_MINUTES || durationMinutes > TOKEN_MAX_MINUTES) {
    throw new RangeError(`La duración debe estar entre ${TOKEN_MIN_MINUTES} minuto y 7 días`);
  }
  return new Date(Date.parse(createdAtIso) + Math.round(durationMinutes) * 60_000).toISOString();
}

export function isTokenPurpose(v: unknown): v is TokenPurpose {
  return typeof v === 'string' && (TOKEN_PURPOSES as readonly string[]).includes(v);
}

/** Quita el material secreto (sal y hash) de un token: forma pública para listas. */
export function publicToken(t: CachedSecurityToken): SecurityToken {
  const { salt: _s, hash: _h, ...rest } = t;
  return rest;
}
