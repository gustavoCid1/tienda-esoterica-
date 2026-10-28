import React from 'react';
import { PixelRatio } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { code128Layout } from '../lib/code128';

/** Zona blanca a cada lado (en módulos). El estándar pide 10; el margen blanco de la tarjeta completa el resto. */
const QUIET = 8;

/**
 * Código de barras Code 128 dibujado con react-native-svg a partir de lib/code128 (puro).
 * El ancho de cada módulo se ajusta a PÍXELES ENTEROS de la pantalla para que las barras salgan nítidas.
 * `value` solo admite ASCII imprimible (usa canEncodeCode128 para saberlo antes de renderizar).
 * NO se ha verificado con un lector físico (ver docs/PENDIENTES-mobile.md).
 */
export function Code128Svg({ value, height = 90, maxWidth = 290 }: { value: string; height?: number; maxWidth?: number }) {
  const { bars, totalModules } = code128Layout(value, QUIET);
  const ratio = PixelRatio.get();
  const modulePx = Math.max(1, Math.floor((maxWidth * ratio) / totalModules));
  const width = (modulePx * totalModules) / ratio;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${totalModules} 10`} preserveAspectRatio="none">
      <Rect x={0} y={0} width={totalModules} height={10} fill="#FFFFFF" />
      {bars.map((b, i) => (
        <Rect key={i} x={b.x} y={0} width={b.width} height={10} fill="#000000" />
      ))}
    </Svg>
  );
}

/** ¿Se puede dibujar este texto como Code 128? */
export function canEncodeCode128(value: string): boolean {
  try {
    code128Layout(value, QUIET);
    return true;
  } catch {
    return false;
  }
}
