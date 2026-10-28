/**
 * Impresión térmica y de etiquetas.
 *
 * REGLAS (spec):
 *  - La venta se guarda en SQLite ANTES de imprimir (sales:create ya hizo COMMIT cuando la
 *    interfaz pide imprimir). Aquí NUNCA se crea ni se modifica una venta.
 *  - Se imprimen DOS copias consecutivas del MISMO folio: COPIA CLIENTE y COPIA TIENDA.
 *  - Si la impresión falla -> recordPrintFailure(saleId, motivo) y la interfaz ofrece
 *    "Reimprimir" (print:ticket otra vez), que reimprime el ticket guardado sin crear venta.
 *  - Las impresiones se SERIALIZAN en una cola: dos folios nunca se intercalan.
 *
 * Mecanismo: ventana oculta que carga el HTML del ticket (archivo temporal) y
 * webContents.print({ silent: true, deviceName }). "Éxito" = el trabajo se entregó al
 * controlador/cola de Windows; NO garantiza que haya papel ni que el rollo haya salido
 * (ver docs/PENDIENTES-desktop.md: probar con la impresora real).
 */
import { BrowserWindow } from 'electron';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LocalStore } from '@amara/database';
import { buildTestTicketHtml, buildTicketHtml } from '../shared/ticket-format.ts';
import type { TicketCopy } from '../shared/ticket-format.ts';
import type { AppSettings } from '../shared/settings.ts';
import type { PrintResult, PrinterInfo } from '../shared/ipc.ts';
import { logoTicketPath } from './paths.ts';

const PRINT_TIMEOUT_MS = 30_000;
const BETWEEN_COPIES_MS = 500;

interface HtmlJob {
  html: string;
  deviceName: string;
  /** Tamaño de página en micrómetros (solo con printPageSizeMode = 'medido' o etiquetas). */
  pageSizeMm?: { width: number; height: number };
  /** Medir el alto del contenido y usarlo como alto de página. */
  measureHeight?: boolean;
  paperWidthMm?: number;
}

export class PrintService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private deps: { store: LocalStore; getSettings: () => AppSettings; getHostWindow: () => BrowserWindow | null }) {}

  /** Todas las impresiones pasan por una sola cola. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    const win = this.deps.getHostWindow();
    if (!win) return [];
    const list = await win.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  }

  /** Imprime las copias indicadas (por omisión las dos) de un ticket YA GUARDADO. */
  printTicket(idOrFolio: string, opts: { copies?: TicketCopy[]; reprint?: boolean } = {}): Promise<PrintResult> {
    return this.enqueue(() => this.printTicketNow(idOrFolio, opts));
  }

  private async printTicketNow(idOrFolio: string, opts: { copies?: TicketCopy[]; reprint?: boolean }): Promise<PrintResult> {
    const { store } = this.deps;
    const ticket = await store.getTicket(idOrFolio);
    if (!ticket) return { ok: false, printedCopies: [], error: 'No se encontró el ticket guardado.' };
    const s = this.deps.getSettings();
    const copies: TicketCopy[] = opts.copies && opts.copies.length > 0 ? opts.copies : ['cliente', 'tienda'];
    const reprint = opts.reprint ?? ticket.printCount > 0;
    const printed: TicketCopy[] = [];

    for (let i = 0; i < copies.length; i++) {
      const copy = copies[i]!;
      const html = buildTicketHtml(ticket.payload, {
        paperMm: s.paperMm,
        copy,
        logoSrc: await this.logoSrc(),
        reprint,
        footer: s.ticketFooter,
      });
      try {
        await this.printHtml({
          html,
          deviceName: s.ticketPrinter,
          paperWidthMm: s.paperMm,
          measureHeight: s.printPageSizeMode === 'medido',
        });
        printed.push(copy);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const full = `Falló la impresión de la copia ${copy.toUpperCase()}: ${msg}`;
        await store.recordPrintFailure(ticket.saleId, full).catch(() => undefined);
        if (printed.length > 0) await store.markPrinted(ticket.saleId, printed).catch(() => undefined);
        return { ok: false, printedCopies: printed, error: full };
      }
      if (i < copies.length - 1) await sleep(BETWEEN_COPIES_MS);
    }
    await store.markPrinted(ticket.saleId, printed);
    return { ok: true, printedCopies: printed };
  }

  /** Ticket de prueba (no consume folio ni crea venta). */
  printTest(target: 'ticket' | 'label'): Promise<PrintResult> {
    return this.enqueue(async () => {
      const s = this.deps.getSettings();
      try {
        if (target === 'ticket') {
          const html = buildTestTicketHtml({ paperMm: s.paperMm, printerName: s.ticketPrinter, logoSrc: await this.logoSrc(), now: new Date().toISOString() });
          await this.printHtml({ html, deviceName: s.ticketPrinter, paperWidthMm: s.paperMm, measureHeight: s.printPageSizeMode === 'medido' });
        } else {
          const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${s.labelWidthMm}mm ${s.labelHeightMm}mm;margin:0}body{margin:0;font-family:Arial}div{width:${s.labelWidthMm}mm;height:${s.labelHeightMm}mm;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9pt;font-weight:bold}</style></head><body><div>PRUEBA DE ETIQUETA<br>${s.labelWidthMm} x ${s.labelHeightMm} mm</div></body></html>`;
          await this.printHtml({ html, deviceName: s.labelPrinter, pageSizeMm: { width: s.labelWidthMm, height: s.labelHeightMm } });
        }
        return { ok: true, printedCopies: [] };
      } catch (e) {
        return { ok: false, printedCopies: [], error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  /** Imprime una hoja de etiquetas ya armada por la interfaz (SVG de Code128 y QR). */
  printLabels(html: string, widthMm: number, heightMm: number): Promise<PrintResult> {
    return this.enqueue(async () => {
      const s = this.deps.getSettings();
      try {
        await this.printHtml({ html, deviceName: s.labelPrinter, pageSizeMm: { width: widthMm, height: heightMm } });
        return { ok: true, printedCopies: [] };
      } catch (e) {
        return { ok: false, printedCopies: [], error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  // ───────────────────────────── interno ─────────────────────────────

  private async logoSrc(): Promise<string | undefined> {
    try {
      const p = logoTicketPath();
      await fsp.access(p);
      return pathToFileURL(p).href;
    } catch {
      return undefined;
    }
  }

  /** Carga el HTML en una ventana oculta y lo envía a la impresora. Lanza Error con texto en español. */
  private async printHtml(job: HtmlJob): Promise<void> {
    const file = join(tmpdir(), `amara-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
    await fsp.writeFile(file, job.html, 'utf8');
    const win = new BrowserWindow({
      show: false,
      width: 600,
      height: 800,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    try {
      await win.loadFile(file);
      await sleep(200); // deja pintar imágenes (logo) y SVG antes de imprimir

      let pageSize: { width: number; height: number } | undefined;
      if (job.pageSizeMm) {
        pageSize = { width: Math.round(job.pageSizeMm.width * 1000), height: Math.round(job.pageSizeMm.height * 1000) };
      } else if (job.measureHeight && job.paperWidthMm) {
        const px = (await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) as number;
        const heightMm = Math.max(40, Math.ceil((px * 25.4) / 96) + 8);
        pageSize = { width: job.paperWidthMm * 1000, height: heightMm * 1000 };
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('La impresora no respondió a tiempo (30 s). Revisa que esté encendida y sin atascos.')), PRINT_TIMEOUT_MS);
        win.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: job.deviceName || undefined,
            margins: { marginType: 'none' },
            ...(pageSize ? { pageSize } : {}),
          },
          (success, failureReason) => {
            clearTimeout(timer);
            if (success) resolve();
            else reject(new Error(`No se pudo imprimir (${failureReason || 'sin detalle'}). Revisa que la impresora esté encendida, con papel y bien elegida en Ajustes.`));
          },
        );
      });
    } finally {
      if (!win.isDestroyed()) win.destroy();
      void fsp.rm(file, { force: true }).catch(() => undefined);
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
