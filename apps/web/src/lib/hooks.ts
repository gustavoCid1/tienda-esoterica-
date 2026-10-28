/** Hooks reutilizables: carga de datos asíncrona, antirrebote y detección de cambios sin guardar. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from './api.ts';

/** Mensaje legible para cualquier error capturado. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Ocurrió un error inesperado.';
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Ejecuta `fn` cuando cambian `deps` (o se llama reload). Cancela la petición anterior
 * para que una respuesta lenta no pise a una más reciente.
 */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: enabled,
  });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e as Error)?.name === 'AbortError') return;
        setState((s) => ({ data: s.data, error: errorMessage(e), loading: false }));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ¿El formulario cambió respecto de su estado inicial? (comparación por JSON) */
export function useDirty<T>(value: T): boolean {
  const initial = useRef<string | null>(null);
  const json = useMemo(() => JSON.stringify(value), [value]);
  if (initial.current === null) initial.current = json;
  return json !== initial.current;
}
