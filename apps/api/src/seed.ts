/**
 * Primer arranque: crea "Sucursal 1" y "Sucursal 2", una terminal por sucursal y el primer gerente.
 * Es idempotente (no duplica lo que ya existe) y NO imprime contraseñas ni tokens.
 * Los tokens de terminal los emite después el gerente desde la administración (POST /admin/terminals/:id/token).
 *
 * Uso: llenar SEED_MANAGER_* en apps/api/.env y ejecutar `npm run seed`.
 */
import { newId } from '@amara/shared';
import { hashPassword } from '@amara/shared/password';
import { readSeedManager, SEED_BRANCHES, SeedError } from './seed-lib.ts';

async function main() {
  // La contraseña se valida ANTES de conectar a la base: si es inválida no se toca nada.
  try {
    (process as any).loadEnvFile?.();
  } catch {
    /* sin .env: se usan las variables del sistema */
  }
  const manager = readSeedManager(process.env);

  const { config } = await import('./config.ts');
  const { closeDb, col, connect, ensureIndexes } = await import('./db.ts');
  await connect();
  try {
    await ensureIndexes();
    const now = new Date().toISOString();

    const branchIds: string[] = [];
    for (const b of SEED_BRANCHES) {
      let branch = await col('branches').findOne({ code: b.code });
      if (!branch) {
        const id = newId();
        await col('branches').insertOne({ _id: id, id, code: b.code, name: b.name, address: null, locations: [], status: 'activa', createdAt: now, updatedAt: now });
        branch = await col('branches').findOne({ _id: id });
        console.log(`[seed] Sucursal creada: ${b.name}`);
      }
      branchIds.push(branch!._id as string);

      if (!(await col('terminals').findOne({ code: b.terminal.code }))) {
        const tid = newId();
        await col('terminals').insertOne({
          _id: tid, id: tid, code: b.terminal.code, name: b.terminal.name, branchId: branch!._id, kind: 'escritorio',
          revoked: false, tokenVersion: 0, lastSyncAt: null, createdAt: now, updatedAt: now,
        });
        console.log(`[seed] Terminal creada: ${b.terminal.name}`);
      }
    }

    if (await col('users').findOne({ username: manager.username })) {
      console.log(`[seed] El usuario "${manager.username}" ya existe; no se modifica.`);
    } else {
      const uid = newId();
      await col('users').insertOne({
        _id: uid, id: uid, username: manager.username, name: manager.name, role: 'gerente', branchIds, active: true,
        passwordHash: hashPassword(manager.password), failedLogins: 0, lockedUntil: null, createdAt: now, updatedAt: now, createdBy: 'seed',
      });
      const aid = newId();
      await col('audit_log').insertOne({ _id: aid, id: aid, at: now, userId: null, action: 'seed.gerente_creado', entity: 'user', entityId: uid, branchId: null, terminalId: null, detail: { username: manager.username } });
      console.log(`[seed] Primer gerente creado: "${manager.username}". Cambia la contraseña inicial después de entrar.`);
    }
    console.log(`[seed] Listo (base "${config.dbName}").`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof SeedError ? `[seed] ${err.message}` : `[seed] Error: ${err instanceof Error ? err.message : 'desconocido'}`);
  process.exit(1);
});
