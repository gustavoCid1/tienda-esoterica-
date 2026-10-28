/**
 * Secretos y credenciales SOLO en expo-secure-store (Keystore de Android).
 * Nada de esto va a la base SQLite, a logs ni a AsyncStorage.
 * Claves permitidas por SecureStore: letras, números, ".", "-" y "_".
 */
import * as SecureStore from 'expo-secure-store';

export const KEYS = {
  session: 'amara.session',
  apiUrl: 'amara.api_url',
  terminal: 'amara.terminal',
  terminalToken: 'amara.terminal_token',
  lanLink: 'amara.lan_link',
  deviceId: 'amara.device_id',
} as const;

/** Lectura tolerante: si el almacén falla, se trata como "no hay valor". */
export async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/** Escritura estricta: si no se pudo guardar un secreto, el llamador debe enterarse. */
export async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ya no existía */
  }
}

export async function secureGetJson<T>(key: string): Promise<T | null> {
  const raw = await secureGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function secureSetJson(key: string, value: unknown): Promise<void> {
  await secureSet(key, JSON.stringify(value));
}
