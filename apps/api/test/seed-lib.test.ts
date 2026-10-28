import { describe, expect, it } from 'vitest';
import { readSeedManager, SEED_BRANCHES, SeedError } from '../src/seed-lib.ts';

describe('readSeedManager', () => {
  it('aborta si la contraseña está vacía o ausente', () => {
    expect(() => readSeedManager({})).toThrow(SeedError);
    expect(() => readSeedManager({ SEED_MANAGER_PASSWORD: '' })).toThrow(SeedError);
    expect(() => readSeedManager({ SEED_MANAGER_PASSWORD: '          ' })).toThrow(SeedError);
  });
  it('aborta si tiene menos de 10 caracteres y NO la revela en el mensaje', () => {
    const secret = 'corta123';
    try {
      readSeedManager({ SEED_MANAGER_PASSWORD: secret });
      throw new Error('debió fallar');
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError);
      expect((e as Error).message).not.toContain(secret);
    }
  });
  it('acepta exactamente 10 caracteres y normaliza el usuario', () => {
    const m = readSeedManager({ SEED_MANAGER_PASSWORD: '1234567890', SEED_MANAGER_USERNAME: ' Gerente.Amara ', SEED_MANAGER_NAME: 'Ana' });
    expect(m).toEqual({ username: 'gerente.amara', name: 'Ana', password: '1234567890' });
  });
  it('valores por omisión', () => {
    const m = readSeedManager({ SEED_MANAGER_PASSWORD: 'una-clave-larga' });
    expect(m.username).toBe('gerente');
    expect(m.name).toBe('Gerente');
  });
  it('usuario inválido', () => {
    expect(() => readSeedManager({ SEED_MANAGER_PASSWORD: 'una-clave-larga', SEED_MANAGER_USERNAME: 'a b' })).toThrow(SeedError);
  });
});

describe('sucursales iniciales', () => {
  it('dos sucursales con una terminal cada una y códigos únicos', () => {
    expect(SEED_BRANCHES.map((b) => b.name)).toEqual(['Sucursal 1', 'Sucursal 2']);
    expect(new Set(SEED_BRANCHES.map((b) => b.terminal.code)).size).toBe(2);
  });
});
