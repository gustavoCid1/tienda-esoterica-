/**
 * Verificación de un archivo SQLite (respaldo o base): se ABRE de solo lectura y se ejecuta
 * PRAGMA integrity_check, además de comprobar que existen las tablas clave del sistema.
 * Un respaldo que no pasa esta prueba NO cuenta como respaldo.
 * SOLO para archivos de respaldo: nunca llamar con la base viva (borra sus -wal/-shm).
 */
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

const REQUIRED_TABLES = ['sales', 'sale_items', 'sale_payments', 'inventory_movements', 'sync_queue', 'schema_migrations'];

export function verifyDbFile(path: string): { ok: boolean; reason?: string } {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const rows = db.prepare('PRAGMA integrity_check').all() as Record<string, string>[];
    const problems = rows.map((r) => Object.values(r)[0]).filter((v) => v !== 'ok');
    if (problems.length > 0) return { ok: false, reason: `integrity_check: ${problems.slice(0, 3).join('; ')}` };
    const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
    if (missing.length > 0) return { ok: false, reason: `faltan tablas: ${missing.join(', ')}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      db?.close();
    } catch {
      /* ya cerrada */
    }
    // Una copia puede traer cabecera WAL: al abrirla de solo lectura SQLite deja -wal/-shm junto al archivo.
    // Son restos sin datos (nadie escribe en un respaldo): se borran para no dejar basura ni confundir.
    for (const suffix of ['-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  }
}
