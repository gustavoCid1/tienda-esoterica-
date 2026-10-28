/// <reference types="vite/client" />

/** Variables de entorno propias del panel (se definen en .env, ver .env.example). */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
}
