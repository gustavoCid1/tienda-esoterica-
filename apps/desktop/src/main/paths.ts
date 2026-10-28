/**
 * Rutas de la aplicación. Los DATOS viven FUERA de la carpeta de instalación:
 *
 *   %APPDATA%\Esoterica Amara\
 *     amara.sqlite            base de datos (WAL: amara.sqlite-wal / amara.sqlite-shm)
 *     config.json             ajustes (impresora, respaldos, URL de la API...)
 *     terminal-token.bin      token de la terminal (cifrado con DPAPI de Windows vía safeStorage)
 *     lan-devices.json        teléfonos vinculados (llaves cifradas con safeStorage)
 *     etiquetas.json          historial de lotes de etiquetas
 *     respaldos-internos\     copias previas a migrar la base
 *     logs\                   registros de respaldo/arranque
 *
 * En Windows %APPDATA% es C:\Users\<usuario>\AppData\Roaming. Desinstalar o actualizar la app
 * NO toca esta carpeta.
 */
import { app } from 'electron';
import { join } from 'node:path';

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  settingsPath: string;
  tokenPath: string;
  lanDevicesPath: string;
  labelHistoryPath: string;
  internalBackupDir: string;
  logsDir: string;
}

/** DEBE llamarse antes de `app.whenReady()`: fija el nombre y la carpeta de datos. */
export function configureAppPaths(): void {
  app.setName('Esoterica Amara');
  app.setPath('userData', join(app.getPath('appData'), 'Esoterica Amara'));
}

export function getPaths(): AppPaths {
  const dataDir = app.getPath('userData');
  return {
    dataDir,
    dbPath: join(dataDir, 'amara.sqlite'),
    settingsPath: join(dataDir, 'config.json'),
    tokenPath: join(dataDir, 'terminal-token.bin'),
    lanDevicesPath: join(dataDir, 'lan-devices.json'),
    labelHistoryPath: join(dataDir, 'etiquetas.json'),
    internalBackupDir: join(dataDir, 'respaldos-internos'),
    logsDir: join(dataDir, 'logs'),
  };
}

/** Logo reducido para el ticket (misma proporción que el original; ver electron-builder.yml). */
export function logoTicketPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'logo-ticket.png') : join(app.getAppPath(), 'assets', 'logo-ticket.png');
}
