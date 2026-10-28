/**
 * Sincronización automática con la API central (runSyncCycle de @amara/sync).
 *
 *  - Cada ~30 s si hay terminal activada, URL y token.
 *  - Al recuperar la red (net.isOnline pasa de false a true) y tras cada venta/movimiento (con
 *    una pequeña espera para agrupar) -> `syncSoon()`.
 *  - Un ciclo empuja TODO lo pendiente en orden y solo después baja catálogo/existencias.
 *  - Sin internet NO se bloquea nada: el estado queda "sin conexión" y se reintenta solo.
 *  - Estado visible en la barra superior y en la pantalla de Sincronización.
 */
import { net } from 'electron';
import type { LocalStore } from '@amara/database';
import { HttpSyncApi, runSyncCycle } from '@amara/sync';
import type { SyncState } from '../shared/ipc.ts';
import { electronFetch } from './api-client.ts';

export const SYNC_INTERVAL_MS = 30_000;

export class SyncService {
  state: SyncState = {
    activated: false, running: false, online: false, authError: false,
    lastRunAt: null, lastOkAt: null, lastError: null, pending: 0, rejected: 0, openConflicts: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private netTimer: ReturnType<typeof setInterval> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | null = null;
  private wasOnline = false;
  private running = false;

  constructor(
    private d: {
      store: LocalStore;
      getApiUrl: () => string;
      getToken: () => string | null;
      emit: (s: SyncState) => void;
    },
  ) {}

  start(): void {
    this.wasOnline = net.isOnline();
    void this.runNow();
    this.timer = setInterval(() => void this.runNow(), SYNC_INTERVAL_MS);
    // Detecta el regreso de la red sin esperar al siguiente ciclo.
    this.netTimer = setInterval(() => {
      const now = net.isOnline();
      if (now && !this.wasOnline) void this.runNow();
      this.wasOnline = now;
    }, 5_000);
  }

  stop(): void {
    for (const t of [this.timer, this.netTimer]) if (t) clearInterval(t);
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.timer = this.netTimer = this.soonTimer = null;
  }

  /** Programa un ciclo en pocos segundos (agrupa varias ventas seguidas). */
  syncSoon(delayMs = 4_000): void {
    if (this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.runNow();
    }, delayMs);
  }

  private async refreshCounts(): Promise<void> {
    const st = await this.d.store.syncStatus();
    this.state = { ...this.state, pending: st.pending, rejected: st.rejected, openConflicts: st.openConflicts, lastOkAt: st.lastSyncOkAt ?? this.state.lastOkAt };
  }

  async runNow(): Promise<SyncState> {
    if (this.running) return this.state;
    this.running = true;
    try {
      const device = await this.d.store.getDeviceInfo();
      const apiUrl = this.d.getApiUrl();
      const token = this.d.getToken();
      this.state = { ...this.state, activated: !!device && !!token && !!apiUrl };
      if (!device || !token || !apiUrl) {
        await this.refreshCounts();
        this.d.emit(this.state);
        return this.state;
      }
      if (!net.isOnline()) {
        this.state = { ...this.state, online: false, lastError: 'Sin conexión a internet' };
        await this.refreshCounts();
        this.d.emit(this.state);
        return this.state;
      }
      this.state = { ...this.state, running: true };
      this.d.emit(this.state);

      const api = new HttpSyncApi({ baseUrl: apiUrl, getToken: () => token, fetchImpl: electronFetch, timeoutMs: 20_000 });
      const report = await runSyncCycle(this.d.store, api, { branchId: device.branchId, terminalId: device.terminalId });
      const nowIso = new Date().toISOString();
      this.state = {
        ...this.state,
        running: false,
        online: report.online,
        authError: report.authError,
        lastRunAt: nowIso,
        lastError: report.error ?? null,
        lastOkAt: report.error ? this.state.lastOkAt : nowIso,
      };
      if (!report.error) await this.d.store.setSyncOk().catch(() => undefined);
      await this.refreshCounts();
      this.d.emit(this.state);
      return this.state;
    } catch (e) {
      this.state = { ...this.state, running: false, lastError: e instanceof Error ? e.message : String(e) };
      this.d.emit(this.state);
      return this.state;
    } finally {
      this.running = false;
    }
  }
}
