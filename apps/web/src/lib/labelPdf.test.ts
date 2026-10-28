import { describe, expect, it } from 'vitest';
import { LABEL_SIZES, buildLabelSpecs, type LabelBatchItem } from './labels.ts';
import {
  PAGE_LETTER, PT_MM, barcodeRuns, buildLabelsPdf, clipText, labelsFileName, layoutLabel, pdfSafeText, planSheet, type PdfDeps, type PdfDoc,
} from './labelPdf.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ALL = { showName: true, showPrice: true, showQr: true };

const item = (over: Partial<LabelBatchItem> = {}): LabelBatchItem => ({
  variantId: A, productName: 'Incienso de sándalo con nombre largo', variantLabel: 'Caja 20 varas', barcode: '7501234567890', code: 'AMA00000001', priceCents: 6000, copies: 1, ...over,
});

interface Call { fn: string; args: unknown[] }

/** Documento falso que registra cada llamada de dibujo. */
function fakeDeps(): { deps: PdfDeps; calls: Call[]; created: { format: [number, number]; orientation: string }[]; qrCalls: string[]; barcodeCalls: string[] } {
  const calls: Call[] = [];
  const created: { format: [number, number]; orientation: string }[] = [];
  const qrCalls: string[] = [];
  const barcodeCalls: string[] = [];
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
    return undefined;
  };
  const doc: PdfDoc = {
    addPage: rec('addPage'), setFont: rec('setFont'), setFontSize: rec('setFontSize'), setTextColor: rec('setTextColor'),
    setFillColor: rec('setFillColor'), setDrawColor: rec('setDrawColor'), setLineWidth: rec('setLineWidth'), text: rec('text'),
    rect: rec('rect'), addImage: rec('addImage'), splitTextToSize: (t: string) => [t], output: () => new Blob(['%PDF-fake']),
  };
  const deps: PdfDeps = {
    createDoc: (format, orientation) => {
      created.push({ format, orientation });
      return doc;
    },
    barcode: (v) => {
      barcodeCalls.push(v);
      return '10110';
    },
    qr: async (v) => {
      qrCalls.push(v);
      return 'data:image/png;base64,AAAA';
    },
  };
  return { deps, calls, created, qrCalls, barcodeCalls };
}

const count = (calls: Call[], fn: string) => calls.filter((c) => c.fn === fn).length;
const texts = (calls: Call[]) => calls.filter((c) => c.fn === 'text').map((c) => c.args[0] as string);

describe('paginación de la hoja', () => {
  it('rollo: una etiqueta por página con el tamaño exacto', () => {
    const p = planSheet(3, { widthMm: 50, heightMm: 30 }, true);
    expect(p.pageCount).toBe(3);
    expect([p.pageW, p.pageH]).toEqual([50, 30]);
    expect(p.placements.map((x) => x.page)).toEqual([0, 1, 2]);
    expect(p.placements.every((x) => x.x === 0 && x.y === 0)).toBe(true);
  });
  it('hoja carta: llena por filas y salta de página', () => {
    const p = planSheet(25, { widthMm: 50, heightMm: 30 }, false);
    expect([p.pageW, p.pageH]).toEqual([PAGE_LETTER.w, PAGE_LETTER.h]);
    expect([p.cols, p.rows, p.perPage]).toEqual([3, 8, 24]);
    expect(p.pageCount).toBe(2);
    expect(p.placements[0]).toEqual({ page: 0, x: 8, y: 8 });
    expect(p.placements[1]).toEqual({ page: 0, x: 60, y: 8 });
    expect(p.placements[3]).toEqual({ page: 0, x: 8, y: 40 });
    expect(p.placements[24]).toEqual({ page: 1, x: 8, y: 8 });
  });
  it('ninguna etiqueta se sale de la hoja en ningún tamaño', () => {
    for (const s of LABEL_SIZES) {
      const p = planSheet(200, s, false);
      for (const pl of p.placements) {
        expect(pl.x + s.widthMm).toBeLessThanOrEqual(PAGE_LETTER.w - 8 + 1e-9);
        expect(pl.y + s.heightMm).toBeLessThanOrEqual(PAGE_LETTER.h - 8 + 1e-9);
      }
    }
  });
  it('sin etiquetas: cero páginas', () => {
    expect(planSheet(0, { widthMm: 50, heightMm: 30 }, false).pageCount).toBe(0);
    expect(planSheet(0, { widthMm: 50, heightMm: 30 }, true).pageCount).toBe(0);
  });
});

describe('diseño interno de la etiqueta', () => {
  it('todo cabe dentro de la etiqueta en cada tamaño, con nombre, precio y QR', () => {
    for (const s of LABEL_SIZES) {
      const [spec] = buildLabelSpecs([item()], ALL);
      const l = layoutLabel(s, spec!);
      expect(l.barcode).not.toBeNull();
      const bc = l.barcode!;
      expect(bc.h).toBeGreaterThanOrEqual(5);
      expect(bc.x + bc.w).toBeLessThanOrEqual(s.widthMm);
      expect(l.codeText!.y + l.codeText!.h).toBeLessThanOrEqual(s.heightMm + 1e-9);
      expect(l.qr!.x + l.qr!.size).toBeLessThanOrEqual(s.widthMm);
      expect(l.qr!.y).toBeGreaterThanOrEqual(0);
      expect(l.qr!.y + l.qr!.size).toBeLessThanOrEqual(s.heightMm + 1e-9);
      // El texto no invade al QR.
      expect(bc.x + bc.w).toBeLessThanOrEqual(l.qr!.x);
    }
  });
  it('sin QR el texto y las barras ocupan más ancho', () => {
    const s = LABEL_SIZES[0]!;
    const [con] = buildLabelSpecs([item()], ALL);
    const [sin] = buildLabelSpecs([item()], { ...ALL, showQr: false });
    expect(layoutLabel(s, sin!).qr).toBeNull();
    expect(layoutLabel(s, sin!).barcode!.w).toBeGreaterThan(layoutLabel(s, con!).barcode!.w);
  });
  it('sin nombre no hay título y sin precio no hay precio', () => {
    const s = LABEL_SIZES[0]!;
    const [spec] = buildLabelSpecs([item()], { showName: false, showPrice: false, showQr: true });
    const l = layoutLabel(s, spec!);
    expect(l.title).toBeNull();
    expect(l.price).toBeNull();
    expect(l.barcode!.h).toBeGreaterThan(layoutLabel(s, buildLabelSpecs([item()], ALL)[0]!).barcode!.h);
  });
  it('sin código válido no hay barras y se marca', () => {
    const [spec] = buildLabelSpecs([item({ barcode: '', code: '' })], ALL);
    const l = layoutLabel(LABEL_SIZES[0]!, spec!);
    expect(l.barcode).toBeNull();
    expect(l.missingCode).not.toBeNull();
  });
  it('la tipografía convierte puntos a milímetros', () => {
    expect(PT_MM).toBeCloseTo(0.3528, 3);
  });
});

describe('armado del PDF', () => {
  it('respeta tamaño elegido (rollo) y copias: una página por etiqueta', async () => {
    const f = fakeDeps();
    const size = LABEL_SIZES[1]!; // 40 x 25
    const specs = buildLabelSpecs([item({ copies: 3 })], ALL);
    const r = await buildLabelsPdf(specs, size, true, f.deps);
    expect(r.labelCount).toBe(3);
    expect(r.pageCount).toBe(3);
    expect(f.created).toEqual([{ format: [40, 25], orientation: 'l' }]);
    expect(count(f.calls, 'addPage')).toBe(2);
    expect(f.calls.filter((c) => c.fn === 'addPage').every((c) => (c.args[0] as number[]).join() === '40,25')).toBe(true);
  });
  it('hoja carta: etiquetas de varias variantes en la misma página con contorno de corte', async () => {
    const f = fakeDeps();
    const specs = buildLabelSpecs([item({ copies: 2 }), item({ variantId: B, productName: 'Vela', copies: 2, barcode: '', code: 'AMA00000002' })], ALL);
    const r = await buildLabelsPdf(specs, LABEL_SIZES[0]!, false, f.deps);
    expect(r.pageCount).toBe(1);
    expect(f.created[0]).toEqual({ format: [PAGE_LETTER.w, PAGE_LETTER.h], orientation: 'p' });
    expect(count(f.calls, 'addPage')).toBe(0);
    expect(f.calls.filter((c) => c.fn === 'rect' && c.args[4] === 'S')).toHaveLength(4);
  });
  it('dibuja las barras como rectángulos rellenos y el QR como imagen', async () => {
    const f = fakeDeps();
    const specs = buildLabelSpecs([item()], ALL);
    await buildLabelsPdf(specs, LABEL_SIZES[0]!, true, f.deps);
    // '10110' => dos tramos de barras
    expect(f.calls.filter((c) => c.fn === 'rect' && c.args[4] === 'F')).toHaveLength(2);
    expect(count(f.calls, 'addImage')).toBe(1);
  });
  it('mostrar nombre/precio/QR: lo desactivado no se dibuja ni se codifica', async () => {
    const f = fakeDeps();
    const specs = buildLabelSpecs([item()], { showName: false, showPrice: false, showQr: false });
    await buildLabelsPdf(specs, LABEL_SIZES[0]!, true, f.deps);
    const t = texts(f.calls);
    expect(t.some((x) => x.includes('Incienso'))).toBe(false);
    expect(t.some((x) => x.includes('$'))).toBe(false);
    expect(t).toContain('Caja 20 varas');
    expect(t).toContain('7501234567890');
    expect(count(f.calls, 'addImage')).toBe(0);
    expect(f.qrCalls).toEqual([]);
  });
  it('con todo activo aparecen nombre, precio y código', async () => {
    const f = fakeDeps();
    await buildLabelsPdf(buildLabelSpecs([item()], ALL), LABEL_SIZES[0]!, true, f.deps);
    const t = texts(f.calls);
    expect(t.some((x) => x.startsWith('Incienso'))).toBe(true);
    expect(t.some((x) => x.includes('$60.00'))).toBe(true);
  });
  it('codifica una sola vez cada código y cada QR aunque haya copias', async () => {
    const f = fakeDeps();
    await buildLabelsPdf(buildLabelSpecs([item({ copies: 10 })], ALL), LABEL_SIZES[0]!, true, f.deps);
    expect(f.barcodeCalls).toEqual(['7501234567890']);
    expect(f.qrCalls).toHaveLength(1);
  });
  it('sin código: se avisa en la etiqueta y no se codifica nada', async () => {
    const f = fakeDeps();
    await buildLabelsPdf(buildLabelSpecs([item({ barcode: '', code: '' })], ALL), LABEL_SIZES[0]!, true, f.deps);
    expect(texts(f.calls)).toContain('SIN CODIGO');
    expect(f.barcodeCalls).toEqual([]);
  });
  it('si el codificador falla, la etiqueta lo indica en lugar de salir en blanco', async () => {
    const f = fakeDeps();
    f.deps.barcode = () => null;
    await buildLabelsPdf(buildLabelSpecs([item()], ALL), LABEL_SIZES[0]!, true, f.deps);
    expect(texts(f.calls)).toContain('Codigo no valido');
  });
  it('rechaza un lote vacío', async () => {
    await expect(buildLabelsPdf([], LABEL_SIZES[0]!, false, fakeDeps().deps)).rejects.toThrow();
  });
});

describe('utilidades', () => {
  it('texto seguro para PDF (Latin-1)', () => {
    expect(pdfSafeText('Incienso… “bueno” – ñandú')).toBe('Incienso... "bueno" - ñandú');
    expect(pdfSafeText('Vela 🕯️ roja')).toBe('Vela roja');
    expect(clipText('abcdefghij', 6)).toBe('abc...');
    expect(clipText('abc', 6)).toBe('abc');
  });
  it('tramos de barras', () => {
    expect(barcodeRuns('0110111')).toEqual([{ start: 1, len: 2 }, { start: 4, len: 3 }]);
    expect(barcodeRuns('')).toEqual([]);
    expect(barcodeRuns('1')).toEqual([{ start: 0, len: 1 }]);
  });
  it('nombre del archivo en hora de México', () => {
    expect(labelsFileName('2026-10-22T15:30:00.000Z')).toBe('etiquetas-20261022-0930.pdf');
    expect(labelsFileName('2026-10-22T03:05:00.000Z')).toBe('etiquetas-20261021-2105.pdf');
  });
});
