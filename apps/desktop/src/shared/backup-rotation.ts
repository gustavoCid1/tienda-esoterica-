/**
 * Nombres y rotación de respaldos. Lógica PURA (sin disco) para poder probarla.
 *
 * Nombre: amara_AAAA-MM-DD_HH-MM-SS.sqlite  (hora de México, la del negocio).
 * Rotación: se CONSERVAN (unión de tres reglas) y se borra el resto:
 *   1. las `keepRecent` copias más recientes,
 *   2. la copia más reciente de cada uno de los `keepDaily` días más recientes con copias,
 *   3. la copia más reciente de cada uno de los `keepMonthly` meses más recientes con copias.
 * Siempre sobrevive la copia más reciente. Los archivos que no siguen el patrón se ignoran
 * (nunca se proponen para borrado).
 */
import { MX_OFFSET_MIN } from '@amara/shared';
import type { RetentionSettings } from './settings.ts';

export const BACKUP_PREFIX = 'amara_';
export const BACKUP_EXT = '.sqlite';

const NAME_RE = /^amara_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.sqlite$/;

const p2 = (n: number) => String(n).padStart(2, '0');

/** amara_2026-10-22_13-45-10.sqlite (hora de México). */
export function backupFileName(at: Date): string {
  const d = new Date(at.getTime() + MX_OFFSET_MIN * 60000);
  return `${BACKUP_PREFIX}${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}_${p2(d.getUTCHours())}-${p2(d.getUTCMinutes())}-${p2(d.getUTCSeconds())}${BACKUP_EXT}`;
}

/** Instante UTC que representa el nombre, o null si no es un respaldo de la aplicación. */
export function parseBackupFileName(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - MX_OFFSET_MIN * 60000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface BackupEntry {
  name: string;
  at: Date;
}

/** Respaldos válidos por nombre, del más reciente al más antiguo. */
export function listBackupEntries(names: string[]): BackupEntry[] {
  const out: BackupEntry[] = [];
  for (const name of names) {
    const at = parseBackupFileName(name);
    if (at) out.push({ name, at });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Nombres que deben borrarse según la política. Nunca incluye la copia más reciente. */
export function selectBackupsToDelete(names: string[], policy: RetentionSettings): string[] {
  const entries = listBackupEntries(names); // ya viene de más reciente a más antiguo
  const keep = new Set<string>();

  entries.slice(0, Math.max(1, policy.keepRecent)).forEach((e) => keep.add(e.name));

  const keepNewestPer = (keyOf: (d: Date) => string, limit: number) => {
    const seen = new Set<string>();
    for (const e of entries) {
      const key = keyOf(e.at);
      if (seen.has(key)) continue; // ya se guardó la más reciente de ese día/mes
      if (seen.size >= limit) break;
      seen.add(key);
      keep.add(e.name);
    }
  };
  const mxDay = (d: Date) => new Date(d.getTime() + MX_OFFSET_MIN * 60000).toISOString().slice(0, 10);
  if (policy.keepDaily > 0) keepNewestPer(mxDay, policy.keepDaily);
  if (policy.keepMonthly > 0) keepNewestPer((d) => mxDay(d).slice(0, 7), policy.keepMonthly);

  return entries.filter((e) => !keep.has(e.name)).map((e) => e.name);
}
