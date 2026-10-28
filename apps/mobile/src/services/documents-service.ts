/**
 * Imprimir y compartir/guardar PDF de documentos HTML (cierre, permiso, etiquetas). expo-print + expo-sharing.
 * `printAsync` resuelve cuando el sistema aceptó el trabajo, no cuando salió el papel.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { PrintOutcome } from './printing';

export async function printHtml(html: string, page?: { widthPt: number; heightPt: number }): Promise<PrintOutcome> {
  try {
    await Print.printAsync(page ? { html, width: page.widthPt, height: page.heightPt } : { html });
    return { ok: true, detail: 'Enviado al servicio de impresión del teléfono. Verifica que el papel haya salido.' };
  } catch (e) {
    return { ok: false, error: `No se pudo imprimir: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Genera el PDF y abre el menú de compartir/guardar de Android. */
export async function shareHtmlPdf(html: string, title: string, page?: { widthPt: number; heightPt: number }): Promise<PrintOutcome> {
  try {
    const { uri } = await Print.printToFileAsync(page ? { html, width: page.widthPt, height: page.heightPt } : { html });
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: 'Este teléfono no permite compartir archivos.' };
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    return { ok: true, detail: 'PDF generado.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
