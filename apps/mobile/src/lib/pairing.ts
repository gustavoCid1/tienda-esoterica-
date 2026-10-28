/**
 * Validación del QR de vinculación con la PC. Lógica pura.
 * Además de decodificarlo, se exige que apunte a una dirección de RED LOCAL: un QR malicioso
 * no debe poder hacer que el teléfono envíe su prueba de vinculación a un servidor en internet.
 */
import { decodePairingPayload } from '@amara/shared';
import type { PairingPayload } from '@amara/shared';

export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false; // nombres públicos o IPv6: no se aceptan
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127;
}

export type PairingCheck = { ok: true; payload: PairingPayload } | { ok: false; error: string };

export function evaluatePairingPayload(text: string, nowMs: number): PairingCheck {
  const payload = decodePairingPayload(text);
  if (!payload) return { ok: false, error: 'Este código QR no es de vinculación de Esotérica Amara.' };
  const exp = Date.parse(payload.expiresAt);
  if (!Number.isFinite(exp)) return { ok: false, error: 'El código de vinculación no trae una caducidad válida.' };
  if (nowMs >= exp) return { ok: false, error: 'El código de vinculación ya caducó. Genera uno nuevo en la PC.' };
  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) return { ok: false, error: 'El código de vinculación trae un puerto inválido.' };
  if (!isPrivateHost(payload.host)) return { ok: false, error: 'El código apunta a una dirección que no es de red local; por seguridad no se vinculó.' };
  return { ok: true, payload };
}
