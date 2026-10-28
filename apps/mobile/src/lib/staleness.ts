/**
 * Aviso de "datos desactualizados". Lógica PURA (sin React Native) para poder probarla.
 *
 * La base local es una copia: el precio y la existencia que se muestran son los de la última
 * sincronización correcta más lo que este teléfono ha hecho después. Mientras más viejo sea ese
 * dato, mayor la probabilidad de que otra terminal haya vendido o recibido mercancía.
 */
export type StaleLevel = 'nunca' | 'reciente' | 'aviso' | 'critico';

export interface StaleInput {
  /** ISO de la última sincronización correcta (meta last_sync_ok_at) o null si nunca. */
  lastSyncOkAt: string | null | undefined;
  nowMs: number;
  /** Operaciones locales aún sin enviar. */
  pending?: number;
  warnAfterMs?: number;
  criticalAfterMs?: number;
}

export interface StaleInfo {
  level: StaleLevel;
  /** Antigüedad en ms (null si nunca se sincronizó o la fecha no es válida). */
  ageMs: number | null;
  /** La última sincronización está "en el futuro": la hora del teléfono es sospechosa. */
  clockSuspect: boolean;
  title: string;
  detail: string;
}

export const DEFAULT_WARN_MS = 60 * 60_000; // 1 hora
export const DEFAULT_CRITICAL_MS = 24 * 60 * 60_000; // 24 horas
/** Tolerancia de desfase de reloj antes de considerarlo sospechoso. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

/** "5 min", "2 h 10 min", "3 días". */
export function humanAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'unos segundos';
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  return d === 1 ? '1 día' : `${d} días`;
}

export function computeStaleness(i: StaleInput): StaleInfo {
  const warn = i.warnAfterMs ?? DEFAULT_WARN_MS;
  const critical = i.criticalAfterMs ?? DEFAULT_CRITICAL_MS;
  const pending = i.pending ?? 0;
  const pendingText = pending > 0 ? ` Hay ${pending} ${pending === 1 ? 'operación' : 'operaciones'} sin enviar al servidor.` : '';

  const t = i.lastSyncOkAt ? Date.parse(i.lastSyncOkAt) : NaN;
  if (!Number.isFinite(t)) {
    return {
      level: 'nunca',
      ageMs: null,
      clockSuspect: false,
      title: 'Sin sincronizar',
      detail: 'Este teléfono nunca ha descargado datos del servidor: precios y existencias pueden no ser reales.' + pendingText,
    };
  }

  const age = i.nowMs - t;
  if (age < -CLOCK_TOLERANCE_MS) {
    return {
      level: 'critico',
      ageMs: null,
      clockSuspect: true,
      title: 'Hora del teléfono inconsistente',
      detail:
        'La última sincronización aparece en el futuro: la fecha y hora del teléfono parecen incorrectas. ' +
        'Corrígelas; mientras tanto no se puede confiar en la vigencia de permisos ni en los resúmenes.' + pendingText,
    };
  }

  const ageMs = Math.max(0, age);
  const ago = `Última sincronización correcta: hace ${humanAge(ageMs)}.`;
  if (ageMs >= critical) {
    return { level: 'critico', ageMs, clockSuspect: false, title: 'Datos desactualizados', detail: `${ago} Precios y existencias pueden haber cambiado; sincroniza en cuanto tengas conexión.${pendingText}` };
  }
  if (ageMs >= warn) {
    return { level: 'aviso', ageMs, clockSuspect: false, title: 'Datos posiblemente desactualizados', detail: `${ago}${pendingText}` };
  }
  return { level: 'reciente', ageMs, clockSuspect: false, title: 'Datos al día', detail: `${ago}${pendingText}` };
}

/** ¿Conviene mostrar un aviso visible (todo lo que no sea "reciente")? */
export function shouldWarn(info: StaleInfo, pending = 0): boolean {
  return info.level !== 'reciente' || pending > 0;
}
