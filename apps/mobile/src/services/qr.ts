/**
 * Matriz de módulos de un QR para dibujarlo en las etiquetas (HTML/PDF). Usa el núcleo de la librería `qrcode`
 * (la misma que react-native-qrcode-svg). POR VERIFICAR en un teléfono: ver docs/PENDIENTES-v2-mobile.md.
 */
import * as QRCodeCore from 'qrcode/lib/core/qrcode';

export function qrMatrix(text: string): boolean[][] {
  const { modules } = QRCodeCore.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(!!modules.get(r, c));
    rows.push(row);
  }
  return rows;
}
