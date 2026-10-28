/** Arranque del servidor: conecta a MongoDB, crea índices y abre el puerto. */
import { createApp } from './app.ts';
import { config } from './config.ts';
import { closeDb, connect, ensureIndexes } from './db.ts';

async function main() {
  await connect();
  await ensureIndexes();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[api] Esotérica Amara API v${config.version} escuchando en el puerto ${config.port}`);
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[api] ${signal}: cerrando...`);
    // Deja terminar las peticiones en curso (una venta a medias no debe cortarse).
    server.close(() => {
      closeDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[api] No se pudo iniciar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
