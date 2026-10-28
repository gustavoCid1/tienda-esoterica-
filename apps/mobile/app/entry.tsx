/**
 * Entradas de mercancía. El vendedor SOLO puede con un permiso temporal VIGENTE que el gerente le dio.
 * La vigencia se valida en el teléfono con la hora del dispositivo y se BLOQUEA si no se puede comprobar
 * (sin sincronizar nunca, reloj atrasado, permisos muy viejos). El servidor revalida al sincronizar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { formatMxDateTime } from '@amara/shared';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Field, H2, Loading, Muted, Screen } from '../src/components/ui';
import { CameraScanner } from '../src/components/CameraScanner';
import { MovementModal } from '../src/components/MovementModal';
import { StatusBanner } from '../src/components/StatusBanner';
import { useApp } from '../src/state/AppContext';
import { useNow } from '../src/hooks';
import { candidateCodes } from '../src/lib/scan-codes';
import type { EntryAccess } from '../src/lib/entry-guard';
import { loadEntryAccess } from '../src/services/entry';

export default function EntryScreen() {
  const app = useApp();
  const { store, device, actor } = app;
  const now = useNow(30_000);
  const [access, setAccess] = useState<EntryAccess | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [picked, setPicked] = useState<CatalogHit | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!store || !device || !actor) return;
    setAccess(await loadEntryAccess(store, actor, device.branchId));
  }, [store, device, actor]);

  // Se recalcula al abrir, cada 30 s (el permiso puede vencer con la pantalla abierta) y tras sincronizar.
  useFocusEffect(
    useCallback(() => {
      void check();
    }, [check, now, app.dataVersion]),
  );

  useEffect(() => {
    if (!store || !device || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let off = false;
    const t = setTimeout(() => {
      store.search(query, device.branchId, 12).then((r) => !off && setResults(r)).catch(() => undefined);
    }, 250);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [query, store, device]);

  if (!store || !device || !actor || !access) return <Loading />;

  async function onScan(code: string) {
    if (!store || !device) return;
    setScanError(null);
    for (const c of candidateCodes(code)) {
      const hits = await store.findByCode(c, device.branchId);
      if (hits[0]) {
        setNotice(null);
        setPicked(hits[0]);
        setScanning(false);
        return;
      }
    }
    setScanError(`El código ${code} no está en el catálogo de este teléfono.`);
  }

  return (
    <Screen>
      <StatusBanner compact />
      {access.allowed ? (
        access.viaGrant ? (
          <Banner kind="ok" title="Permiso temporal vigente" text={`Puedes registrar entradas en esta sucursal. Vence a las ${formatMxDateTime(access.expiresAt ?? '')} (en ${access.minutesLeft} min).`} />
        ) : (
          <Banner kind="ok" title="Gerente" text="Puedes registrar entradas sin permiso temporal." />
        )
      ) : (
        <Banner kind="error" title="Entradas bloqueadas" text={access.message} />
      )}
      {access.allowed && access.viaGrant ? access.warnings.map((w) => <Banner key={w} kind="warn" text={w} />) : null}

      {!access.allowed ? (
        <Card>
          <Muted>Sin permiso vigente no se pueden registrar entradas. Si el gerente ya te autorizó, sincroniza para descargar el permiso.</Muted>
          <Button title="Sincronizar ahora" loading={app.sync.running} disabled={!app.online} onPress={() => void app.syncNow('manual')} />
          {!app.online ? <Muted>Sin conexión: no se puede descargar el permiso.</Muted> : null}
        </Card>
      ) : (
        <>
          {notice ? <Banner kind="ok" text={notice} /> : null}
          <H2>Producto que entra</H2>
          <Field label="Buscar" value={query} onChangeText={setQuery} placeholder="Nombre, variante o código" autoCorrect={false} />
          {results.map((r) => (
            <Button
              key={r.variantId}
              title={`${r.productName} - ${r.label} (${r.qty})`}
              variant="secondary"
              onPress={() => {
                setNotice(null);
                setPicked(r);
                setQuery('');
              }}
            />
          ))}
          <Button title={scanning ? 'Cerrar cámara' : 'Escanear producto'} variant="secondary" onPress={() => setScanning((s) => !s)} />
          {scanning ? <CameraScanner paused={picked !== null} onScan={(d) => void onScan(d)} height={240} /> : null}
          {scanError ? <Banner kind="warn" text={scanError} /> : null}

        </>
      )}

      {/* Abre el formulario de entrada al elegir un producto. */}
      <MovementModal
        visible={picked !== null && access.allowed}
        hit={picked}
        initialType="entrada"
        onClose={() => setPicked(null)}
        onDone={(m) => {
          setNotice(m);
          setPicked(null);
        }}
      />
    </Screen>
  );
}
