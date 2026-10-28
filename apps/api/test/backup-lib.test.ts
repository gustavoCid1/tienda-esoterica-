import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupDirName, verifyNdjson } from '../src/backup-lib.ts';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'amara-backup-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('backupDirName', () => {
  it('es seguro para nombres de archivo y ordenable', () => {
    expect(backupDirName(new Date('2026-10-22T14:05:09.123Z'))).toBe('2026-10-22T14-05-09Z');
  });
});

describe('verifyNdjson', () => {
  it('acepta un archivo íntegro', async () => {
    const content = '{"_id":"a","x":1}\n{"_id":"b","x":2}\n';
    const p = join(dir, 'ok.ndjson');
    await writeFile(p, content);
    const sha = createHash('sha256').update(content).digest('hex');
    const r = await verifyNdjson(p, 2, sha);
    expect(r.ok).toBe(true);
    expect(r.lines).toBe(2);
    expect(r.sha256).toBe(sha);
  });
  it('un archivo vacío es válido si se esperaban 0 documentos', async () => {
    const p = join(dir, 'vacio.ndjson');
    await writeFile(p, '');
    expect((await verifyNdjson(p, 0)).ok).toBe(true);
  });
  it('detecta conteo distinto, JSON roto, falta de _id y hash distinto', async () => {
    const p1 = join(dir, 'corto.ndjson');
    await writeFile(p1, '{"_id":"a"}\n');
    expect((await verifyNdjson(p1, 2)).ok).toBe(false);

    const p2 = join(dir, 'roto.ndjson');
    await writeFile(p2, '{"_id":"a"}\n{no es json\n');
    expect((await verifyNdjson(p2, 2)).error).toMatch(/JSON/);

    const p3 = join(dir, 'sinid.ndjson');
    await writeFile(p3, '{"x":1}\n');
    expect((await verifyNdjson(p3, 1)).error).toMatch(/_id/);

    const p4 = join(dir, 'hash.ndjson');
    await writeFile(p4, '{"_id":"a"}\n');
    expect((await verifyNdjson(p4, 1, 'deadbeef')).error).toMatch(/SHA-256/);
  });
  it('archivo inexistente → no ok', async () => {
    expect((await verifyNdjson(join(dir, 'nada.ndjson'), 0)).ok).toBe(false);
  });
});
