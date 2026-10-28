/**
 * Secretos de la terminal: token de sincronización y llaves de los teléfonos vinculados.
 * Se cifran con `safeStorage` (en Windows usa DPAPI: solo el mismo usuario de Windows puede
 * descifrarlos). Si el sistema no ofrece cifrado se guardan en base64 con marca "raw:" y el
 * proceso principal avisa en pantalla (ver `encryptionAvailable`).
 */
import { safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readJsonSync, writeFileAtomicSync } from './fsutil.ts';

function enc(s: string): string {
  if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(s).toString('base64')}`;
  return `raw:${Buffer.from(s, 'utf8').toString('base64')}`;
}

function dec(s: string): string | null {
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    if (s.startsWith('raw:')) return Buffer.from(s.slice(4), 'base64').toString('utf8');
  } catch {
    /* archivo de otro usuario de Windows o dañado */
  }
  return null;
}

interface LanRecord { id: string; name: string; pairedAt: string; lastSeenAt: string | null; key: string }

export class SecretStore {
  private lan: LanRecord[];

  constructor(private tokenPath: string, private lanPath: string) {
    this.lan = readJsonSync<{ devices: LanRecord[] }>(lanPath, { devices: [] }).devices ?? [];
  }

  encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  // ── Token de terminal ──
  getTerminalToken(): string | null {
    if (!existsSync(this.tokenPath)) return null;
    return dec(readFileSync(this.tokenPath, 'utf8').trim());
  }

  setTerminalToken(token: string): void {
    writeFileAtomicSync(this.tokenPath, enc(token));
  }

  clearTerminalToken(): void {
    rmSync(this.tokenPath, { force: true });
  }

  // ── Teléfonos vinculados (LAN) ──
  listDevices(): { id: string; name: string; pairedAt: string; lastSeenAt: string | null }[] {
    return this.lan.map(({ id, name, pairedAt, lastSeenAt }) => ({ id, name, pairedAt, lastSeenAt }));
  }

  getDeviceKey(id: string): string | undefined {
    const r = this.lan.find((d) => d.id === id);
    return r ? (dec(r.key) ?? undefined) : undefined;
  }

  addDevice(id: string, name: string, key: string, nowIso: string): void {
    this.lan = this.lan.filter((d) => d.id !== id);
    this.lan.push({ id, name, pairedAt: nowIso, lastSeenAt: null, key: enc(key) });
    this.persistLan();
  }

  removeDevice(id: string): void {
    this.lan = this.lan.filter((d) => d.id !== id);
    this.persistLan();
  }

  touchDevice(id: string, nowIso: string): void {
    const r = this.lan.find((d) => d.id === id);
    if (!r) return;
    // Se persiste como máximo cada minuto para no escribir disco con cada lectura.
    if (r.lastSeenAt && Date.parse(nowIso) - Date.parse(r.lastSeenAt) < 60_000) return;
    r.lastSeenAt = nowIso;
    this.persistLan();
  }

  private persistLan(): void {
    writeFileAtomicSync(this.lanPath, JSON.stringify({ devices: this.lan }, null, 2));
  }
}
