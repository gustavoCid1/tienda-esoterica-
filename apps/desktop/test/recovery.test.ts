import { describe, expect, it } from 'vitest';
import { backupFileName } from '../src/shared/backup-rotation.ts';
import { pickRecoveryCandidate } from '../src/main/recovery.ts';

const f = (iso: string, dir = 'D:\\resp') => {
  const name = backupFileName(new Date(iso));
  return { path: `${dir}\\${name}`, name };
};

describe('recuperación desde respaldo', () => {
  it('toma el respaldo válido MÁS RECIENTE y registra los dañados que omitió', async () => {
    const files = [f('2026-10-22T10:00:00Z'), f('2026-10-22T14:00:00Z'), f('2026-10-22T12:00:00Z')];
    const bad = files[1]!.path; // el más reciente está dañado
    const pick = await pickRecoveryCandidate(files, (x) => (x.path === bad ? { ok: false, reason: 'integrity_check' } : { ok: true }));
    expect(pick?.file.path).toBe(files[2]!.path);
    expect(pick?.skipped).toEqual([{ path: bad, reason: 'integrity_check' }]);
  });

  it('busca también en el segundo destino cuando la carpeta principal no sirve', async () => {
    const a = f('2026-10-22T14:00:00Z', 'D:\\resp');
    const b = f('2026-10-22T14:00:00Z', 'E:\\usb'); // misma copia en el USB
    const pick = await pickRecoveryCandidate([a, b], (x) => (x.path.startsWith('D:') ? { ok: false, reason: 'ilegible' } : { ok: true }));
    expect(pick?.file.path).toBe(b.path);
  });

  it('devuelve null si ninguno es válido (no se inventa una base vacía)', async () => {
    const pick = await pickRecoveryCandidate([f('2026-10-22T14:00:00Z')], () => ({ ok: false, reason: 'x' }));
    expect(pick).toBeNull();
    expect(await pickRecoveryCandidate([], () => ({ ok: true }))).toBeNull();
  });

  it('ignora archivos que no son respaldos', async () => {
    const pick = await pickRecoveryCandidate([{ path: 'D:\\resp\\notas.sqlite', name: 'notas.sqlite' }], () => ({ ok: true }));
    expect(pick).toBeNull();
  });
});
