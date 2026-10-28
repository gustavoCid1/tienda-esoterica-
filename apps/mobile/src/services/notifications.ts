/**
 * Notificación LOCAL del teléfono (expo-notifications) para productos en mínimo.
 *
 * HONESTIDAD (también se dice en pantalla): esto NO es una notificación push. Se genera en el propio teléfono cuando
 * la app (a) se abre, (b) sincroniza, o (c) Android ejecuta la tarea periódica en segundo plano (expo-background-task,
 * al menos cada ~15 min y sujeta al ahorro de batería: no es en tiempo real ni está garantizada). Con la app cerrada del
 * todo NO hay aviso en tiempo real: eso exigiría un servicio push (FCM/Expo push) que NO está configurado.
 *
 * El módulo se carga de forma perezosa y con try/catch: si expo-notifications no está disponible (p. ej. Expo Go en
 * Android con limitaciones), la app sigue funcionando y solo se pierde el aviso del sistema.
 */
import { Platform } from 'react-native';
import type { AlertMessage } from '../lib/low-stock';

export const ALERT_CHANNEL_ID = 'existencias-bajas';

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

function mod(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

export type PermissionState = 'concedido' | 'denegado' | 'pendiente' | 'no_disponible';

let configured = false;

/** Prepara el canal (obligatorio en Android antes de pedir permiso en Android 13+) y cómo se muestran los avisos con la app abierta. */
export async function configureNotifications(): Promise<boolean> {
  const N = mod();
  if (!N) return false;
  try {
    if (!configured) {
      N.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
      configured = true;
    }
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
        name: 'Existencias bajas',
        description: 'Avisos de productos que llegaron a su mínimo',
        importance: N.AndroidImportance.HIGH,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function permissionState(): Promise<PermissionState> {
  const N = mod();
  if (!N) return 'no_disponible';
  try {
    const p = await N.getPermissionsAsync();
    if (p.granted) return 'concedido';
    return p.canAskAgain ? 'pendiente' : 'denegado';
  } catch {
    return 'no_disponible';
  }
}

/** Pide el permiso (en Android 13+ aparece el cuadro del sistema). Devuelve el estado resultante. */
export async function requestPermission(): Promise<PermissionState> {
  const N = mod();
  if (!N) return 'no_disponible';
  try {
    await configureNotifications(); // el canal debe existir antes de pedir el permiso
    const p = await N.requestPermissionsAsync();
    if (p.granted) return 'concedido';
    return p.canAskAgain ? 'pendiente' : 'denegado';
  } catch {
    return 'no_disponible';
  }
}

/**
 * Muestra la notificación ya. Devuelve true si el sistema la aceptó. NO pide permiso por su cuenta
 * (la pantalla de Notificaciones lo pide con un botón); sin permiso devuelve false para no marcar la alerta como avisada.
 */
export async function showAlert(msg: AlertMessage): Promise<boolean> {
  const N = mod();
  if (!N) return false;
  try {
    if ((await permissionState()) !== 'concedido') return false;
    await configureNotifications();
    await N.scheduleNotificationAsync({
      content: { title: msg.title, body: msg.body, data: { screen: 'notifications' } },
      trigger: Platform.OS === 'android' ? ({ channelId: ALERT_CHANNEL_ID } as import('expo-notifications').NotificationTriggerInput) : null,
    });
    return true;
  } catch {
    return false;
  }
}
