/**
 * Apertura de la base SQLite local con expo-sqlite + LocalStore (@amara/database).
 * Una sola conexión por app (el candado de createDb serializa las transacciones).
 */
import * as SQLite from 'expo-sqlite';
import { LocalStore, createDb, fromExpoSqlite, OPEN_PRAGMAS } from '@amara/database';

type ExpoDb = Parameters<typeof fromExpoSqlite>[0];

let pending: Promise<LocalStore> | null = null;

export function openStore(): Promise<LocalStore> {
  if (!pending) {
    pending = (async () => {
      const sqlite = await SQLite.openDatabaseAsync('amara.db');
      // WAL + synchronous=FULL: cada COMMIT queda en disco aunque se apague el teléfono.
      await sqlite.execAsync(OPEN_PRAGMAS);
      const store = new LocalStore(createDb(fromExpoSqlite(sqlite as unknown as ExpoDb)));
      await store.migrate();
      // El teléfono no tiene cajón de dinero propio: la venta de emergencia no exige caja abierta.
      // (Si el gerente abre caja en esta terminal, registerSale sí la usa.) Ver docs/PENDIENTES-mobile.md.
      if ((await store.getMeta('require_open_cash')) === undefined) await store.setMeta('require_open_cash', '0');
      return store;
    })();
    pending.catch(() => {
      pending = null; // permite reintentar tras un fallo
    });
  }
  return pending;
}

export interface BranchRow {
  id: string;
  code: string;
  name: string;
}

export async function loadBranches(store: LocalStore): Promise<BranchRow[]> {
  return store.db.all<BranchRow>("SELECT id, code, name FROM branches WHERE status = 'activa' ORDER BY name");
}
