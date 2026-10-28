/**
 * Alta de producto iniciada desde un código no registrado. SOLO en línea (el catálogo vive en el servidor;
 * las altas no son operaciones de la cola de sincronización) y solo con permiso productos.editar.
 * Valida con productCreateSchema (el mismo que usa el servidor, que valida SIEMPRE otra vez).
 */
import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { productCreateSchema } from '@amara/shared/schemas';
import { Banner, Button, Field, H2, Loading, Muted, Screen } from '../src/components/ui';
import { useApp } from '../src/state/AppContext';
import { ApiError } from '../src/services/api';
import { parseIntInput, parseMoneyInput } from '../src/lib/money-input';

export default function ProductNew() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const app = useApp();
  const router = useRouter();
  const { store, device } = app;

  const isQr = (code ?? '').startsWith('amara:');
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [sku, setSku] = useState('');
  const [label, setLabel] = useState('Única');
  const [barcode, setBarcode] = useState(isQr ? '' : (code ?? ''));
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [minStock, setMinStock] = useState('0');
  const [qty, setQty] = useState('0');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!store || !device) return <Loading />;
  if (!app.can('productos.editar')) {
    return (
      <Screen>
        <Banner kind="error" text="Tu rol no puede dar de alta productos." />
      </Screen>
    );
  }

  async function submit() {
    if (!store || !device) return;
    setError(null);
    setOkMsg(null);
    if (!app.online) return setError('El alta de productos requiere conexión con el servidor.');
    const costCents = parseMoneyInput(cost);
    const priceCents = parseMoneyInput(price);
    const min = parseIntInput(minStock, { allowZero: true });
    const stockQty = parseIntInput(qty, { allowZero: true });
    if (costCents === null || priceCents === null) return setError('Escribe costo y precio válidos (por ejemplo 85.50).');
    if (min === null || stockQty === null) return setError('Mínimo y existencia deben ser números enteros (0 o más).');

    const parsed = productCreateSchema.safeParse({
      product: { name, type, category, sku, specs: {} },
      variants: [{ label, unit: 'pieza', barcode: barcode.trim() || undefined, costCents, priceCents, minStock: min, location: location.trim() || undefined }],
      initialStock: stockQty > 0 || location.trim() ? [{ variantIndex: 0, branchId: device.branchId, qty: stockQty, location: location.trim() || undefined }] : [],
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return setError(`Revisa los datos: ${first ? `${first.path.join('.')} - ${first.message}` : 'formato inválido'}`);
    }

    setBusy(true);
    try {
      if (barcode.trim() && (await store.codeExists(barcode))) throw new Error('Ese código de barras ya existe en el catálogo de este teléfono.');
      if (barcode.trim()) {
        const chk = await app.api.get<{ duplicate?: boolean }>(`/catalog/codes/check?code=${encodeURIComponent(barcode.trim())}`);
        if (chk.duplicate) throw new Error('El servidor indica que ese código ya está registrado en otro producto.');
      }
      await app.api.post<unknown>('/catalog/products', parsed.data);
      setOkMsg('Producto dado de alta. Sincronizando para descargarlo...');
      void app.syncNow('manual');
      setTimeout(() => router.back(), 1200);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError('El servidor no te autorizó a dar de alta productos.');
      else if (e instanceof ApiError && e.status === 401) setError('Tu sesión en línea venció. Inicia sesión con internet (Más - Sincronización).');
      else setError(e instanceof Error ? e.message : 'No se pudo dar de alta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Muted>Código leído: {code ?? '(ninguno)'}. Requiere conexión.</Muted>
      <H2>Producto</H2>
      <Field label="Nombre" value={name} onChangeText={setName} autoCapitalize="sentences" />
      <Field label="Tipo" value={type} onChangeText={setType} autoCapitalize="sentences" placeholder="Velas, inciensos, imágenes..." />
      <Field label="Categoría" value={category} onChangeText={setCategory} autoCapitalize="sentences" />
      <Field label="SKU (clave interna del producto)" value={sku} onChangeText={setSku} autoCapitalize="characters" autoCorrect={false} />
      <H2>Variante</H2>
      <Field label="Variante (tamaño, color...)" value={label} onChangeText={setLabel} autoCapitalize="sentences" />
      <Field label="Código de barras" value={barcode} onChangeText={setBarcode} autoCapitalize="none" autoCorrect={false} hint={isQr ? 'El código leído era un QR interno, no un código de barras.' : undefined} />
      <Field label="Costo" value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
      <Field label="Precio de venta" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Field label="Existencia mínima" value={minStock} onChangeText={setMinStock} keyboardType="number-pad" />
      <H2>Existencia inicial en esta sucursal</H2>
      <Field label="Cantidad" value={qty} onChangeText={setQty} keyboardType="number-pad" />
      <Field label="Lugar" value={location} onChangeText={setLocation} autoCapitalize="sentences" />
      {error ? <Banner kind="error" text={error} /> : null}
      {okMsg ? <Banner kind="ok" text={okMsg} /> : null}
      <Button title="Dar de alta" onPress={() => void submit()} loading={busy} disabled={okMsg !== null} />
    </Screen>
  );
}
