/**
 * Selección del respaldo desde el cual recuperar una base dañada. Lógica independiente de
 * SQLite (la verificación se INYECTA) para poder probarla: el orden es del respaldo más
 * reciente al más antiguo y se toma el primero que pase la verificación.
 */
import { listBackupEntries } from '../shared/backup-rotation.ts';

export interface RecoveryFile {
  path: string;
  name: string;
}

export interface RecoveryPick {
  file: RecoveryFile;
  at: Date;
  skipped: { path: string; reason: string }[];
}

export async function pickRecoveryCandidate(
  files: RecoveryFile[],
  verify: (file: RecoveryFile) => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string },
): Promise<RecoveryPick | null> {
  // Si el mismo nombre existe en varias carpetas, se prueban todas (orden estable por fecha).
  const byName = new Map<string, RecoveryFile[]>();
  for (const f of files) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  const ordered = listBackupEntries(files.map((f) => f.name));
  const skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const entry of ordered) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    for (const file of byName.get(entry.name) ?? []) {
      const r = await verify(file);
      if (r.ok) return { file, at: entry.at, skipped };
      skipped.push({ path: file.path, reason: r.reason ?? 'no pasó la verificación' });
    }
  }
  return null;
}
