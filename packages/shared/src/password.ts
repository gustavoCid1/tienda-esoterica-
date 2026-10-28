/**
 * Hash de contraseñas con scrypt (@noble/hashes, JavaScript puro: funciona igual
 * en Node/API, Electron y React Native). Formato almacenado:
 *   scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 * La API guarda este hash. Los clientes (PC/teléfono) guardan un verificador
 * propio derivado tras un inicio de sesión EN LÍNEA, para poder entrar sin internet;
 * nunca se guarda la contraseña ni se sincronizan los hashes del servidor.
 *
 * NOTA: este archivo depende de @noble/hashes y no se ejecuta en las pruebas
 * del entorno de generación (sin acceso a npm); ver docs/PRUEBAS.md.
 */
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

const N = 2 ** 15; // 32768: ~64 MB, equilibrio seguridad/velocidad en el teléfono
const R = 8;
const P = 1;
const DKLEN = 32;

function derive(password: string, salt: Uint8Array, n: number, r: number, p: number): Uint8Array {
  return scrypt(new TextEncoder().encode(password.normalize('NFKC')), salt, { N: n, r, p, dkLen: DKLEN, maxmem: 128 * n * r + 1024 * 1024 });
}

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  const salt = randomBytes(16);
  const hash = derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts as [string, string, string, string, string, string];
  const expected = hexToBytes(hashHex);
  const actual = derive(password, hexToBytes(saltHex), Number(n), Number(r), Number(p));
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ actual[i]!;
  return diff === 0;
}
