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
import { BrowserWindow, app, dialog } from 'electron';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalStore } from '@amara/database';
import { buildClosureTicketData, buildClosureTicketHtml } from '../shared/closure-ticket.ts';
import type { ClosureRecordInput } from '../shared/closure-ticket.ts';
import { buildPermitTicketHtml } from '../shared/permit-ticket.ts';
import type { PermitTicketData } from '../shared/permit-ticket.ts';
import { buildTestTicketHtml, buildTicketHtml, buildTicketPairHtml } from '../shared/ticket-format.ts';
import type { TicketCopy } from '../shared/ticket-format.ts';
import type { AppSettings } from '../shared/settings.ts';
import type { DocPreview, PrintResult, PrinterInfo } from '../shared/ipc.ts';
import { AppError } from './errors.ts';
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

  // ───────────────────────────── v2: vista previa, documentos y PDF ─────────────────────────────

  /** HTML de cada copia tal como se imprimirá (la reimpresión se marca igual que en printTicketNow). */
  async ticketPreview(idOrFolio: string): Promise<DocPreview> {
    const ticket = await this.deps.store.getTicket(idOrFolio);
    if (!ticket) throw new AppError('ticket_no_encontrado', 'No se encontró el ticket guardado.');
    const s = this.deps.getSettings();
    const logoSrc = await this.logoSrc();
    const reprint = ticket.printCount > 0;
    const pages = (['cliente', 'tienda'] as const).map((copy) => ({
      label: copy === 'cliente' ? 'Copia cliente' : 'Copia tienda',
      html: buildTicketHtml(ticket.payload, { paperMm: s.paperMm, copy, logoSrc, reprint, footer: s.ticketFooter }),
    }));
    return { title: `Ticket ${ticket.payload.folio}`, paperMm: s.paperMm, pages };
  }

  /** Datos del ticket de cierre de un corte ya guardado (nombres, sucursal, etiqueta del token). */
  async closureData(sessionId: string) {
    const { store } = this.deps;
    const rec = await store.getClosure(sessionId);
    if (!rec) throw new AppError('cierre_no_encontrado', 'No se encontró ese corte de caja.');
    const branch = await store.db.get<{ name: string }>('SELECT name FROM branches WHERE id = ?', [rec.branchId]);
    const device = await store.getDeviceInfo();
    let tokenLabel: string | null = null;
    if (rec.closeAuthorization?.kind === 'token') {
      tokenLabel = (await store.db.get<{ label: string }>('SELECT label FROM security_tokens_cache WHERE id = ?', [rec.closeAuthorization.tokenId]))?.label ?? null;
    }
    const input: ClosureRecordInput = rec as unknown as ClosureRecordInput;
    return buildClosureTicketData(input, {
      branchName: branch?.name ?? device?.branchCode ?? '',
      terminalCode: device?.terminalCode ?? '',
      tokenLabel,
    });
  }

  async closurePreview(sessionId: string): Promise<DocPreview> {
    const s = this.deps.getSettings();
    const html = buildClosureTicketHtml(await this.closureData(sessionId), { paperMm: s.paperMm, logoSrc: await this.logoSrc() });
    return { title: 'Ticket de cierre de caja', paperMm: s.paperMm, pages: [{ label: 'Cierre de caja', html }] };
  }

  async permitPreview(data: PermitTicketData): Promise<DocPreview> {
    const s = this.deps.getSettings();
    const html = buildPermitTicketHtml(data, { paperMm: s.paperMm, logoSrc: await this.logoSrc() });
    return { title: 'Ticket de permiso', paperMm: s.paperMm, pages: [{ label: 'Ticket de permiso', html }] };
  }

  /** Imprime documentos de UNA página cada uno (cierre, permiso) en la impresora de tickets, en cola. */
  printPages(htmls: string[]): Promise<PrintResult> {
    return this.enqueue(async () => {
      const s = this.deps.getSettings();
      try {
        for (let i = 0; i < htmls.length; i++) {
          await this.printHtml({ html: htmls[i]!, deviceName: s.ticketPrinter, paperWidthMm: s.paperMm, measureHeight: s.printPageSizeMode === 'medido' });
          if (i < htmls.length - 1) await sleep(BETWEEN_COPIES_MS);
        }
        return { ok: true, printedCopies: [] };
      } catch (e) {
        return { ok: false, printedCopies: [], error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  /** PDF del ticket (las dos copias en un documento, una por página). */
  async ticketPdfHtml(idOrFolio: string): Promise<{ html: string; fileName: string }> {
    const ticket = await this.deps.store.getTicket(idOrFolio);
    if (!ticket) throw new AppError('ticket_no_encontrado', 'No se encontró el ticket guardado.');
    const s = this.deps.getSettings();
    const html = buildTicketPairHtml(ticket.payload, { paperMm: s.paperMm, logoSrc: await this.logoSrc(), reprint: ticket.printCount > 0, footer: s.ticketFooter });
    return { html, fileName: `Ticket-${ticket.payload.folio}.pdf` };
  }

  /**
   * Genera un PDF real con webContents.printToPDF (ventana oculta) y pide dónde guardarlo con el diálogo nativo.
   * `size` en milímetros: ancho fijo; si falta el alto se mide el contenido (tickets de rollo).
   * Devuelve la ruta guardada, o null si se canceló el diálogo. NO crea ni modifica ventas.
   */
  savePdf(html: string, fileName: string, size: { widthMm: number; heightMm?: number }): Promise<string | null> {
    return this.enqueue(async () => {
      const pdf = await this.renderPdf(html, size);
      const win = this.deps.getHostWindow();
      const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'documento.pdf';
      const opts = {
        title: 'Guardar PDF',
        defaultPath: join(app.getPath('documents'), safe),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const target = /\.pdf$/i.test(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
      await fsp.writeFile(target, pdf);
      return target;
    });
  }

  private async renderPdf(html: string, size: { widthMm: number; heightMm?: number }): Promise<Buffer> {
    const file = join(tmpdir(), `amara-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
    await fsp.writeFile(file, html, 'utf8');
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    try {
      await win.loadFile(file);
      await sleep(250);
      let heightMm = size.heightMm;
      if (heightMm === undefined) {
        // Alto de UNA página de rollo: el bloque más alto (.pg si hay varias copias; si no, el ticket completo).
        const px = (await win.webContents.executeJavaScript(
          "Math.ceil(Math.max(...Array.from(document.querySelectorAll('.pg, body > .t')).map((e) => e.getBoundingClientRect().height), 0))",
        )) as number;
        heightMm = Math.max(40, (px * 25.4) / 96 + 2);
      }
      // printToPDF recibe pulgadas.
      return await win.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: { width: size.widthMm / 25.4, height: heightMm / 25.4 },
      });
    } finally {
      if (!win.isDestroyed()) win.destroy();
      void fsp.rm(file, { force: true }).catch(() => undefined);
    }
  }

  // ───────────────────────────── interno ─────────────────────────────

  private logoCache: string | null | undefined;

  /**
   * Logo como data: URL. Así el HTML de la vista previa (que se muestra en la interfaz, con CSP estricta) y el de la
   * impresión son EXACTAMENTE el mismo texto, sin depender de rutas de archivo.
   */
  async logoSrc(): Promise<string | undefined> {
    if (this.logoCache === undefined) {
      try {
        const buf = await fsp.readFile(logoTicketPath());
        this.logoCache = `data:image/png;base64,${buf.toString('base64')}`;
      } catch {
        this.logoCache = null;
      }
    }
    return this.logoCache ?? undefined;
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
