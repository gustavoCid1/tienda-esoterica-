import { describe, expect, it } from 'vitest';
import {
  addToBatch, barcodeValueOf, buildLabelSpecs, clampCopies, findDuplicateCodes, isCode128Printable,
  truncate, type LabelBatchItem,
} from './labels.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const opts = { showName: true, showPrice: true, showQr: true };

const item = (over: Partial<LabelBatchItem> = {}): LabelBatchItem => ({
  variantId: A, productName: 'Incienso de sándalo', variantLabel: 'Caja 20 varas', barcode: '7501234567890', code: 'AMA00000001', priceCents: 6000, copies: 1, ...over,
});

describe('valor del código', () => {
  it('prefiere el código de barras y cae al interno', () => {
    expect(barcodeValueOf({ barcode: ' 750123 ', code: 'AMA00000001' })).toBe('750123');
    expect(barcodeValueOf({ barcode: '', code: 'AMA00000001' })).toBe('AMA00000001');
    expect(barcodeValueOf({ barcode: null, code: null })).toBe('');
  });
  it('Code 128 solo admite ASCII imprimible', () => {
    expect(isCode128Printable('AMA00000001')).toBe(true);
    expect(isCode128Printable('café')).toBe(false);
    expect(isCode128Printable('')).toBe(false);
  });
});

describe('lotes y duplicados', () => {
  it('detecta el mismo código en variantes distintas (sin distinguir mayúsculas)', () => {
    const d = findDuplicateCodes([
      { variantId: A, barcode: 'abc123', code: null },
      { variantId: B, barcode: 'ABC123', code: null },
    ]);
    expect([...d]).toEqual(['ABC123']);
    expect(findDuplicateCodes([{ variantId: A, barcode: 'X', code: null }, { variantId: A, barcode: 'X', code: null }]).size).toBe(0);
  });
  it('expande copias y arma contenido de QR y precio', () => {
    const specs = buildLabelSpecs([item({ copies: 3 })], opts);
    expect(specs).toHaveLength(3);
    expect(specs[0]!.priceText).toBe('$60.00');
    expect(specs[0]!.qrValue).toBe(`amara:v1:${A}`);
    expect(specs[0]!.barcodeValue).toBe('7501234567890');
    expect(new Set(specs.map((s) => s.key)).size).toBe(3);
  });
  it('respeta opciones y copias mínimas', () => {
    const [s] = buildLabelSpecs([item({ copies: 0 })], { showName: false, showPrice: false, showQr: false });
    expect(s!.title).toBe('');
    expect(s!.priceText).toBeNull();
    expect(s!.qrValue).toBeNull();
  });
  it('advierte códigos ausentes, inválidos y duplicados', () => {
    expect(buildLabelSpecs([item({ barcode: '', code: '' })], opts)[0]!.warnings[0]).toContain('Sin código');
    expect(buildLabelSpecs([item({ barcode: 'ñandú' })], opts)[0]!.warnings[0]).toContain('Code 128');
    const dup = buildLabelSpecs([item({ barcode: 'X1' }), item({ variantId: B, barcode: 'X1' })], opts);
    expect(dup.every((s) => s.duplicate)).toBe(true);
  });
  it('agrega al lote sumando copias sin mutar', () => {
    const batch = [item({ copies: 2 })];
    const next = addToBatch(batch, item(), 3);
    expect(next[0]!.copies).toBe(5);
    expect(batch[0]!.copies).toBe(2);
    expect(addToBatch(next, item({ variantId: B }))).toHaveLength(2);
  });
  it('limita copias y recorta textos', () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(999)).toBe(200);
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });
});

import { rowToLabelSource } from './labels.ts';

describe('rowToLabelSource', () => {
  it('requiere identificador de variante y completa faltantes', () => {
    expect(rowToLabelSource({ productName: 'x' })).toBeNull();
    expect(rowToLabelSource({ variantId: A })).toEqual({
      variantId: A, productName: '', variantLabel: '', barcode: null, code: null, priceCents: 0,
    });
  });
});
