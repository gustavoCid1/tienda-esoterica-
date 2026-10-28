import type { AmaraBridge } from '../shared/ipc.ts';

declare global {
  interface Window {
    /** Puente del preload (único acceso al proceso principal). */
    amara: AmaraBridge;
  }
}

export {};
