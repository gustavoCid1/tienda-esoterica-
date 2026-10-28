/**
 * Enlace con la PC por red local (protocolo en @amara/shared lan-auth y @amara/sync LanClient).
 * La llave del dispositivo (derivada del secreto del QR, jamás transmitida) vive en SecureStore.
 * El enlace va en HTTP sin cifrar: nadie puede falsificar órdenes sin la llave, pero el tráfico es
 * visible en la red (no usar en Wi-Fi público).
 */
import { LanClient } from '@amara/sync';
import type { LocalStore } from '@amara/database';
import { newId } from '@amara/shared';
import type { PairingPayload } from '@amara/shared';
import { hmacHex } from './hmac';
import { KEYS, secureDelete, secureGet, secureGetJson, secureSet, secureSetJson } from './secure';

export interface LanLink {
  host: string;
  port: number;
  deviceId: string;
  deviceKey: string;
  terminalId: string;
  linkedAt: string;
}

const LAN_TIMEOUT_MS = 8_000;

/** fetch con tiempo límite: en la red local una PC apagada no debe dejar la pantalla colgada. */
const lanFetch = ((url: RequestInfo | URL, init?: RequestInit) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LAN_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}) as typeof fetch;

/** Identificador estable de este teléfono ante la PC. */
export async function getDeviceId(): Promise<string> {
  const existing = await secureGet(KEYS.deviceId);
  if (existing) return existing;
  const id = newId();
  await secureSet(KEYS.deviceId, id);
  return id;
}

export async function loadLink(): Promise<LanLink | null> {
  const l = await secureGetJson<LanLink>(KEYS.lanLink);
  return l && l.host && l.deviceKey && l.deviceId ? l : null;
}

export async function clearLink(): Promise<void> {
  await secureDelete(KEYS.lanLink);
}

export function clientFromLink(link: LanLink): LanClient {
  return new LanClient({
    host: link.host,
    port: link.port,
    deviceId: link.deviceId,
    deviceKey: link.deviceKey,
    hmac: hmacHex,
    fetchImpl: lanFetch,
    randomNonce: () => newId(),
  });
}

/** Vincula con la PC usando el contenido del QR ya validado (evaluatePairingPayload). */
export async function pairWithPc(payload: PairingPayload, deviceName: string): Promise<LanLink> {
  const deviceId = await getDeviceId();
  const { deviceKey } = await LanClient.pair({ payload, deviceId, deviceName, hmac: hmacHex, fetchImpl: lanFetch });
  const link: LanLink = { host: payload.host, port: payload.port, deviceId, deviceKey, terminalId: payload.terminalId, linkedAt: new Date().toISOString() };
  await secureSetJson(KEYS.lanLink, link);
  return link;
}

/** Mensaje comprensible para errores del enlace. */
export function lanErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(m)) return 'La PC no respondió a tiempo. Verifica que esté encendida, con Amara abierto y en la misma red Wi-Fi.';
  if (/401|403/.test(m)) return 'La PC rechazó la petición. Revisa que la hora de ambos equipos coincida (máx. 1 min de diferencia) o vuelve a vincular.';
  if (/Network request failed|Failed to fetch/i.test(m)) return 'No se pudo conectar con la PC. Verifica el Wi-Fi y que estén en la misma red.';
  return m;
}

/**
 * Réplica inmediata de una venta a la PC vinculada (reduce la ventana en que la PC no sabe de ella).
 * Es OPCIONAL y de mejor esfuerzo: la venta ya está guardada y se sincroniza con el servidor igual.
 * Devuelve true si la PC la aceptó.
 */
export async function replicateSaleToPc(store: LocalStore, saleId: string): Promise<boolean> {
  try {
    const link = await loadLink();
    if (!link) return false;
    const ops = (await store.nextPending(1000)).filter((o) => o.type === 'sale.create' && (o.payload as { sale?: { id?: string } } | null)?.sale?.id === saleId);
    if (ops.length === 0) return false;
    const r = await clientFromLink(link).replicate(ops);
    return r.accepted.length > 0;
  } catch {
    return false;
  }
}
