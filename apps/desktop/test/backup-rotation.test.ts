import { describe, expect, it } from 'vitest';
import { backupFileName, listBackupEntries, parseBackupFileName, selectBackupsToDelete } from '../src/shared/backup-rotation.ts';

/** Genera nombres de respaldo cada `stepH` horas hacia atrás desde `endIso`. */
function names(endIso: string, count: number, stepH = 2): string[] {
  const end = new Date(endIso).getTime();
  return Array.from({ length: count }, (_, i) => backupFileName(new Date(end - i * stepH * 3600_000)));
}

describe('nombres de respaldo', () => {
  it('usa hora de México y se puede leer de vuelta', () => {
    const at = new Date('2026-10-22T19:45:10.000Z'); // 13:45:10 en México (UTC-6)
    const name = backupFileName(at);
    expect(name).toBe('amara_2026-10-22_13-45-10.sqlite');
    expect(parseBackupFileName(name)?.toISOString()).toBe(at.toISOString());
  });

  it('ignora archivos que no son respaldos de la app', () => {
    expect(parseBackupFileName('foto.png')).toBeNull();
    expect(parseBackupFileName('amara_2026-10-22_13-45-10.sqlite.partial')).toBeNull();
    expect(listBackupEntries(['x.txt', 'amara_2026-10-22_13-45-10.sqlite'])).toHaveLength(1);
  });
});

describe('rotación', () => {
  const policy = { keepRecent: 4, keepDaily: 3, keepMonthly: 2 };

  it('con pocas copias no borra nada', () => {
    const list = names('2026-10-22T20:00:00.000Z', 3);
    expect(selectBackupsToDelete(list, policy)).toEqual([]);
  });

  it('conserva las recientes, la última de cada día y la última de cada mes', () => {
    // 60 copias cada 2 h = 5 días de historia
    const list = names('2026-10-22T20:00:00.000Z', 60);
    const del = new Set(selectBackupsToDelete(list, policy));
    const keep = list.filter((n) => !del.has(n));
    // 4 recientes + (de los 3 días más recientes la última de cada uno) + 2 meses
    expect(keep.length).toBeGreaterThanOrEqual(4);
    expect(keep.length).toBeLessThanOrEqual(4 + 3 + 2);
    // la más reciente siempre sobrevive
    expect(keep).toContain(list[0]);
    // cada uno de los tres días más recientes conserva al menos una copia
    const days = new Set(keep.map((n) => n.slice(6, 16)));
    expect(days.size).toBeGreaterThanOrEqual(3);
    // y se borró algo de lo antiguo
    expect(del.size).toBeGreaterThan(0);
    expect(del.has(list.at(-1)!)).toBe(true);
  });

  it('keepRecent mínimo 1 y nunca borra la más reciente', () => {
    const list = names('2026-10-22T20:00:00.000Z', 10);
    const del = selectBackupsToDelete(list, { keepRecent: 0, keepDaily: 0, keepMonthly: 0 });
    expect(del).not.toContain(list[0]);
    expect(del).toHaveLength(9);
  });

  it('conserva la última copia de meses anteriores', () => {
    const list = [
      ...names('2026-10-22T20:00:00.000Z', 6),
      backupFileName(new Date('2026-09-30T20:00:00.000Z')),
      backupFileName(new Date('2026-09-10T20:00:00.000Z')),
      backupFileName(new Date('2026-08-15T20:00:00.000Z')),
    ];
    const del = selectBackupsToDelete(list, { keepRecent: 2, keepDaily: 1, keepMonthly: 3 });
    expect(del).not.toContain(backupFileName(new Date('2026-09-30T20:00:00.000Z'))); // último de septiembre
    expect(del).toContain(backupFileName(new Date('2026-09-10T20:00:00.000Z')));
    expect(del).not.toContain(backupFileName(new Date('2026-08-15T20:00:00.000Z'))); // último de agosto
  });

  it('no propone borrar archivos ajenos', () => {
    const del = selectBackupsToDelete(['notas.txt', ...names('2026-10-22T20:00:00.000Z', 8)], { keepRecent: 2, keepDaily: 0, keepMonthly: 0 });
    expect(del).not.toContain('notas.txt');
  });
});
