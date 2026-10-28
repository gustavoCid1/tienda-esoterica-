/** Piezas puras del respaldo (nombres y verificación de archivos), separadas para poder probarlas sin MongoDB. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Carpeta del respaldo: 2026-10-22T14-05-09Z (fecha y hora UTC, segura para nombres de archivo). */
export function backupDirName(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export interface FileCheck {
  ok: boolean;
  lines: number;
  sha256: string;
  bytes: number;
  error?: string;
}

/** Relee un archivo NDJSON: cuenta líneas, comprueba que cada una sea JSON válido con _id y calcula SHA-256. */
export async function verifyNdjson(path: string, expectedLines: number, expectedSha256?: string): Promise<FileCheck> {
  const hash = createHash('sha256');
  const decoder = new TextDecoder();
  let bytes = 0;
  let lines = 0;
  let carry = '';
  let error: string | undefined;

  const checkLine = (line: string) => {
    if (line.trim() === '') return;
    lines++;
    if (error) return;
    try {
      const doc = JSON.parse(line);
      if (doc === null || typeof doc !== 'object' || !('_id' in doc)) error = `Línea ${lines} sin _id`;
    } catch {
      error = `Línea ${lines} no es JSON válido`;
    }
  };

  try {
    for await (const chunk of createReadStream(path)) {
      const buf = chunk as Buffer;
      hash.update(buf);
      bytes += buf.length;
      const parts = (carry + decoder.decode(buf, { stream: true })).split('\n');
      carry = parts.pop() ?? '';
      for (const p of parts) checkLine(p);
    }
    checkLine(carry + decoder.decode());
  } catch (e) {
    error = e instanceof Error ? e.message : 'No se pudo leer el archivo';
  }
  const sha256 = hash.digest('hex');
  if (!error && lines !== expectedLines) error = `Se esperaban ${expectedLines} documentos y se leyeron ${lines}`;
  if (!error && expectedSha256 && sha256 !== expectedSha256) error = 'El SHA-256 del archivo no coincide con el calculado al escribirlo';
  return { ok: !error, lines, sha256, bytes, ...(error ? { error } : {}) };
}
