/** Contenedor de servicios del proceso principal (se arma en index.ts y lo usan los manejadores IPC). */
import type { BrowserWindow } from 'electron';
import type { LocalStore } from '@amara/database';
import type { IpcEventMap } from '../shared/ipc.ts';
import type { ActivationService } from './activation.ts';
import type { AuthService } from './auth.ts';
import type { BackupService } from './backup.ts';
import type { LanServer } from './lan-server.ts';
import type { AppPaths } from './paths.ts';
import type { PrintService } from './printing.ts';
import type { SecretStore } from './secrets.ts';
import type { SettingsStore } from './settings.ts';
import type { SyncService } from './sync-service.ts';

export interface MainCtx {
  paths: AppPaths;
  store: LocalStore;
  settings: SettingsStore;
  secrets: SecretStore;
  auth: AuthService;
  activation: ActivationService;
  sync: SyncService;
  backup: BackupService;
  print: PrintService;
  lan: LanServer;
  getWindow: () => BrowserWindow | null;
  emit: <K extends keyof IpcEventMap>(event: K, data: IpcEventMap[K]) => void;
  /** Aviso de arranque (p. ej. recuperación automática); se entrega una sola vez a la interfaz. */
  startupNotice: string | null;
}
