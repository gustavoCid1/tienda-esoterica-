/** Validación pura de los datos del primer gerente (separada de seed.ts para poder probarla sin base de datos). */

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

export const MIN_SEED_PASSWORD = 10;

export interface SeedManager {
  username: string;
  name: string;
  password: string;
}

/**
 * Lee SEED_MANAGER_* y aborta si la contraseña falta o es corta.
 * Los mensajes de error NUNCA incluyen la contraseña recibida.
 */
export function readSeedManager(env: Record<string, string | undefined>): SeedManager {
  const password = env.SEED_MANAGER_PASSWORD ?? '';
  if (password.trim() === '') {
    throw new SeedError('SEED_MANAGER_PASSWORD está vacía. Define una contraseña de al menos 10 caracteres en apps/api/.env antes de ejecutar el seed.');
  }
  if (password.length < MIN_SEED_PASSWORD) {
    throw new SeedError(`SEED_MANAGER_PASSWORD debe tener al menos ${MIN_SEED_PASSWORD} caracteres.`);
  }
  const username = (env.SEED_MANAGER_USERNAME ?? 'gerente').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new SeedError('SEED_MANAGER_USERNAME debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const name = (env.SEED_MANAGER_NAME ?? 'Gerente').trim();
  if (name.length < 2 || name.length > 80) throw new SeedError('SEED_MANAGER_NAME debe tener de 2 a 80 caracteres.');
  return { username, name, password };
}

/**
 * Sucursales y terminales iniciales. Los códigos forman parte de los folios (AMA-<sucursal><terminal>-...),
 * por eso no cambian una vez en uso.
 */
export const SEED_BRANCHES = [
  { code: 'S1', name: 'Sucursal 1', terminal: { code: 'T1', name: 'Caja Sucursal 1' } },
  { code: 'S2', name: 'Sucursal 2', terminal: { code: 'T2', name: 'Caja Sucursal 2' } },
] as const;
