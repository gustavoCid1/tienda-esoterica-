/**
 * Categorías que admiten el cargo "Extra" (GET/PUT /settings/extra-categories). Lógica pura
 * (extras.test.ts). La comparación ignora mayúsculas y acentos, igual que el contrato.
 */

export const DEFAULT_EXTRA_CATEGORIES: readonly string[] = ['Veladoras', 'Pulseras', 'Imágenes', 'Lociones'];
export const MAX_EXTRA_CATEGORIES = 40;
export const MAX_CATEGORY_LENGTH = 40;

/** Minúsculas y sin acentos ("Imágenes" -> "imagenes"), para comparar. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Limpia una lista cualquiera: solo textos, sin vacíos ni repetidos (se queda el primero). */
export function cleanCategories(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of list) {
    if (typeof it !== 'string') continue;
    const name = it.replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_LENGTH);
    const key = foldText(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, MAX_EXTRA_CATEGORIES);
}

/** Respuesta de GET: `{ categories }` o directamente el arreglo. Sin datos válidos -> valores por defecto. */
export function normalizeExtraCategories(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as { categories?: unknown }).categories : undefined;
  return Array.isArray(list) ? cleanCategories(list) : [...DEFAULT_EXTRA_CATEGORIES];
}

export type AddResult = { ok: true; list: string[] } | { ok: false; error: string };

/** Agrega una categoría validando longitud, repetidos y tope. */
export function addCategory(list: string[], name: string): AddResult {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 2) return { ok: false, error: 'Escribe el nombre de la categoría (mínimo 2 letras).' };
  if (clean.length > MAX_CATEGORY_LENGTH) return { ok: false, error: `El nombre es demasiado largo (máximo ${MAX_CATEGORY_LENGTH}).` };
  if (list.some((c) => foldText(c) === foldText(clean))) return { ok: false, error: 'Esa categoría ya está en la lista.' };
  if (list.length >= MAX_EXTRA_CATEGORIES) return { ok: false, error: `Máximo ${MAX_EXTRA_CATEGORIES} categorías.` };
  return { ok: true, list: [...list, clean] };
}

export function removeCategory(list: string[], name: string): string[] {
  const key = foldText(name);
  return list.filter((c) => foldText(c) !== key);
}

/** ¿Son la misma lista (sin importar el orden, mayúsculas ni acentos)? */
export function sameCategories(a: string[], b: string[]): boolean {
  const ka = a.map(foldText).sort();
  const kb = b.map(foldText).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** ¿La categoría de un producto admite el cargo Extra? */
export function admitsExtra(category: string, categories: string[]): boolean {
  const key = foldText(category);
  return key !== '' && categories.some((c) => foldText(c) === key);
}
