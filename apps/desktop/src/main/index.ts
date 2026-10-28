/**
 * Proceso principal de Esotérica Amara (escritorio).
 *
 * Arranque: fijar rutas (%APPDATA%\Esoterica Amara) -> instancia única -> abrir SQLite con
 * verificación de integridad y recuperación -> servicios (sincronización, respaldos, impresión,
 * servidor LAN) -> ventana. Funciona SIN internet y SIN servidor: todo lo crítico es local.
 *
 * Modo respaldo por línea de comandos (lo usa la tarea programada de Windows):
 *   "Esoterica Amara.exe" --backup-now
 * Si la app ya está abierta, la segunda instancia le pasa la orden a la primera (la base está
 * abierta allí) y termina; si no, se abre sin ventana, respalda, y sale con código 0 (ok) o 1.
 */
import { BrowserWindow, Menu, Notification, app, dialog, session } from 'electron';
import { join } from 'node:path';
import { configureAppPaths, getPaths } from './paths.ts';
import { ActivationService } from './activation.ts';
import { AuthService } from './auth.ts';
import { BackupService } from './backup.ts';
import type { MainCtx } from './context.ts';
import { DbUnrecoverableError, openDatabase } from './database.ts';
import { appendLog } from './fsutil.ts';
import { registerIpc } from './ipc.ts';
import { LanServer } from './lan-server.ts';
import { PrintService } from './printing.ts';
import { SecretStore } from './secrets.ts';
import { SettingsStore } from './settings.ts';
import { SyncService } from './sync-service.ts';
import type { IpcEventMap } from '../shared/ipc.ts';

// Debe ejecutarse antes de que algo use app.getPath('userData') o el candado de instancia única.
configureAppPaths();

const BACKUP_FLAGS = ['--backup-now', '--backup'];
const wantsBackup = (argv: string[]) => argv.some((a) => BACKUP_FLAGS.includes(a));

let mainWindow: BrowserWindow | null = null;
let ctx: MainCtx | null = null;
let headless = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Esoterica Amara',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  if (process.env['ELECTRON_RENDERER_URL'] && !app.isPackaged) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/** Endurece cualquier ventana: sin navegación ni ventanas nuevas, sin permisos del navegador. */
function hardenSessions(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (e) => e.preventDefault());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  if (app.isPackaged) Menu.setApplicationMenu(null);
}

async function boot(): Promise<void> {
  await app.whenReady();
  hardenSessions();
  const paths = getPaths();
  const settings = new SettingsStore(paths.settingsPath);
  const bootLog = (line: string) => appendLog(join(paths.logsDir, 'arranque.log'), line);

  let opened;
  try {
    opened = await openDatabase({
      dbPath: paths.dbPath,
      backupDirs: [settings.get().backupDir, settings.get().backupSecondaryDir],
      internalBackupDir: paths.internalBackupDir,
      log: bootLog,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    bootLog(`No se pudo abrir la base: ${msg}`);
    dialog.showErrorBox(
      e instanceof DbUnrecoverableError ? 'Base de datos dañada' : 'No se pudo abrir la base de datos',
      `${msg}\n\nLa aplicación se cerrará sin modificar tus datos.`,
    );
    app.exit(1);
    return;
  }
  const store = opened.store;
  if (opened.notice) bootLog(opened.notice);

  const emit: MainCtx['emit'] = <K extends keyof IpcEventMap>(event: K, data: IpcEventMap[K]) => {
    mainWindow?.webContents.send(event, data);
  };
  const secrets = new SecretStore(paths.tokenPath, paths.lanDevicesPath);
  const auth = new AuthService({ store, getApiUrl: () => settings.get().apiUrl, getDevice: () => store.getDeviceInfo() });
  const sync = new SyncService({
    store,
    getApiUrl: () => settings.get().apiUrl,
    getToken: () => secrets.getTerminalToken(),
    emit: (s) => emit('evt:sync', s),
  });
  const backup = new BackupService({
    store,
    dbPath: paths.dbPath,
    logFile: join(paths.logsDir, 'respaldos.log'),
    getSettings: () => settings.get(),
    emit: (s) => emit('evt:backup', s),
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    },
  });

  // ── Modo respaldo sin ventana (tarea programada de Windows) ──
  if (wantsBackup(process.argv)) {
    headless = true;
    const r = await backup.runNow('cli');
    bootLog(`--backup-now: ${r.ok ? 'OK' : `FALLO ${r.error}`}`);
    try {
      opened.raw.close();
    } catch {
      /* ya cerrada */
    }
    app.exit(r.ok ? 0 : 1);
    return;
  }

  const print = new PrintService({ store, getSettings: () => settings.get(), getHostWindow: () => mainWindow });
  const activation = new ActivationService({ store, settings, secrets, afterActivation: async () => void (await sync.runNow()) });
  const lan: LanServer = new LanServer({
    store,
    secrets,
    print,
    getDevice: () => store.getDeviceInfo(),
    isEnabled: () => settings.get().lanEnabled,
    isSessionActive: () => auth.current() !== null,
    onScan: (s) => emit('evt:scan', s),
    onStateChange: () => emit('evt:lan', lan.state()),
    onReplicated: () => sync.syncSoon(),
  });

  ctx = {
    paths, store, settings, secrets, auth, activation, sync, backup, print, lan,
    getWindow: () => mainWindow,
    emit,
    startupNotice: opened.notice,
  };
  registerIpc(ctx);

  mainWindow = createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    sync.start();
    void backup.start();
    void lan.start();
  });

  app.on('before-quit', () => {
    sync.stop();
    backup.stop();
    void lan.stop();
    try {
      opened.raw.close(); // cierra la base y hace checkpoint del WAL
    } catch {
      /* ya cerrada */
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  // Ya hay una instancia: ella recibirá 'second-instance' (y hará el respaldo si se pidió).
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (headless) return;
    if (wantsBackup(argv)) {
      void ctx?.backup.runNow('cli');
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('window-all-closed', () => {
    if (!headless) app.quit();
  });
  void boot();
}
