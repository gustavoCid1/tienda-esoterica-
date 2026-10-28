/** /settings (v2): configuración editable por el gerente. Hoy: categorías que admiten "Extra". */
import { Router } from 'express';
import { extraCategoriesSchema } from '@amara/shared/schemas';
import { audit } from '../audit.ts';
import { requirePerm } from '../auth.ts';
import { ah, parse } from '../http.ts';
import { getExtraCategories, setExtraCategories } from '../settings.ts';
import { sessionUser } from '../util.ts';

export const settingsRouter = Router();

/** Cualquier sesión de usuario (el vendedor la necesita para mostrar el botón Extra). */
settingsRouter.get(
  '/extra-categories',
  ah(async (_req, res) => {
    res.json({ categories: await getExtraCategories() });
  }),
);

settingsRouter.put(
  '/extra-categories',
  requirePerm('config.editar'),
  ah(async (req, res) => {
    const me = sessionUser(req);
    const body = parse(extraCategoriesSchema, req.body);
    const before = await getExtraCategories();
    const categories = await setExtraCategories(body.categories, me.id);
    await audit({ userId: me.id, action: 'config.categorias_extra', entity: 'setting', entityId: 'extraCategories', detail: { before, after: categories } });
    res.json({ categories });
  }),
);
