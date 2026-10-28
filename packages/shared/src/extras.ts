/**
 * Configuración de extras (v2): categorías de producto a las que aplica el botón "Extra".
 * La comparación ignora mayúsculas y acentos ("Imágenes" = "imagenes" = "IMÁGENES").
 */

/** Categorías por omisión cuando el gerente aún no ha configurado nada. */
export const DEFAULT_EXTRA_CATEGORIES: readonly string[] = ['Veladoras', 'Pulseras', 'Imágenes', 'Lociones'];

/** Minúsculas, sin acentos ni espacios repetidos, para comparar categorías. */
export function normalizeCategory(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿La categoría del producto está entre las configuradas para llevar extras? */
export function isExtraCategory(category: string | null | undefined, extraCategories: readonly string[] = DEFAULT_EXTRA_CATEGORIES): boolean {
  if (!category) return false;
  const c = normalizeCategory(category);
  return c.length > 0 && extraCategories.some((e) => normalizeCategory(e) === c);
}

/** Limpia la lista que escribe el gerente: recorta, quita vacíos y repetidos (sin distinguir acentos). */
export function sanitizeExtraCategories(list: readonly string[], maxItems = 60, maxLen = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLen);
    const key = normalizeCategory(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= maxItems) break;
  }
  return out;
}
