import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeApiUrl, normalizeSettings } from '../src/shared/settings.ts';

const defaults = defaultSettings('C:\\Users\\Caja\\Documents');

describe('ajustes', () => {
  it('rellena valores por omisión con un archivo vacío o dañado', () => {
    expect(normalizeSettings(undefined, defaults)).toEqual(defaults);
    expect(normalizeSettings('basura', defaults)).toEqual(defaults);
    expect(defaults.backupDir).toBe('C:\\Users\\Caja\\Documents\\Esoterica Amara\\Respaldos');
    expect(defaults.backupIntervalMin).toBe(120);
  });

  it('valida papel, intervalos y límites', () => {
    const s = normalizeSettings({ paperMm: 100, backupIntervalMin: 1, scannerMaxGapMs: 9999, labelWidthMm: 1, retention: { keepRecent: 0, keepDaily: -5 } }, defaults);
    expect(s.paperMm).toBe(80);
    expect(s.backupIntervalMin).toBe(15);
    expect(s.scannerMaxGapMs).toBe(200);
    expect(s.labelWidthMm).toBe(20);
    expect(s.retention.keepRecent).toBe(1);
    expect(s.retention.keepDaily).toBe(0);
    expect(normalizeSettings({ paperMm: 58 }, defaults).paperMm).toBe(58);
  });

  it('normaliza la URL de la API', () => {
    expect(normalizeApiUrl('https://amara.example.com/')).toBe('https://amara.example.com');
    expect(normalizeApiUrl('http://192.168.1.10:4000')).toBe('http://192.168.1.10:4000');
    expect(normalizeApiUrl('javascript:alert(1)')).toBe('');
    expect(normalizeApiUrl('amara.example.com')).toBe('');
    expect(normalizeApiUrl(42)).toBe('');
  });
});
