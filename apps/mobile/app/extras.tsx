/**
 * Extras (SOLO administrador): categorías de producto que muestran el botón "Extra" al cobrar.
 * Se leen y guardan en el servidor (GET/PUT /settings/extra-categories); el teléfono las recibe al sincronizar.
 * Las opciones salen del catálogo local; las que ya estén guardadas se muestran aunque ninguna variante las use hoy.
 */
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { sanitizeExtraCategories } from '@amara/shared';
import { Banner, Button, Card, Chip, ChipRow, H1, H2, Loading, Muted, Screen } from '../src/components/ui';
import { distinctCategories, isSelectedCategory, parseExtraCategories, toggleCategory } from '../src/lib/misc-v2';
import { useApp } from '../src/state/AppContext';

export default function Extras() {
  const app = useApp();
  const { store, device, session, online, api } = app;
  const [selected, setSelected] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fromServer, setFromServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const canUse = online && !!session?.token;

  const load = useCallback(async () => {
    if (!store || !device) return;
    try {
      const hits = await store.inventoryList({ branchId: device.branchId, limit: 5000 });
      setCatalog(hits.map((h) => h.category));
    } catch {
      setCatalog([]);
    }
    let cats: string[] | null = null;
    if (canUse) {
      try {
        cats = parseExtraCategories(await api.get<unknown>('/settings/extra-categories'));
        if (cats) setFromServer(true);
      } catch {
        cats = null;
      }
    }
    if (!cats) {
      cats = await store.getExtraCategories();
      setFromServer(false);
      setMsg({ kind: 'warn', text: canUse ? 'No se pudo leer del servidor: se muestran las categorías guardadas en el teléfono.' : 'Sin conexión: se muestran las categorías guardadas en el teléfono. Para cambiarlas se necesita internet.' });
    }
    setSelected(cats);
    setLoaded(true);
  }, [store, device, canUse, api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!session || !store) return <Loading />;
  if (!app.can('config.editar')) return <Screen><Banner kind="error" text="Solo el administrador puede elegir las categorías de Extras." /></Screen>;
  if (!loaded) return <Loading />;

  const options = distinctCategories([...catalog, ...selected]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.put<unknown>('/settings/extra-categories', { categories: sanitizeExtraCategories(selected) });
      const saved = parseExtraCategories(res);
      if (saved) setSelected(saved);
      setMsg({ kind: 'ok', text: 'Guardado. Los teléfonos lo recibirán al sincronizar.' });
      void app.syncNow('manual');
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Extras</H1>
      <Muted>Los productos de las categorías marcadas muestran el botón "Extra" al cobrar (monto y nota).</Muted>
      <Card>
        <H2>Categorías con Extra</H2>
        {options.length === 0 ? <Muted>No hay categorías en el catálogo de este teléfono.</Muted> : null}
        <ChipRow>
          {options.map((c) => (
            <Chip key={c} label={c} selected={isSelectedCategory(selected, c)} onPress={() => setSelected(toggleCategory(selected, c))} />
          ))}
        </ChipRow>
      </Card>
      {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
      <Button title="Guardar" onPress={() => void save()} loading={busy} disabled={!canUse || !fromServer} />
    </Screen>
  );
}
