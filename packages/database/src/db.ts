/**
 * Capa mínima de acceso a SQLite común a Windows (better-sqlite3) y Android
 * (expo-sqlite). Toda la lógica de la tienda se escribe UNA vez sobre esta interfaz.
 *
 * Concurrencia: cada dispositivo usa UNA conexión. `createDb` serializa las
 * operaciones con un candado: una transacción retiene el candado hasta COMMIT,
 * de modo que dos ventas simultáneas nunca se mezclan ni anidan transacciones.
 */
export interface RawDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends RawDb {
  /** Ejecuta `fn` dentro de BEGIN IMMEDIATE ... COMMIT (ROLLBACK si lanza). Dentro de fn use SOLO `tx`. */
  transaction<T>(fn: (tx: RawDb) => Promise<T>): Promise<T>;
}

class Lock {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(() => fn());
    this.tail = p.catch(() => undefined);
    return p;
  }
}

export function createDb(raw: RawDb): Db {
  const lock = new Lock();
  return {
    exec: (sql) => lock.run(() => raw.exec(sql)),
    run: (sql, params) => lock.run(() => raw.run(sql, params)),
    get: (sql, params) => lock.run(() => raw.get(sql, params)) as any,
    all: (sql, params) => lock.run(() => raw.all(sql, params)) as any,
    transaction: <T>(fn: (tx: RawDb) => Promise<T>) =>
      lock.run(async () => {
        await raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(raw);
          await raw.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            await raw.exec('ROLLBACK');
          } catch {
            /* la transacción ya terminó */
          }
          throw err;
        }
      }),
  };
}

/** Adaptador para APIs síncronas con prepare(): better-sqlite3 y node:sqlite (pruebas). */
export function fromSyncSqlite(db: {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...p: any[]): any; get(...p: any[]): any; all(...p: any[]): any };
}): RawDb {
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r?.changes ?? 0) };
    },
    async get(sql, params = []) {
      const row = db.prepare(sql).get(...params);
      return row ? { ...row } : undefined;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params).map((r: any) => ({ ...r }));
    },
  };
}

/** Adaptador para expo-sqlite (API asíncrona moderna). */
export function fromExpoSqlite(db: {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: any[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params?: any[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: any[]): Promise<T[]>;
}): RawDb {
  return {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params = []) {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    async get(sql, params = []) {
      return ((await db.getFirstAsync(sql, params)) ?? undefined) as any;
    },
    all: (sql, params = []) => db.getAllAsync(sql, params) as any,
  };
}

/** PRAGMAs de durabilidad: cada COMMIT queda en disco aunque se vaya la luz. */
export const OPEN_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;
