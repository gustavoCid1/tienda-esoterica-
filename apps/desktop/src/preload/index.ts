/**
 * Preload: ÚNICO puente entre la interfaz y el proceso principal.
 * Con contextIsolation y sandbox, la interfaz no ve `require`, `process` ni `ipcRenderer`:
 * solo `window.amara.invoke` / `window.amara.on`, limitados a las listas blancas de canales.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNEL_NAMES, EVENT_NAMES } from '../shared/ipc.ts';
import type { AmaraBridge } from '../shared/ipc.ts';

const channels = new Set<string>(Object.keys(CHANNEL_NAMES));
const events = new Set<string>(Object.keys(EVENT_NAMES));

const bridge: AmaraBridge = {
  invoke(channel, payload) {
    if (!channels.has(channel)) return Promise.reject(new Error(`Canal no permitido: ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
  on(event, cb) {
    if (!events.has(event)) throw new Error(`Evento no permitido: ${event}`);
    const handler = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on(event, handler);
    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
};

contextBridge.exposeInMainWorld('amara', bridge);
