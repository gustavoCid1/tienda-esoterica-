/**
 * Tarea periódica en segundo plano (expo-background-task + expo-task-manager) para revisar existencias y avisar.
 *
 * LÍMITES REALES (se dicen en pantalla y en docs/PENDIENTES-v2-mobile.md):
 *  - Android decide cuándo corre (mínimo ~15 min, ahorro de batería, "Doze"); puede tardar horas o no correr.
 *  - Con la app cerrada del todo no hay aviso en TIEMPO REAL: haría falta un servicio push (FCM/Expo push) sin configurar.
 *  - En Expo Go puede no estar disponible; funciona de forma fiable en un build propio (eas build).
 * Todo va protegido con try/catch: si el sistema no lo permite, la app sigue igual y solo se avisa al abrir/sincronizar.
 *
 * `defineTask` debe ejecutarse al cargar la app (index.ts importa este archivo); registrar la tarea se hace al entrar un gerente.
 */
import { can } from '@amara/shared';
import { defaultApiUrl } from '../config';
import { sessionIsValid, loadSession } from './auth';
import { ApiClient } from './api';
import { notifyNewLowStock, loadLowStock } from './alerts';
import { openStore } from './database';
import { KEYS, secureGet } from './secure';
import { runSync } from './sync';

export const LOW_STOCK_TASK = 'amara-low-stock-check';
/** Minutos entre ejecuciones (Android no baja de ~15). */
export const TASK_INTERVAL_MIN = 15;

type TaskManagerModule = typeof import('expo-task-manager');
type BackgroundTaskModule = typeof import('expo-background-task');

function tm(): TaskManagerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-task-manager') as TaskManagerModule;
  } catch {
    return null;
  }
}
function bt(): BackgroundTaskModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-background-task') as BackgroundTaskModule;
  } catch {
    return null;
  }
}

/** Una pasada de la tarea: sin interfaz. Devuelve true si todo salió bien (aunque no hubiera nada que avisar). */
export async function runBackgroundCheck(): Promise<boolean> {
  const session = await loadSession();
  if (!sessionIsValid(session, Date.now()) || !can(session.user.role, 'estadisticas.ver')) return true; // solo el gerente
  const store = await openStore();
  const device = await store.getDeviceInfo();
  if (!device) return true;

  const apiUrl = ((await secureGet(KEYS.apiUrl)) ?? '').trim() || defaultApiUrl();
  const terminalToken = await secureGet(KEYS.terminalToken);
  const getToken = async () => terminalToken ?? session.token;
  let online = false;
  if (apiUrl) {
    // Primero se envía y se baja (runSyncCycle es seguro de reintentar); si falla, se revisa con lo que ya hay.
    const rep = await runSync({ store, baseUrl: apiUrl, getToken, branchId: device.branchId, terminalId: device.terminalId }).catch(() => null);
    online = !!rep && rep.online;
  }
  const api = apiUrl ? new ApiClient({ getBaseUrl: () => apiUrl, getToken: () => session.token ?? null }) : null;
  const load = await loadLowStock({ api, store, online: online && !!session.token, branchId: device.branchId });
  await notifyNewLowStock(store, session.user.id, device.branchId, load.items);
  return true;
}

/** Declara la tarea. Es seguro llamarla más de una vez. */
export function defineLowStockTask(): void {
  const manager = tm();
  const bg = bt();
  if (!manager || !bg) return;
  try {
    if (manager.isTaskDefined(LOW_STOCK_TASK)) return;
    manager.defineTask(LOW_STOCK_TASK, async () => {
      try {
        await runBackgroundCheck();
        return bg.BackgroundTaskResult.Success;
      } catch {
        return bg.BackgroundTaskResult.Failed;
      }
    });
  } catch {
    /* sin soporte de tareas en este entorno */
  }
}

export type BackgroundState = 'activa' | 'restringida' | 'no_disponible';

/** Registra la tarea periódica. Devuelve 'activa' solo si el sistema la aceptó. */
export async function enableBackgroundAlerts(): Promise<BackgroundState> {
  const bg = bt();
  const manager = tm();
  if (!bg || !manager) return 'no_disponible';
  try {
    defineLowStockTask();
    const status = await bg.getStatusAsync();
    if (status === bg.BackgroundTaskStatus.Restricted) return 'restringida';
    if (!(await manager.isTaskRegisteredAsync(LOW_STOCK_TASK))) await bg.registerTaskAsync(LOW_STOCK_TASK, { minimumInterval: TASK_INTERVAL_MIN });
    return 'activa';
  } catch {
    return 'no_disponible';
  }
}

/** Quita la tarea (al cerrar sesión o si el usuario ya no es gerente). */
export async function disableBackgroundAlerts(): Promise<void> {
  const bg = bt();
  const manager = tm();
  if (!bg || !manager) return;
  try {
    if (await manager.isTaskRegisteredAsync(LOW_STOCK_TASK)) await bg.unregisterTaskAsync(LOW_STOCK_TASK);
  } catch {
    /* ya no estaba */
  }
}

// Al cargar el módulo (arranque, también en ejecución sin interfaz) se declara la tarea.
defineLowStockTask();
