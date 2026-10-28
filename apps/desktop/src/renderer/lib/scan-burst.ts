/**
 * Lector de escáner USB "tipo teclado" por ráfaga de teclas + Enter. Lógica PURA (sin DOM):
 * recibe cada tecla con su marca de tiempo y decide si es parte de una lectura.
 *
 * Idea: un escáner escribe el código completo en pocos milisegundos (<= ~30 ms entre teclas)
 * y termina con Enter; una persona teclea mucho más lento. Se considera LECTURA cuando llegan
 * al menos `minLength` caracteres con intervalos <= `maxGapMs` seguidos de Enter (o Tab).
 *
 * Para que el texto del escáner NO ensucie el campo enfocado (ni active botones con Enter):
 *  - las primeras `swallowAfter - 1` teclas se dejan pasar (aún no se sabe si es escáner),
 *  - desde la `swallowAfter`-ésima tecla rápida se BLOQUEAN (`swallow`),
 *  - al llegar el Enter se devuelve `scan` con `leaked` = cuántas teclas ya pasaron, para que
 *    quien llama borre esos caracteres del campo si quedaron escritos.
 */

export interface BurstConfig {
  /** Máximo de ms entre dos teclas de la misma ráfaga. */
  maxGapMs: number;
  /** Largo mínimo del código para considerarlo lectura. */
  minLength: number;
  maxLength: number;
  /** Desde cuántas teclas rápidas se empiezan a bloquear. */
  swallowAfter: number;
  /** Teclas que cierran la lectura. */
  terminators: readonly string[];
}

export const DEFAULT_BURST_CONFIG: BurstConfig = {
  maxGapMs: 50,
  minLength: 4,
  maxLength: 64,
  swallowAfter: 3,
  terminators: ['Enter', 'Tab'],
};

export interface KeyInfo {
  key: string;
  /** Marca de tiempo en ms (KeyboardEvent.timeStamp). */
  timeStamp: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export type BurstAction =
  /** No es parte de una lectura: dejar pasar el evento tal cual. */
  | { type: 'ignore' }
  /** Posible inicio de lectura: dejar pasar (todavía no se sabe). */
  | { type: 'buffering' }
  /** Ráfaga confirmada: impedir la tecla (preventDefault). */
  | { type: 'swallow' }
  /** Lectura completa: impedir la tecla de cierre y procesar `code`. */
  | { type: 'scan'; code: string; leaked: number };

/** Teclas modificadoras que no rompen una ráfaga (el escáner puede mandar Shift para mayúsculas). */
const PASSIVE_KEYS = new Set(['Shift', 'CapsLock', 'AltGraph']);

export class BurstParser {
  private buf = '';
  private lastTs: number | null = null;
  private leaked = 0;

  constructor(private cfg: BurstConfig = DEFAULT_BURST_CONFIG) {}

  setConfig(cfg: Partial<BurstConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  reset(): void {
    this.buf = '';
    this.lastTs = null;
    this.leaked = 0;
  }

  feed(k: KeyInfo): BurstAction {
    if (k.ctrlKey || k.altKey || k.metaKey) {
      this.reset();
      return { type: 'ignore' };
    }

    // Carácter imprimible (una sola unidad; "Enter", "Shift"... tienen más de una).
    if (k.key.length === 1) {
      const gap = this.lastTs === null ? Number.POSITIVE_INFINITY : k.timeStamp - this.lastTs;
      if (this.buf.length > 0 && gap > this.cfg.maxGapMs) this.reset(); // ráfaga interrumpida: empieza otra
      this.buf += k.key;
      this.lastTs = k.timeStamp;
      if (this.buf.length > this.cfg.maxLength) {
        this.reset();
        return { type: 'ignore' };
      }
      if (this.buf.length >= this.cfg.swallowAfter) return { type: 'swallow' };
      this.leaked = this.buf.length;
      return { type: 'buffering' };
    }

    if (this.cfg.terminators.includes(k.key)) {
      const code = this.buf;
      const leaked = this.leaked;
      const gap = this.lastTs === null ? Number.POSITIVE_INFINITY : k.timeStamp - this.lastTs;
      this.reset();
      if (code.length >= this.cfg.minLength && gap <= this.cfg.maxGapMs) return { type: 'scan', code, leaked };
      return { type: 'ignore' };
    }

    if (PASSIVE_KEYS.has(k.key)) return { type: 'ignore' };

    // Cualquier otra tecla (flechas, Backspace, Escape...) corta la ráfaga.
    this.reset();
    return { type: 'ignore' };
  }
}

/**
 * Compuerta de lecturas repetidas: la MISMA lectura dentro de `windowMs` se considera doble
 * disparo del escáner (o del teléfono) y se ignora. Una pausa mayor cuenta como otra pieza.
 * Cada lectura (aunque se ignore) renueva la ventana: mantener el escáner disparando no suma.
 */
export class ScanGate {
  private last = new Map<string, number>();

  constructor(private windowMs = 700) {}

  /** true = procesar; false = repetida, ignorar. */
  accept(code: string, nowMs: number): boolean {
    const prev = this.last.get(code);
    this.last.set(code, nowMs);
    if (this.last.size > 50) {
      for (const [c, t] of this.last) if (nowMs - t > this.windowMs * 4) this.last.delete(c);
    }
    return prev === undefined || nowMs - prev > this.windowMs;
  }
}
