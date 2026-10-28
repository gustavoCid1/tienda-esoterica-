import { defineConfig } from 'vitest/config';

// Variables mínimas para que config.ts no falle al importarse en pruebas.
// Las pruebas NO se conectan a MongoDB: usan repositorios en memoria o rutas que responden antes de tocar la base.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:1/no-se-usa',
      MONGODB_DB: 'amara_test',
      JWT_SECRET: 'secreto-solo-para-pruebas-0123456789abcdef0123456789',
      CORS_ORIGINS: 'http://localhost:5173',
    },
  },
});
