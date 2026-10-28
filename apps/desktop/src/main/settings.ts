/** Almacén de ajustes (config.json). La validación vive en src/shared/settings.ts (pura y probada). */
import { app } from 'electron';
import { readJsonSync, writeFileAtomicSync } from './fsutil.ts';
import { defaultSettings, normalizeApiUrl, normalizeSettings } from '../shared/settings.ts';
import type { AppSettings } from '../shared/settings.ts';

export class SettingsStore {
  private current: AppSettings;
  private defaults: AppSettings;

  constructor(private path: string) {
    this.defaults = defaultSettings(app.getPath('documents'));
    this.current = normalizeSettings(readJsonSync<unknown>(path, {}), this.defaults);
  }

  get(): AppSettings {
    return this.current;
  }

  save(patch: Partial<AppSettings>): AppSettings {
    if (patch.apiUrl !== undefined && patch.apiUrl.trim() !== '' && normalizeApiUrl(patch.apiUrl) === '') {
      throw new Error('La dirección del servidor no es válida. Ejemplo: https://amara.midominio.com');
    }
    const merged = {
      ...this.current,
      ...patch,
      retention: { ...this.current.retention, ...(patch.retention ?? {}) },
    };
    this.current = normalizeSettings(merged, this.defaults);
    writeFileAtomicSync(this.path, JSON.stringify(this.current, null, 2));
    return this.current;
  }
}
