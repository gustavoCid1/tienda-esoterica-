/**
 * Respaldo lógico de la base a archivos NDJSON (un documento JSON por línea, un archivo por colección).
 *
 * IMPORTANTE: el plan gratuito de MongoDB Atlas (M0) NO incluye respaldos administrados (Cloud Backup
 * existe desde M10). Este script es una red de seguridad básica. La alternativa estándar es `mongodump`
 * (MongoDB Database Tools), p. ej.:
 *     mongodump --uri="$MONGODB_URI" --db=amara --gzip --out=./backups/mongodump-$(date +%F)
 * y se restaura con `mongorestore`. Este script NO sustituye a un respaldo fuera del servidor: copia la
 * carpeta resultante a otro disco / nube cifrada con regularidad.
 *
 * Detalles:
 *  - Variables: BACKUP_DIR (carpeta destino, por omisión ./backups, ya ignorada por git).
 *  - Cada ejecución crea BACKUP_DIR/<fecha-hora UTC>/<colección>.ndjson + manifest.json.
 *  - Se verifica RELEYENDO cada archivo (líneas = documentos, JSON válido, SHA-256) y se registra en
 *    la colección backups_log (visible en GET /admin/backups). Termina con código 1 si algo falla.
 *  - Los archivos contienen hashes de contraseñas y datos del negocio: se crean con permisos 0600/0700.
 *    Guárdalos cifrados y fuera del servidor. No se borran respaldos antiguos automáticamente.
 *  - Los documentos usan _id string y fechas ISO (strings), por eso JSON simple basta; no es EJSON.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { newId } from '@amara/shared';
import { backupDirName, verifyNdjson } from './backup-lib.ts';
import type { FileCheck } from './backup-lib.ts';

async function main() {
  const { config } = await import('./config.ts');
  const { closeDb, col, COLLECTIONS, connect } = await import('./db.ts');
  const started = Date.now();
  const startedAt = new Date();
  const baseDir = resolve(process.env.BACKUP_DIR ?? './backups');
  const dir = join(baseDir, backupDirName(startedAt));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await connect();

  const files: { collection: string; file: string; count: number; bytes: number; sha256: string; verified: boolean; error?: string }[] = [];
  let ok = true;
  try {
    for (const name of COLLECTIONS) {
      const file = `${name}.ndjson`;
      const path = join(dir, file);
      const out = createWriteStream(path, { mode: 0o600 });
      const hash = createHash('sha256');
      let count = 0;
      for await (const doc of col(name).find({})) {
        const line = `${JSON.stringify(doc)}\n`;
        hash.update(line);
        if (!out.write(line)) await once(out, 'drain');
        count++;
      }
      out.end();
      await once(out, 'finish');
      // Verificación: se vuelve a leer lo escrito en disco.
      const check: FileCheck = await verifyNdjson(path, count, hash.digest('hex'));
      if (!check.ok) ok = false;
      files.push({ collection: name, file, count, bytes: check.bytes, sha256: check.sha256, verified: check.ok, ...(check.error ? { error: check.error } : {}) });
      console.log(`[backup] ${name}: ${count} documentos ${check.ok ? 'verificados' : `ERROR: ${check.error}`}`);
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ createdAt: startedAt.toISOString(), db: config.dbName, files }, null, 2), { mode: 0o600 });
  } catch (e) {
    ok = false;
    console.error('[backup] Falló:', e instanceof Error ? e.message : e);
  }

  const id = newId();
  try {
    await col('backups_log').insertOne({ _id: id, id, at: startedAt.toISOString(), kind: 'ndjson', dir, ok, durationMs: Date.now() - started, files: files.map(({ collection, count, bytes, sha256, verified, error }) => ({ collection, count, bytes, sha256, verified, ...(error ? { error } : {}) })) });
  } catch (e) {
    console.error('[backup] No se pudo registrar en backups_log:', e instanceof Error ? e.message : e);
    ok = false;
  }
  await closeDb();
  console.log(ok ? `[backup] Respaldo completo y verificado en ${dir}` : `[backup] Respaldo INCOMPLETO o con errores (${dir})`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[backup] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
