/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuración de Vite.
 *  - VITE_API_URL: URL base de la API que usa el navegador (por defecto "/api").
 *  - VITE_API_PROXY_TARGET: si se define, el servidor de desarrollo reenvía "/api/*"
 *    a esa dirección quitando el prefijo "/api" (la API publica sus rutas sin prefijo).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.VITE_API_PROXY_TARGET;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: target
        ? {
            '/api': {
              target,
              changeOrigin: true,
              rewrite: (p: string) => p.replace(/^\/api/, ''),
            },
          }
        : undefined,
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
