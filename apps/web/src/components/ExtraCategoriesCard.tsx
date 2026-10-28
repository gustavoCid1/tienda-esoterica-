/**
 * Configuración (gerente): categorías que admiten el cargo "Extra" al cobrar (GET/PUT
 * /settings/extra-categories). Por omisión: Veladoras, Pulseras, Imágenes y Lociones. Escritorio y
 * móvil reciben la lista en la sincronización (`settings.extraCategories`).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { errorMessage, useAsync } from '../lib/hooks.ts';
import {
  DEFAULT_EXTRA_CATEGORIES, MAX_CATEGORY_LENGTH, addCategory, normalizeExtraCategories, removeCategory, sameCategories,
} from '../lib/extras.ts';
import { Alert, Card, Empty, ErrorBox, Spinner } from './ui.tsx';
import { useToast } from '../context.tsx';

export function ExtraCategoriesCard() {
  const { notify } = useToast();
  const res = useAsync((s) => api.get<unknown>('/settings/extra-categories', undefined, s).then(normalizeExtraCategories), []);
  const [saved, setSaved] = useState<string[]>([]);
  const [list, setList] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (res.data) {
      setSaved(res.data);
      setList(res.data);
    }
  }, [res.data]);

  const dirty = !sameCategories(list, saved);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const r = addCategory(list, name);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setList(r.list);
    setName('');
    setError('');
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<unknown>('/settings/extra-categories', { categories: list });
      // Si el servidor devuelve la lista normalizada, esa es la verdad; si no, lo enviado.
      const confirmed = r && typeof r === 'object' && 'categories' in (r as object) ? normalizeExtraCategories(r) : list;
      setSaved(confirmed);
      setList(confirmed);
      notify('Categorías de Extra guardadas.');
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Extras: categorías que admiten el cargo Extra">
      <p className="muted small">
        En el cobro, el botón <strong>Extra</strong> solo aparece en productos de estas categorías. La comparación no distingue mayúsculas ni acentos. Por omisión: {DEFAULT_EXTRA_CATEGORIES.join(', ')}.
      </p>
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <>
          {list.length === 0 ? (
            <Empty>No hay categorías: el botón Extra no aparecerá en ningún producto.</Empty>
          ) : (
            <div className="chips">
              {list.map((c) => (
                <span className="chip chip-tag" key={c}>
                  {c}
                  <button type="button" aria-label={`Quitar ${c}`} onClick={() => setList((l) => removeCategory(l, c))}>&times;</button>
                </span>
              ))}
            </div>
          )}
          <form className="input-action extra-add" onSubmit={add} noValidate>
            <input value={name} maxLength={MAX_CATEGORY_LENGTH} placeholder="Nueva categoría (ej. Velas)" aria-label="Nueva categoría" onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-sm">Agregar</button>
          </form>
          {error && <p className="field-error">{error}</p>}
          {dirty && <Alert tone="warn">Hay cambios sin guardar.</Alert>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Guardando...' : 'Guardar categorías'}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setList([...DEFAULT_EXTRA_CATEGORIES])}>Restablecer a las de fábrica</button>
            <button type="button" className="btn btn-ghost" disabled={!dirty || busy} onClick={() => setList(saved)}>Descartar cambios</button>
          </div>
        </>
      )}
    </Card>
  );
}
