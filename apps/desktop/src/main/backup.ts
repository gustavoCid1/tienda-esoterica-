/**
 * Respaldos de la base SQLite.
 *
 *  - Cada `backupIntervalMin` (2 horas por omisión) y al abrir la app si ya pasó ese tiempo
 *    (cubre respaldos omitidos con la PC apagada). También al hacer el corte de caja y a pedido.
 *  - Copia CONSISTENTE con VACUUM INTO (LocalStore.backupInto) a un archivo ".partial"; se
 *    VERIFICA abriendo la copia (integrity_check + tablas clave) y solo entonces se renombra al
 *    nombre final amara_AAAA-MM-DD_HH-MM-SS.sqlite. Un respaldo sin verificar no existe.
 *  - Antes se revisa que la carpeta sea escribible y que haya espacio libre (>= 2x la base + 20 MB).
 *  - Rotación: política keepRecent / keepDaily / keepMonthly (src/shared/backup-rotation.ts).
 *  - Segundo destino opcional (USB / carpeta externa): se copia el MISMO archivo ya verificado,
 *    se verifica de nuevo y se rota allí también. Si el USB no está, se avisa (no se ignora).
 *  - Todo intento queda en backups_log (logBackup) y los fallos dejan un aviso persistente.
 */
import { constants as fsConstants, promises as fsp, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalStore } from '@amara/database';
import { backupFileName, selectBackupsToDelete } from '../shared/backup-rotation.ts';
import type { AppSettings } from '../shared/settings.ts';
import type { BackupResult, BackupState } from '../shared/ipc.ts';
import { verifyDbFile } from './db-verify.ts';
import { appendLog } from './fsutil.ts';

export type BackupKind = 'auto' | 'manual' | 'cierre' | 'cli';

const MIN_FREE_EXTRA = 20 * 1024 * 1024;

export interface BackupDeps {
  store: LocalStore;
  dbPath: string;
  logFile: string;
  getSettings: () => AppSettings;
  emit: (s: BackupState) => void;
  /** Notificación del sistema (opcional). */
  notify?: (title: string, body: string) => void;
}

export class BackupService {
  state: BackupState = { running: false, lastResult: null, warning: null, lastOkAt: null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAttemptMs = 0;
  private lastSuccessMs = 0;

  constructor(private d: BackupDeps) {}

  async start(): Promise<void> {
    // Último respaldo exitoso de cualquier tipo (para saber si hay uno "omitido").
    let latest = 0;
    for (const k of ['auto', 'manual', 'cierre', 'cli']) {
      const v = await this.d.store.getMeta(`last_backup_${k}_at`);
      if (v) latest = Math.max(latest, Date.parse(v) || 0);
    }
    this.lastSuccessMs = latest;
    if (latest) this.state.lastOkAt = new Date(latest).toISOString();
    this.d.emit(this.state);
    // Primer intento 30 s después de abrir; luego se revisa cada minuto si ya toca.
    setTimeout(() => void this.tick(), 30_000);
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.state.running) return;
    const now = Date.now();
    const intervalMs = this.d.getSettings().backupIntervalMin * 60_000;
    const due = now - this.lastSuccessMs >= intervalMs;
    // Si el último intento falló se reintenta cada 10 min como máximo (no se martilla el disco).
    const retryOk = now - this.lastAttemptMs >= Math.min(intervalMs, 10 * 60_000);
    if (due && retryOk) await this.runNow('auto');
  }

  async runNow(kind: BackupKind): Promise<BackupResult> {
    if (this.state.running) {
      return { ok: false, at: new Date().toISOString(), kind, verified: false, error: 'Ya hay un respaldo en curso.' };
    }
    this.state = { ...this.state, running: true };
    this.d.emit(this.state);
    this.lastAttemptMs = Date.now();
    let result: BackupResult;
    try {
      result = await this.doBackup(kind);
    } catch (e) {
      result = { ok: false, at: new Date().toISOString(), kind, verified: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (result.ok) {
      this.lastSuccessMs = Date.parse(result.at);
    }
    let warning: string | null = null;
    if (!result.ok) {
      warning = `El respaldo falló: ${result.error ?? 'error desconocido'}. Revisa la carpeta de respaldos en Ajustes.`;
    } else if (result.secondary?.configured && !result.secondary.ok) {
      warning = `El respaldo principal está bien, pero la copia al segundo destino falló: ${result.secondary.error ?? 'error desconocido'}. ¿Está conectado el USB?`;
    }
    this.state = {
      running: false,
      lastResult: result,
      warning,
      lastOkAt: result.ok ? result.at : this.state.lastOkAt,
    };
    appendLog(this.d.logFile, `${kind} ${result.ok ? 'OK' : 'FALLO'} ${result.path ?? ''} ${result.error ?? ''} ${result.secondary ? `| 2o destino: ${result.secondary.ok ? 'OK' : `FALLO ${result.secondary.error ?? ''}`}` : ''}`);
    if (warning) this.d.notify?.('Esoterica Amara: aviso de respaldo', warning);
    this.d.emit(this.state);
    return result;
  }

  // ───────────────────────────── implementación ─────────────────────────────

  private async doBackup(kind: BackupKind): Promise<BackupResult> {
    const s = this.d.getSettings();
    let at = new Date();
    const fail = async (error: string, path?: string): Promise<BackupResult> => {
      await this.safeLog({ kind, path, ok: false, error });
      return { ok: false, at: at.toISOString(), kind, path, verified: false, error };
    };

    const dir = s.backupDir;
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fsConstants.W_OK);
    } catch (e) {
      return fail(`No se pudo usar la carpeta de respaldo "${dir}" (${e instanceof Error ? e.message : String(e)}).`);
    }

    const need = (await this.dbBytes()) * 2 + MIN_FREE_EXTRA;
    const free = await freeBytes(dir);
    if (free !== null && free < need) {
      return fail(`No hay espacio suficiente en "${dir}": libre ${mb(free)} MB, se necesitan al menos ${mb(need)} MB.`);
    }

    // Nombre libre (resolución de 1 s): si ya existe, se avanza un segundo en vez de sobrescribir.
    let name = backupFileName(at);
    for (let i = 0; i < 10 && existsSync(join(dir, name)); i++) {
      at = new Date(at.getTime() + 1000);
      name = backupFileName(at);
    }
    const finalPath = join(dir, name);
    const partial = `${finalPath}.partial`;
    try {
      await fsp.rm(partial, { force: true });
      await this.d.store.backupInto(partial);
    } catch (e) {
      await fsp.rm(partial, { force: true }).catch(() => undefined);
      return fail(`No se pudo crear la copia: ${e instanceof Error ? e.message : String(e)}`);
    }
    const v = verifyDbFile(partial);
    if (!v.ok) {
      await fsp.rm(partial, { force: true }).catch(() => undefined);
      return fail(`La copia no pasó la verificación (${v.reason ?? 'sin detalle'}) y se descartó.`);
    }
    await fsp.rename(partial, finalPath);
    const size = (await fsp.stat(finalPath)).size;
    await this.safeLog({ kind, path: finalPath, ok: true, sizeBytes: size, verified: true });
    await this.rotate(dir);

    const result: BackupResult = { ok: true, at: at.toISOString(), kind, path: finalPath, verified: true };

    // Segundo destino.
    const sec = s.backupSecondaryDir.trim();
    if (sec) {
      const second = await this.copySecond(finalPath, name, size, sec);
      result.secondary = { configured: true, ...second };
      await this.safeLog(
        second.ok
          ? { kind: 'segundo_destino', path: second.path, ok: true, sizeBytes: size, verified: true }
          : { kind: 'segundo_destino', path: sec, ok: false, error: second.error },
      );
    } else {
      result.secondary = { configured: false, ok: true };
    }
    return result;
  }

  private async copySecond(src: string, name: string, size: number, dir: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fsConstants.W_OK);
    } catch (e) {
      return { ok: false, error: `No se pudo abrir "${dir}" (${e instanceof Error ? e.message : String(e)}).` };
    }
    const free = await freeBytes(dir);
    if (free !== null && free < size * 1.2 + MIN_FREE_EXTRA) {
      return { ok: false, error: `No hay espacio en "${dir}": libre ${mb(free)} MB.` };
    }
    const dest = join(dir, name);
    const partial = `${dest}.partial`;
    try {
      await fsp.rm(partial, { force: true });
      await fsp.copyFile(src, partial);
      const v = verifyDbFile(partial);
      if (!v.ok) {
        await fsp.rm(partial, { force: true }).catch(() => undefined);
        return { ok: false, error: `La copia en el segundo destino no pasó la verificación (${v.reason ?? 'sin detalle'}).` };
      }
      await fsp.rename(partial, dest);
      await this.rotate(dir);
      return { ok: true, path: dest };
    } catch (e) {
      await fsp.rm(partial, { force: true }).catch(() => undefined);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Aplica la política de retención en una carpeta y limpia ".partial" viejos. */
  private async rotate(dir: string): Promise<void> {
    try {
      const names = await fsp.readdir(dir);
      for (const n of selectBackupsToDelete(names, this.d.getSettings().retention)) {
        await fsp.rm(join(dir, n), { force: true }).catch(() => undefined);
      }
      for (const n of names.filter((x) => x.endsWith('.partial'))) {
        const st = await fsp.stat(join(dir, n)).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 3_600_000) await fsp.rm(join(dir, n), { force: true }).catch(() => undefined);
      }
    } catch {
      /* la rotación es de mejor esfuerzo: nunca invalida un respaldo ya hecho */
    }
  }

  private async dbBytes(): Promise<number> {
    let total = 0;
    for (const suffix of ['', '-wal']) {
      try {
        total += (await fsp.stat(`${this.d.dbPath}${suffix}`)).size;
      } catch {
        /* sin WAL */
      }
    }
    return total;
  }

  private async safeLog(e: Parameters<LocalStore['logBackup']>[0]): Promise<void> {
    try {
      await this.d.store.logBackup(e);
    } catch {
      /* si la propia base falla, el archivo de registro ya lo documenta */
    }
  }
}

const mb = (n: number) => Math.round(n / 1024 / 1024);

/** Espacio libre en bytes de la unidad que contiene `dir`, o null si no se puede saber. */
async function freeBytes(dir: string): Promise<number | null> {
  try {
    const st = await fsp.statfs(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}
