/**
 * Escáner con dos modos MUY visibles:
 *  - VENTA: cada lectura agrega el producto al carrito con 1 unidad.
 *  - INVENTARIO: cada lectura abre el formulario (cantidad, sucursal, lugar, variante, motivo).
 * Si el código no existe y el usuario puede dar de alta productos, se ofrece iniciar el alta.
 * Compatibilidad de lectura: depende del dispositivo (ver CameraScanner y la pantalla "Compatibilidad").
 */
import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMXN } from '@amara/shared';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Field, H2, Loading, Muted, P, Row, Screen, Spacer } from '../../src/components/ui';
import { CameraScanner } from '../../src/components/CameraScanner';
import { ModeBadge, ModeSwitch } from '../../src/components/ModeBadge';
import { MovementModal } from '../../src/components/MovementModal';
import { StatusBanner } from '../../src/components/StatusBanner';
import { isLegacyNegative, shownQty } from '../../src/lib/low-stock';
import { useApp } from '../../src/state/AppContext';
import { useCart } from '../../src/state/CartContext';
import { candidateCodes } from '../../src/lib/scan-codes';
import { colors } from '../../src/theme';

type Result =
  | { kind: 'added'; hit: CatalogHit }
  | { kind: 'pick'; code: string; hits: CatalogHit[] }
  | { kind: 'notfound'; code: string }
  | { kind: 'error'; message: string };

export default function ScanScreen() {
  const app = useApp();
  const cart = useCart();
  const router = useRouter();
  const { store, device, mode } = app;
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [moving, setMoving] = useState<CatalogHit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const busy = useRef(false);

  // La cámara solo trabaja mientras esta pestaña está visible (ahorra batería).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const handleCode = useCallback(
    async (raw: string) => {
      if (!store || !device || busy.current) return;
      busy.current = true;
      setNotice(null);
      try {
        let hits: CatalogHit[] = [];
        for (const c of candidateCodes(raw)) {
          hits = await store.findByCode(c, device.branchId);
          if (hits.length > 0) break;
        }
        const code = raw.trim();
        if (hits.length === 0) {
          setPaused(true);
          setResult({ kind: 'notfound', code });
        } else if (hits.length > 1) {
          setPaused(true);
          setResult({ kind: 'pick', code, hits });
        } else {
          const hit = hits[0]!;
          if (mode === 'venta') {
            if (!app.can('ventas.crear')) {
              setPaused(true);
              setResult({ kind: 'error', message: 'Tu rol no puede vender.' });
            } else {
              const blocked = cart.add(hit, 1); // modo VENTA: siempre 1 unidad; no se vende sin existencia ni de más
              if (blocked) {
                setPaused(true);
                setResult({ kind: 'error', message: blocked });
              } else setResult({ kind: 'added', hit });
            }
          } else {
            setPaused(true);
            setResult({ kind: 'pick', code, hits });
            setMoving(hit); // modo INVENTARIO: abre el formulario
          }
        }
      } catch (e) {
        setPaused(true);
        setResult({ kind: 'error', message: e instanceof Error ? e.message : 'No se pudo leer el código.' });
      } finally {
        busy.current = false;
      }
    },
    [store, device, mode, cart, app],
  );

  function resume() {
    setResult(null);
    setPaused(false);
  }

  if (!store || !device) return <Loading />;
  const branchName = app.myBranches.find((b) => b.id === device.branchId)?.name ?? '';

  return (
    <Screen edges={['left', 'right']}>
      <ModeBadge mode={mode} />
      <ModeSwitch mode={mode} onChange={app.setMode} />
      <StatusBanner compact />

      {focused ? <CameraScanner paused={paused} onScan={(data) => void handleCode(data)} /> : <Loading />}
      <Muted>Tipos de código: Code 128, EAN-13, EAN-8, UPC-A, UPC-E y QR. La lectura real depende de tu teléfono y de la luz.</Muted>

      {notice ? <Banner kind="ok" text={notice} /> : null}

      {result?.kind === 'added' ? (
        <Card tone="gold">
          <H2>Agregado al carrito (1 unidad)</H2>
          <HitDetails hit={result.hit} branchName={branchName} />
          <Button title={`Ver carrito (${cart.units})`} onPress={() => router.push('/cart')} />
          <Button title="Quitar esta unidad" variant="secondary" onPress={() => { cart.changeQty(result.hit.variantId, (cart.cart.lines.find((l) => l.variantId === result.hit.variantId)?.qty ?? 1) - 1); setResult(null); }} />
        </Card>
      ) : null}

      {result?.kind === 'pick' ? (
        <Card>
          <H2>{result.hits.length > 1 ? 'Varios productos con ese código' : 'Producto encontrado'}</H2>
          {result.hits.map((h) => (
            <Card key={h.variantId} tone="gold">
              <HitDetails hit={h} branchName={branchName} />
              {mode === 'venta' ? (
                <Button
                  title="Agregar al carrito (1)"
                  disabled={h.qty <= 0}
                  onPress={() => {
                    const blocked = cart.add(h, 1);
                    setNotice(blocked ?? `Agregado: ${h.productName} ${h.label}`);
                    resume();
                  }}
                />
              ) : (
                <Button title="Registrar movimiento" variant="dark" onPress={() => setMoving(h)} />
              )}
            </Card>
          ))}
          <Button title="Seguir escaneando" variant="secondary" onPress={resume} />
        </Card>
      ) : null}

      {result?.kind === 'notfound' ? (
        <Card>
          <H2>Código no registrado</H2>
          <P>{result.code}</P>
          <Muted>No está en el catálogo de este teléfono. Si es un producto nuevo, sincroniza por si ya lo dieron de alta en otro equipo.</Muted>
          {app.can('productos.editar') ? (
            <Button title="Dar de alta este producto" onPress={() => router.push({ pathname: '/product-new', params: { code: result.code } })} />
          ) : (
            <Banner kind="info" text="Tu rol no puede dar de alta productos. Avisa a un gerente." />
          )}
          <Button title="Sincronizar ahora" variant="secondary" loading={app.sync.running} onPress={() => void app.syncNow('manual')} />
          <Button title="Seguir escaneando" variant="secondary" onPress={resume} />
        </Card>
      ) : null}

      {result?.kind === 'error' ? (
        <Card>
          <Banner kind="error" text={result.message} />
          <Button title="Seguir escaneando" variant="secondary" onPress={resume} />
        </Card>
      ) : null}

      <Spacer h={4} />
      <Field label="O escribe el código" value={manual} onChangeText={setManual} autoCapitalize="characters" autoCorrect={false} placeholder="Código de barras o interno" />
      <Button
        title="Buscar código"
        variant="secondary"
        disabled={manual.trim().length === 0}
        onPress={() => {
          void handleCode(manual);
          setManual('');
        }}
      />
      <Button title="Usar como escáner de la PC" variant="secondary" onPress={() => router.push('/pc-scanner')} />

      <MovementModal
        visible={moving !== null}
        hit={moving}
        onClose={() => {
          setMoving(null);
          resume();
        }}
        onDone={(m) => {
          setMoving(null);
          setNotice(m);
          resume();
        }}
      />
    </Screen>
  );
}

function HitDetails({ hit, branchName }: { hit: CatalogHit; branchName: string }) {
  return (
    <>
      <H2>{hit.productName}</H2>
      <Row label="Variante" value={hit.label} strong />
      <Row label="Precio" value={formatMXN(hit.priceCents)} strong />
      <Row label="Existencia (local)" value={String(shownQty(hit.qty))} strong valueColor={hit.qty <= 0 ? colors.danger : undefined} />
      {isLegacyNegative(hit.qty) ? <Banner kind="warn" text="Existencia por corregir: el inventario tiene un descuadre heredado. Avisa al gerente para ajustarlo." /> : null}
      <Row label="Sucursal" value={branchName} />
      <Row label="Lugar" value={hit.location ?? 'Sin lugar'} />
    </>
  );
}
