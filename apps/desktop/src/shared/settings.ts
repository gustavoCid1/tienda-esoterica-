/**
 * Ajustes de la terminal (archivo config.json en la carpeta de datos). Lógica PURA:
 * valida y rellena valores por omisión para que un archivo editado a mano o de una
 * versión anterior nunca rompa la aplicación.
 */
export type PaperMm = 58 | 80;

export interface RetentionSettings {
  /** Cuántas copias recientes se conservan siempre (a 2 h por copia, 24 = 2 días). */
  keepRecent: number;
  /** Además, la última copia de cada uno de los N días más recientes. */
  keepDaily: number;
  /** Además, la última copia de cada uno de los N meses más recientes. */
  keepMonthly: number;
}

export interface AppSettings {
  /** URL base de la API central (sin "/" final). Vacío = trabajar solo en local. */
  apiUrl: string;
  /** Nombre EXACTO de la impresora de tickets en Windows ('' = predeterminada). */
  ticketPrinter: string;
  /** Impresora de etiquetas ('' = predeterminada). */
  labelPrinter: string;
  paperMm: PaperMm;
  /**
   * 'driver': se usa el tamaño de papel del controlador de la impresora (recomendado en rollos).
   * 'medido': se mide el alto del ticket y se envía como tamaño de página personalizado.
   */
  printPageSizeMode: 'driver' | 'medido';
  /** Imprimir las dos copias automáticamente al guardar la venta. */
  autoPrint: boolean;
  labelWidthMm: number;
  labelHeightMm: number;
  backupDir: string;
  /** Segundo destino (USB / carpeta externa). '' = sin segundo destino. */
  backupSecondaryDir: string;
  backupIntervalMin: number;
  retention: RetentionSettings;
  /** Servidor LAN para vincular el teléfono como escáner. */
  lanEnabled: boolean;
  /** Intervalo máximo entre teclas para considerar una lectura de escáner USB (ms). */
  scannerMaxGapMs: number;
  scannerMinLength: number;
  ticketFooter: string;
}

export function defaultSettings(documentsDir: string): AppSettings {
  return {
    apiUrl: '',
    ticketPrinter: '',
    labelPrinter: '',
    paperMm: 80,
    printPageSizeMode: 'driver',
    autoPrint: true,
    labelWidthMm: 50,
    labelHeightMm: 30,
    backupDir: joinPath(documentsDir, 'Esoterica Amara', 'Respaldos'),
    backupSecondaryDir: '',
    backupIntervalMin: 120,
    retention: { keepRecent: 24, keepDaily: 14, keepMonthly: 6 },
    lanEnabled: true,
    scannerMaxGapMs: 50,
    scannerMinLength: 4,
    ticketFooter: 'Gracias por su compra',
  };
}

function joinPath(...parts: string[]): string {
  // Sin depender de node:path para poder usarse en pruebas; separador de Windows si la ruta lo usa.
  const sep = parts[0]!.includes('\\') ? '\\' : '/';
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join(sep);
}

const str = (v: unknown, fallback: string, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** URL válida http(s) sin "/" final, o '' si no es válida. */
export function normalizeApiUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim().replace(/\/+$/, '');
  if (!t) return '';
  return /^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(t) ? t : '';
}

/** Mezcla lo guardado con los valores por omisión, validando cada campo. */
export function normalizeSettings(raw: unknown, defaults: AppSettings): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ret = (r.retention && typeof r.retention === 'object' ? r.retention : {}) as Record<string, unknown>;
  return {
    apiUrl: r.apiUrl === undefined ? defaults.apiUrl : normalizeApiUrl(r.apiUrl),
    ticketPrinter: str(r.ticketPrinter, defaults.ticketPrinter),
    labelPrinter: str(r.labelPrinter, defaults.labelPrinter),
    paperMm: r.paperMm === 58 ? 58 : r.paperMm === 80 ? 80 : defaults.paperMm,
    printPageSizeMode: r.printPageSizeMode === 'medido' ? 'medido' : r.printPageSizeMode === 'driver' ? 'driver' : defaults.printPageSizeMode,
    autoPrint: bool(r.autoPrint, defaults.autoPrint),
    labelWidthMm: int(r.labelWidthMm, defaults.labelWidthMm, 20, 120),
    labelHeightMm: int(r.labelHeightMm, defaults.labelHeightMm, 15, 120),
    backupDir: str(r.backupDir, defaults.backupDir, 500) || defaults.backupDir,
    backupSecondaryDir: str(r.backupSecondaryDir, defaults.backupSecondaryDir, 500),
    backupIntervalMin: int(r.backupIntervalMin, defaults.backupIntervalMin, 15, 1440),
    retention: {
      keepRecent: int(ret.keepRecent, defaults.retention.keepRecent, 1, 500),
      keepDaily: int(ret.keepDaily, defaults.retention.keepDaily, 0, 365),
      keepMonthly: int(ret.keepMonthly, defaults.retention.keepMonthly, 0, 120),
    },
    lanEnabled: bool(r.lanEnabled, defaults.lanEnabled),
    scannerMaxGapMs: int(r.scannerMaxGapMs, defaults.scannerMaxGapMs, 20, 200),
    scannerMinLength: int(r.scannerMinLength, defaults.scannerMinLength, 2, 20),
    ticketFooter: str(r.ticketFooter, defaults.ticketFooter, 120),
  };
}
