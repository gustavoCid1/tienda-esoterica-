/**
 * Configuración de electron-vite (construye main, preload y renderer con Vite).
 * - better-sqlite3 es módulo nativo: queda EXTERNO (no se empaqueta en el bundle) y
 *   se reconstruye para Electron con `npm run rebuild`.
 * - Los paquetes del monorepo (@amara/*) son código TypeScript: se COMPILAN dentro del bundle.
 *   Por eso viven en devDependencies (electron-vite solo externaliza `dependencies`).
 */
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const WORKSPACE = ['@amara/shared', '@amara/database', '@amara/sync'];

/** En desarrollo (HMR de Vite) se quita la CSP estricta del index.html; en producción queda activa. */
const devWithoutCsp = {
  name: 'amara-dev-sin-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '');
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE })],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE })],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), devWithoutCsp],
    server: { fs: { allow: [resolve(__dirname, '../..')] } },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
