/**
 * Categorías que admiten el botón "Extra" (v2, solo gerente). Se guardan en el servidor (PUT /settings/extra-categories)
 * si hay conexión y siempre quedan en una copia local para esta terminal. La comparación ignora mayúsculas y acentos.
 */
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_EXTRA_CATEGORIES, normalizeCategory, sanitizeExtraCategories } from '@amara/shared';
import { call, errorText } from '../lib/api.ts';
import { useFeedback } from '../state/Feedback.tsx';
import { Banner, Field } from './Field.tsx';

export function ExtraCategoriesCard() {
  const { toast } = useFeedback();
  const [saved, setSaved] = useState<string[] | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    call('extras:get')
      .then((r) => {
        setSaved(r.categories);
        setList(r.categories);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  // Sugerencias: las categorías que existen en el catálogo.
  useEffect(() => {
    call('catalog:categories')
      .then((cats) => setKnown(cats))
      .catch(() => undefined);
  }, []);

  const dirty = saved !== null && JSON.stringify(sanitizeExtraCategories(list)) !== JSON.stringify(sanitizeExtraCategories(saved));
  const isOn = (c: string) => list.some((x) => normalizeCategory(x) === normalizeCategory(c));
  const toggle = (c: string) => setList((cur) => (isOn(c) ? cur.filter((x) => normalizeCategory(x) !== normalizeCategory(c)) : [...cur, c]));
  const extraOnly = useMemo(() => list.filter((c) => !known.some((k) => normalizeCategory(k) === normalizeCategory(c))), [list, known]);

  const add = () => {
    const clean = sanitizeExtraCategories([...list, newName]);
    setList(clean);
    setNewName('');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await call('extras:set', { categories: sanitizeExtraCategories(list) });
      setSaved(r.categories);
      setList(r.categories);
      if (r.savedOnServer) toast('ok', 'Categorías con Extra guardadas.');
      else setNote('Se guardó SOLO en esta terminal porque no hay conexión con el servidor. Cuando sincronice, el servidor puede reemplazarla: vuelve a guardar con internet.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Categorías con botón Extra</h3>
      <p className="muted">En la venta, los productos de estas categorías muestran el botón "Extra" para cobrar un cargo adicional (por ejemplo un bordado). Por omisión: {DEFAULT_EXTRA_CATEGORIES.join(', ')}.</p>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      {note && <Banner kind="warn" onClose={() => setNote(null)}>{note}</Banner>}
      <div className="chips">
        {[...known, ...extraOnly].map((c) => (
          <label key={c} className={isOn(c) ? 'catchip catchip-on' : 'catchip'}>
            <input type="checkbox" checked={isOn(c)} onChange={() => toggle(c)} /> {c}
          </label>
        ))}
        {known.length === 0 && extraOnly.length === 0 && <span className="muted">Cargando categorías...</span>}
      </div>
      <div className="row-gap">
        <Field label="Agregar otra categoría">
          <input className="inp" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Nombre exacto de la categoría" />
        </Field>
        <button className="btn" onClick={add} disabled={!newName.trim()}>Agregar</button>
      </div>
      <div className="row-gap">
        <button className="btn btn-gold" onClick={() => void save()} disabled={!dirty || busy}>{busy ? 'Guardando...' : 'Guardar categorías'}</button>
        <button className="btn" onClick={() => setList([...DEFAULT_EXTRA_CATEGORIES])} disabled={busy}>Usar las de siempre</button>
      </div>
    </section>
  );
}
