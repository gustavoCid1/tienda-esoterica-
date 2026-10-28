/** Llamadas tipadas al proceso principal (window.amara) con errores en español. */
import type { IpcChannel, IpcEnvelope, IpcEventMap, IpcEventName, IpcMap } from '../../shared/ipc.ts';

export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

type Args<K extends IpcChannel> = IpcMap[K]['req'] extends undefined ? [] : [req: IpcMap[K]['req']];

export async function call<K extends IpcChannel>(channel: K, ...args: Args<K>): Promise<IpcMap[K]['res']> {
  const env = (await window.amara.invoke(channel, args[0])) as IpcEnvelope<IpcMap[K]['res']>;
  if (!env.ok) throw new AppError(env.code, env.error);
  return env.data;
}

export function onEvent<K extends IpcEventName>(name: K, cb: (data: IpcEventMap[K]) => void): () => void {
  return window.amara.on(name, (d) => cb(d as IpcEventMap[K]));
}

export function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Ocurrió un error. Inténtalo de nuevo.';
}

export function errorCode(e: unknown): string {
  return e instanceof AppError ? e.code : 'error';
}
