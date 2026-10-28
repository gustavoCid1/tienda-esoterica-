import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRA_CATEGORIES, addCategory, admitsExtra, cleanCategories, foldText, normalizeExtraCategories, removeCategory, sameCategories } from './extras.ts';

describe('categorías de Extra', () => {
  it('valores por defecto del contrato', () => {
    expect([...DEFAULT_EXTRA_CATEGORIES]).toEqual(['Veladoras', 'Pulseras', 'Imágenes', 'Lociones']);
    expect(normalizeExtraCategories(undefined)).toEqual(['Veladoras', 'Pulseras', 'Imágenes', 'Lociones']);
    expect(normalizeExtraCategories({ nada: 1 })).toEqual(['Veladoras', 'Pulseras', 'Imágenes', 'Lociones']);
  });
  it('lee { categories } o un arreglo, y puede quedar vacía a propósito', () => {
    expect(normalizeExtraCategories({ categories: ['Velas'] })).toEqual(['Velas']);
    expect(normalizeExtraCategories(['A1', 'B1'])).toEqual(['A1', 'B1']);
    expect(normalizeExtraCategories({ categories: [] })).toEqual([]);
  });
  it('compara sin mayúsculas ni acentos', () => {
    expect(foldText('  Imágenes ')).toBe('imagenes');
    expect(admitsExtra('IMAGENES', ['Imágenes'])).toBe(true);
    expect(admitsExtra('Velas', ['Imágenes'])).toBe(false);
    expect(admitsExtra('', ['Imágenes'])).toBe(false);
  });
  it('limpia repetidos y valores que no son texto', () => {
    expect(cleanCategories(['Velas', 'velas', ' ', 5, null, 'Sahumerios'])).toEqual(['Velas', 'Sahumerios']);
  });
  it('alta: valida longitud y repetidos', () => {
    const base = ['Velas'];
    expect(addCategory(base, ' Pulseras ')).toEqual({ ok: true, list: ['Velas', 'Pulseras'] });
    expect(addCategory(base, 'velas')).toMatchObject({ ok: false });
    expect(addCategory(base, 'a')).toMatchObject({ ok: false });
    expect(addCategory(base, 'x'.repeat(50))).toMatchObject({ ok: false });
    expect(base).toEqual(['Velas']);
  });
  it('baja y comparación de listas', () => {
    expect(removeCategory(['Imágenes', 'Velas'], 'imagenes')).toEqual(['Velas']);
    expect(sameCategories(['A1', 'B1'], ['b1', 'a1'])).toBe(true);
    expect(sameCategories(['A1'], ['A1', 'B1'])).toBe(false);
  });
});
