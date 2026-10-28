/**
 * Captura GLOBAL del escáner. Dos orígenes con el mismo destino:
 *  - USB "tipo teclado": ráfaga de teclas + Enter en cualquier parte de la ventana, SIN necesidad
 *    de enfocar un campo (BurstParser). El texto de la lectura se bloquea para no escribirse en
 *    el campo enfocado ni activar botones con el Enter.
 *  - Teléfono vinculado: el proceso principal manda 'evt:scan'.
 * Las lecturas repetidas (doble disparo) se filtran con ScanGate. Recibe la lectura el
 * manejador MÁS RECIENTE registrado (pantalla activa o ventana abierta encima).
 */
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { onEvent } from '../lib/api.ts';
import { BurstParser, DEFAULT_BURST_CONFIG, ScanGate } from '../lib/scan-burst.ts';
import { useApp } from './AppState.tsx';
import { useFeedback } from './Feedback.tsx';

export type ScanSource = 'usb' | 'phone';
type Handler = (code: string, source: ScanSource) => void;

interface ScanApi {
  push: (h: Handler) => () => void;
}

const Ctx = createContext<ScanApi | null>(null);

/** Registra el manejador de lecturas mientras el componente esté montado (el último montado manda). */
export function useScanHandler(handler: Handler): void {
  const api = useContext(Ctx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => api?.push((c, s) => ref.current(c, s)), [api]);
}

/** Quita del campo enfocado los caracteres de la lectura que alcanzaron a escribirse. */
function eraseLeaked(code: string, leaked: number): void {
  const el = document.activeElement;
  if (leaked <= 0 || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (!el.value.endsWith(code.slice(0, leaked))) return;
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return;
  setter.call(el, el.value.slice(0, el.value.length - leaked)); // setter nativo: React sí detecta el cambio
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function ScannerProvider({ children }: { children: ReactNode }) {
  const { settings, user } = useApp();
  const { toast } = useFeedback();
  const stack = useRef<Handler[]>([]);
  const parser = useRef(new BurstParser(DEFAULT_BURST_CONFIG));
  const gate = useRef(new ScanGate(700));
  const signedIn = !!user;

  useEffect(() => {
    if (settings) parser.current.setConfig({ maxGapMs: settings.scannerMaxGapMs, minLength: settings.scannerMinLength });
  }, [settings]);

  const api = useMemo<ScanApi>(
    () => ({
      push: (h) => {
        stack.current.push(h);
        return () => {
          stack.current = stack.current.filter((x) => x !== h);
        };
      },
    }),
    [],
  );

  useEffect(() => {
    const dispatch = (code: string, source: ScanSource) => {
      if (!signedIn) return; // sin sesión no se aplica ninguna lectura
      if (!gate.current.accept(code, performance.now())) {
        toast('info', 'Lectura repetida ignorada.');
        return;
      }
      const top = stack.current[stack.current.length - 1];
      if (top) top(code, source);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const a = parser.current.feed({ key: e.key, timeStamp: e.timeStamp, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey });
      if (a.type === 'swallow') {
        e.preventDefault();
        e.stopPropagation();
      } else if (a.type === 'scan') {
        e.preventDefault();
        e.stopPropagation();
        eraseLeaked(a.code, a.leaked);
        dispatch(a.code, 'usb');
      }
    };
    window.addEventListener('keydown', onKey, true);
    const off = onEvent('evt:scan', (s) => dispatch(s.code, 'phone'));
    return () => {
      window.removeEventListener('keydown', onKey, true);
      off();
    };
  }, [signedIn, toast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
