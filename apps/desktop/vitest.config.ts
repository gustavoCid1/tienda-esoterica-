import { defineConfig } from 'vitest/config';

// Solo lógica pura (sin Electron ni DOM): parser de escáner, ticket, rotación de respaldos, pagos, ajustes.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
