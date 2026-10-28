/**
 * Polyfills mínimos para Hermes (React Native).
 *
 * Hermes no trae `crypto`. Lo necesitan:
 *  - @noble/hashes (scrypt/HMAC) -> `crypto.getRandomValues` para sal aleatoria.
 *  - newId() de @amara/shared      -> `crypto.randomUUID` o `getRandomValues` (UUID v4 de ventas y movimientos).
 * Se usa expo-crypto, que obtiene los bytes del generador seguro del sistema operativo.
 * Si no hubiera ninguna fuente segura, es MEJOR fallar que usar Math.random para sales o UUID.
 */
import * as ExpoCrypto from 'expo-crypto';

const g = globalThis as unknown as { crypto?: Record<string, unknown> };

if (!g.crypto) g.crypto = {};
const c = g.crypto;

if (typeof c.getRandomValues !== 'function') {
  c.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (array) ExpoCrypto.getRandomValues(array as unknown as Uint8Array);
    return array;
  };
}
if (typeof c.randomUUID !== 'function') {
  c.randomUUID = () => ExpoCrypto.randomUUID();
}
