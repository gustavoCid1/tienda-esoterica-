/** Utilidades de archivos del proceso principal. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';

/** Escritura atómica: escribe a un temporal y renombra, para que un corte de luz no deje un JSON a medias. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await fsp.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, path);
}

/** Versión síncrona (almacenes pequeños de configuración). */
export function writeFileAtomicSync(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

export function readJsonSync<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Registro simple en archivo de texto (logs\...). Nunca lanza. */
export function appendLog(path: string, line: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  } catch {
    /* el registro no debe romper la operación */
  }
}
