/**
 * Impresión de tickets desde el teléfono. HONESTIDAD sobre la compatibilidad:
 *
 *  1. Servicio de impresión de Android (expo-print): imprime en lo que el sistema ya sepa usar
 *     (impresoras de red con servicio Mopria / del fabricante instalado, PDF). Las impresoras
 *     térmicas Bluetooth/ESC-POS normalmente NO aparecen ahí.
 *  2. PC vinculada: el teléfono envía la venta y le pide a la PC que imprima las 2 copias
 *     (cliente y tienda) en SU impresora. Es la ruta recomendada si la PC tiene la impresora térmica.
 *  3. Impresión directa Bluetooth/red (ESC/POS, puerto 9100) requeriría una biblioteca nativa
 *     (p. ej. react-native-thermal-receipt-printer) y un "development build": NO está incluida
 *     ni probada. Ver docs/PENDIENTES-mobile.md.
 *  Si no hay impresora, el ticket queda guardado y se reimprime después con el mismo folio.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { LocalStore, TicketPayload } from '@amara/database';
import type { LanClient } from '@amara/sync';
import { ticketCopiesHtml } from '../lib/ticket-render';
import { lanErrorMessage } from './lan';

export type PrintOutcome = { ok: true; detail: string } | { ok: false; error: string };

/** Servicio de impresión del sistema (diálogo de Android). Las dos copias salen en hojas separadas. */
export async function printWithSystem(store: LocalStore, saleId: string, t: TicketPayload, reprint = false): Promise<PrintOutcome> {
  try {
    await Print.printAsync({ html: ticketCopiesHtml(t, { reprint }) });
    // printAsync no confirma que el papel haya salido: solo que el sistema aceptó el trabajo.
    await store.markPrinted(saleId, ['cliente', 'tienda']);
    return { ok: true, detail: 'Enviado al servicio de impresión del teléfono. Verifica que el papel haya salido.' };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await store.recordPrintFailure(saleId, error);
    return { ok: false, error: `No se pudo imprimir: ${error}` };
  }
}

/** Genera un PDF con las dos copias y abre el menú de compartir (guardar, WhatsApp, correo...). */
export async function sharePdf(t: TicketPayload, reprint = false): Promise<PrintOutcome> {
  try {
    const { uri } = await Print.printToFileAsync({ html: ticketCopiesHtml(t, { reprint }) });
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: 'Este teléfono no permite compartir archivos.' };
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Ticket ${t.folio}` });
    return { ok: true, detail: 'PDF generado.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pide a la PC vinculada imprimir las 2 copias del folio. Antes replica la venta a la PC (si aún está
 * en la cola) para que la PC conozca el folio; la PC la ignora si ya la tenía (idempotente).
 */
export async function printViaPc(store: LocalStore, client: LanClient, saleId: string, folio: string): Promise<PrintOutcome> {
  try {
    const ops = (await store.nextPending(1000)).filter((o) => o.type === 'sale.create' && (o.payload as { sale?: { id?: string } } | null)?.sale?.id === saleId);
    if (ops.length > 0) await client.replicate(ops);
    const r = await client.printTicket(folio);
    if (!r.printed) {
      const error = r.error ?? 'La PC no pudo imprimir.';
      await store.recordPrintFailure(saleId, error);
      return { ok: false, error: `La PC no imprimió: ${error}` };
    }
    await store.markPrinted(saleId, ['cliente', 'tienda']);
    return { ok: true, detail: 'La PC imprimió las 2 copias (cliente y tienda).' };
  } catch (e) {
    const error = lanErrorMessage(e);
    await store.recordPrintFailure(saleId, error);
    return { ok: false, error };
  }
}
