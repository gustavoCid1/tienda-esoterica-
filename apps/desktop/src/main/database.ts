/**
 * Apertura de la base SQLite con verificación de integridad y RECUPERACIÓN automática.
 *
 * Al arrancar:
 *  1. Se abre amara.sqlite, se aplican OPEN_PRAGMAS (WAL, synchronous=FULL, foreign_keys...).
 *  2. PRAGMA integrity_check (+ foreign_key_check). Si falla -> recuperación.
 *  3. Si hay migraciones pendientes se hace antes una copia consistente (respaldos-internos\).
 *  4. Se aplican las migraciones.
 *
 * Recuperación (SOLO si el error es de corrupción: SQLITE_CORRUPT / SQLITE_NOTADB / integrity_check):
 *  - Se busca, del más reciente al más antiguo, un respaldo que pase la verificación (carpeta
 *    de respaldos, segundo destino y respaldos internos).
 *  - La base dañada NO se borra: se renombra a amara.sqlite.dañada-<fecha> junto con sus
 *    archivos -wal y -shm (un WAL viejo aplicado sobre otra base la corrompería).
 *  - Se copia el respaldo y se vuelve a verificar.
 *  - Si no hay ningún respaldo válido se lanza DbUnrecoverableError y NO se crea una base vacía
 *    encima: el archivo dañado queda intacto para que un técnico lo revise.
 * Un error que NO es de corrupción (disco bloqueado, módulo nativo mal compilado) jamás dispara
 * la recuperación, para no destruir una base sana por un problema de entorno.
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LocalStore, OPEN_PRAGMAS, SCHEMA_VERSION, createDb, fromSyncSqlite } from '@amara/database';
import { formatMxDateTime, newId } from '@amara/shared';
import { backupFileName, parseBackupFileName } from '../shared/backup-rotation.ts';
import { verifyDbFile } from './db-verify.ts';
import { pickRecoveryCandidate } from './recovery.ts';
import type { RecoveryFile } from './recovery.ts';

export interface OpenedDatabase {
  raw: Database.Database;
  store: LocalStore;
  dbPath: string;
  /** Texto para mostrar al usuario si hubo recuperación (null = arranque normal). */
  notice: string | null;
}

export class IntegrityError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`La verificación de integridad falló: ${problems.slice(0, 3).join('; ')}`);
    this.name = 'IntegrityError';
    this.problems = problems;
  }
}

export class DbUnrecoverableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnrecoverableError';
  }
}

export function isCorruptionError(err: unknown): boolean {
  if (err instanceof IntegrityError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^SQLITE_(CORRUPT|NOTADB)/.test(code);
}

export interface OpenOptions {
  dbPath: string;
  /** Carpetas donde buscar respaldos para recuperar (principal, segundo destino...). */
  backupDirs: string[];
  internalBackupDir: string;
  log: (line: string) => void;
}

async function openAndCheck(opts: OpenOptions): Promise<{ raw: Database.Database; store: LocalStore }> {
  const raw = new Database(opts.dbPath);
  try {
    raw.exec(OPEN_PRAGMAS);
    const store = new LocalStore(createDb(fromSyncSqlite(raw)));
    const ic = await store.integrityCheck();
    if (!ic.ok) throw new IntegrityError(ic.problems);

    // Copia previa a migrar (solo si ya existía un esquema más antiguo).
    const hasMig = raw.prepare("SELECT 1 AS x FROM sqlite_master WHERE name = 'schema_migrations'").get();
    if (hasMig) {
      const cur = (raw.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
      if (cur < SCHEMA_VERSION) {
        try {
          mkdirSync(opts.internalBackupDir, { recursive: true });
          await store.backupInto(join(opts.internalBackupDir, `pre-migracion-v${cur}-${Date.now()}.sqlite`));
        } catch (e) {
          opts.log(`No se pudo hacer la copia previa a la migración: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    await store.migrate();
    return { raw, store };
  } catch (e) {
    try {
      raw.close();
    } catch {
      /* ya cerrada */
    }
    throw e;
  }
}

function collectBackupFiles(dirs: string[]): RecoveryFile[] {
  const out: RecoveryFile[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      for (const name of readdirSync(dir)) {
        if (parseBackupFileName(name)) out.push({ path: join(dir, name), name });
      }
    } catch {
      /* carpeta ausente (USB desconectado): se omite */
    }
  }
  return out;
}

function quarantine(dbPath: string): string {
  const stamp = backupFileName(new Date()).replace(/^amara_/, '').replace(/\.sqlite$/, '');
  const target = `${dbPath}.danada-${stamp}`;
  for (const suffix of ['', '-wal', '-shm']) {
    const src = `${dbPath}${suffix}`;
    if (!existsSync(src)) continue;
    try {
      renameSync(src, `${target}${suffix}`);
    } catch {
      // Si no se puede renombrar (archivo en uso) se intenta copiar y borrar.
      copyFileSync(src, `${target}${suffix}`);
      rmSync(src, { force: true });
    }
  }
  return target;
}

export async function openDatabase(opts: OpenOptions): Promise<OpenedDatabase> {
  const existed = existsSync(opts.dbPath);
  try {
    const o = await openAndCheck(opts);
    return { ...o, dbPath: opts.dbPath, notice: null };
  } catch (err) {
    if (!existed || !isCorruptionError(err)) throw err;
    opts.log(`Base dañada: ${err instanceof Error ? err.message : String(err)}`);

    const files = collectBackupFiles([...opts.backupDirs, opts.internalBackupDir]);
    const pick = await pickRecoveryCandidate(files, (f) => verifyDbFile(f.path));
    if (!pick) {
      throw new DbUnrecoverableError(
        `La base de datos está dañada y no se encontró ningún respaldo válido en: ${opts.backupDirs.filter(Boolean).join(' | ') || '(sin carpeta de respaldo)'}. ` +
          `El archivo NO se modificó: ${opts.dbPath}. Contacta a soporte antes de continuar.`,
      );
    }
    const damaged = quarantine(opts.dbPath);
    copyFileSync(pick.file.path, opts.dbPath);
    let opened: { raw: Database.Database; store: LocalStore };
    try {
      opened = await openAndCheck(opts);
    } catch (e) {
      throw new DbUnrecoverableError(`El respaldo elegido tampoco se pudo abrir (${e instanceof Error ? e.message : String(e)}). La base dañada quedó en ${damaged}.`);
    }
    const notice =
      `La base de datos estaba dañada y se restauró automáticamente desde el respaldo del ${formatMxDateTime(pick.at.toISOString())}. ` +
      `Las operaciones hechas después de esa hora y que no se hubieran sincronizado pueden faltar: revisa los últimos tickets y movimientos. ` +
      `La base dañada se conservó como ${damaged}.`;
    try {
      await opened.store.db.run(
        'INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, branch_id, terminal_id, detail_json) VALUES (?,?,?,?,?,?,?,?,?)',
        [newId(), new Date().toISOString(), null, 'sistema.restauracion_automatica', 'database', null, null, null,
          JSON.stringify({ from: pick.file.path, damaged, skipped: pick.skipped })],
      );
    } catch {
      /* la auditoría no debe impedir el arranque */
    }
    return { ...opened, dbPath: opts.dbPath, notice };
  }
}
