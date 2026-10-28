import Constants from 'expo-constants';

/**
 * URL de la API central. Orden: variable EXPO_PUBLIC_API_URL (se incrusta al compilar con EAS)
 * -> app.json extra.apiUrl -> vacía (el usuario la escribe en "Servidor" en el inicio de sesión).
 */
export function defaultApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && !fromEnv.includes('CAMBIAR')) return fromEnv.replace(/\/+$/, '');
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
  return (extra.apiUrl ?? '').replace(/\/+$/, '');
}

/** Cada cuánto se intenta sincronizar mientras la app está abierta y hay red. */
export const SYNC_INTERVAL_MS = 3 * 60_000;
/** Mínimo entre sincronizaciones automáticas (evita ráfagas al abrir/volver/reconectar). */
export const SYNC_MIN_GAP_MS = 20_000;
/** Refresco automático moderado del resumen del gerente mientras la pantalla está visible. */
export const SUMMARY_AUTO_REFRESH_MS = 60_000;
/** El inicio de sesión SIN conexión caduca si el verificador es más viejo que esto. */
export const OFFLINE_LOGIN_MAX_DAYS = 30;
/** Una sesión iniciada sin conexión (sin token del servidor) dura como máximo esto. */
export const OFFLINE_SESSION_HOURS = 12;
