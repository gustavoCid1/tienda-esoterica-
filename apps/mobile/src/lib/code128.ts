/**
 * Codificador Code 128 (subconjunto B: ASCII 32-126), PURO, sin dependencias.
 * Devuelve las barras como rectángulos para dibujarlas con react-native-svg.
 *
 * Cada símbolo = 3 barras + 3 espacios que suman 11 módulos; el de paro suma 13 (7 elementos).
 * La tabla de anchos es la del estándar ISO/IEC 15417. Las pruebas comprueban propiedades de la tabla
 * (suma 11, paridad de barras, unicidad), pero NO se ha leído con un lector físico: ver docs.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

export class Code128Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Code128Error';
  }
}

/** Valores de símbolo (incluye inicio, datos, control y paro) para un texto. */
export function code128BValues(text: string): number[] {
  if (text.length === 0) throw new Code128Error('El código está vacío.');
  const data: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Code128Error(`El carácter "${ch}" no se puede representar en Code 128 (solo ASCII imprimible).`);
    data.push(c - 32);
  }
  let sum = START_B;
  data.forEach((v, i) => {
    sum += v * (i + 1);
  });
  return [START_B, ...data, sum % 103, STOP];
}

/** Anchos alternados barra/espacio (en módulos), empezando por barra. */
export function code128BWidths(text: string): number[] {
  const widths: number[] = [];
  for (const v of code128BValues(text)) for (const ch of CODE128_PATTERNS[v]!) widths.push(Number(ch));
  return widths;
}

export interface BarRect {
  x: number;
  width: number;
}

export interface Code128Layout {
  bars: BarRect[];
  /** Ancho total en módulos, incluida la zona en blanco a cada lado. */
  totalModules: number;
}

/** Barras posicionadas con zona de silencio (mínimo 10 módulos según el estándar). */
export function code128Layout(text: string, quietModules = 10): Code128Layout {
  const widths = code128BWidths(text);
  const bars: BarRect[] = [];
  let x = quietModules;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, width: w });
    x += w;
  });
  return { bars, totalModules: x + quietModules };
}
