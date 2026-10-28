/** Tipos mínimos del núcleo de la librería `qrcode` (JavaScript puro, sin canvas ni Node). Es lo mismo que usa react-native-qrcode-svg. */
declare module 'qrcode/lib/core/qrcode' {
  export interface QrBitMatrix {
    size: number;
    data: ArrayLike<number>;
    get(row: number, col: number): number;
  }
  export function create(data: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: QrBitMatrix };
}
