/** Configuración global guardada en la colección `settings` (un documento por llave). */
import { DEFAULT_EXTRA_CATEGORIES, sanitizeExtraCategories } from '@amara/shared';
import { col } from './db.ts';

export const EXTRA_CATEGORIES_KEY = 'extraCategories';

/** Categorías que admiten "Extra". Sin configuración guardada, las de fábrica. */
export async function getExtraCategories(): Promise<string[]> {
  const d = await col('settings').findOne({ _id: EXTRA_CATEGORIES_KEY as any });
  if (!d || !Array.isArray(d.value)) return [...DEFAULT_EXTRA_CATEGORIES];
  return sanitizeExtraCategories(d.value as string[]);
}

export async function setExtraCategories(categories: string[], userId: string): Promise<string[]> {
  const clean = sanitizeExtraCategories(categories);
  await col('settings').updateOne(
    { _id: EXTRA_CATEGORIES_KEY as any },
    { $set: { value: clean, updatedAt: new Date().toISOString(), updatedBy: userId } },
    { upsert: true },
  );
  return clean;
}
