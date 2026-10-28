/**
 * Generación y consulta de códigos: QR (react-native-qrcode-svg) y Code 128 (lib/code128 + react-native-svg).
 *  - Consulta: busca una variante y muestra su QR (amara:v1:<id>), su código interno y su código de barras.
 *  - Reservar código interno: pide al servidor el siguiente consecutivo (solo con productos.editar y en línea).
 *  - Vista libre: cualquier texto como QR / Code 128 (para pruebas o etiquetas especiales).
 * Para IMPRIMIR etiquetas usa la web o la PC; aquí se muestran en pantalla.
 */
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { buildQrValue, formatMXN } from '@amara/shared';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Field, H2, Loading, Muted, P, Row, Screen } from '../src/components/ui';
import { Code128Svg, canEncodeCode128 } from '../src/components/Code128Svg';
import { useApp } from '../src/state/AppContext';
import { ApiError } from '../src/services/api';
import { colors, space } from '../src/theme';

export default function CodesScreen() {
  const { variantId } = useLocalSearchParams<{ variantId?: string }>();
  const app = useApp();
  const { store, device } = app;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogHit[]>([]);
  const [hit, setHit] = useState<CatalogHit | null>(null);
  const [free, setFree] = useState('');
  const [reserved, setReserved] = useState<string | null>(null);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);

  // Si llega con una variante (desde Inventario), se carga directamente.
  useEffect(() => {
    if (!store || !device || !variantId) return;
    store.findByCode(buildQrValue(variantId), device.branchId).then((r) => r[0] && setHit(r[0])).catch(() => undefined);
  }, [store, device, variantId]);

  useEffect(() => {
    if (!store || !device || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let off = false;
    const t = setTimeout(() => {
      store.search(query, device.branchId, 10).then((r) => !off && setResults(r)).catch(() => undefined);
    }, 250);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [query, store, device]);

  if (!store || !device) return <Loading />;

  async function reserve() {
    setReserveError(null);
    setReserving(true);
    try {
      // Respuesta asumida { code: string } (docs/API.md no fija la forma). Ver PENDIENTES-mobile.
      const r = await app.api.post<Record<string, unknown>>('/catalog/codes/next', {});
      const code = typeof r.code === 'string' ? r.code : typeof r.internalCode === 'string' ? r.internalCode : null;
      if (!code) throw new Error('El servidor respondió, pero no se reconoció el código reservado.');
      setReserved(code);
    } catch (e) {
      setReserveError(e instanceof ApiError && e.unreachable ? 'Reservar un código requiere conexión con el servidor.' : e instanceof Error ? e.message : 'No se pudo reservar.');
    } finally {
      setReserving(false);
    }
  }

  return (
    <Screen>
      <Field label="Buscar producto" value={query} onChangeText={setQuery} placeholder="Nombre o código" autoCorrect={false} />
      {results.map((r) => (
        <Button key={r.variantId} title={`${r.productName} - ${r.label}`} variant="secondary" onPress={() => { setHit(r); setQuery(''); }} />
      ))}

      {hit ? (
        <Card>
          <H2>{hit.productName}</H2>
          <Row label="Variante" value={hit.label} strong />
          <Row label="Precio" value={formatMXN(hit.priceCents)} />
          <Row label="Código interno" value={hit.internalCode} strong />
          <Row label="Código de barras" value={hit.barcode ?? 'No tiene'} />
          <Muted>QR del producto (identifica, no contiene datos sensibles)</Muted>
          <View style={styles.center}>
            <View style={styles.qrBox}>
              <QRCode value={hit.qrValue} size={200} color="#000000" backgroundColor="#FFFFFF" />
            </View>
          </View>
          <Muted>Code 128 del código interno</Muted>
          <View style={styles.center}>
            {canEncodeCode128(hit.internalCode) ? <Code128Svg value={hit.internalCode} /> : <Banner kind="warn" text="Este código tiene caracteres que Code 128 no admite." />}
          </View>
          <P style={styles.center}>{hit.internalCode}</P>
          {hit.barcode && canEncodeCode128(hit.barcode) ? (
            <>
              <Muted>Código de barras del fabricante, mostrado en Code 128 solo como referencia (el original puede ser EAN/UPC)</Muted>
              <View style={styles.center}>
                <Code128Svg value={hit.barcode} />
              </View>
            </>
          ) : null}
        </Card>
      ) : (
        <Muted>Busca un producto para ver sus códigos.</Muted>
      )}

      <Card>
        <H2>Vista libre</H2>
        <Field label="Texto a convertir en código" value={free} onChangeText={setFree} autoCapitalize="none" autoCorrect={false} />
        {free.trim() ? (
          <View style={styles.center}>
            <View style={styles.qrBox}>
              <QRCode value={free} size={160} color="#000000" backgroundColor="#FFFFFF" />
            </View>
            {canEncodeCode128(free) ? <Code128Svg value={free} height={70} /> : <Muted>Code 128 solo admite letras sin acento, números y símbolos comunes.</Muted>}
          </View>
        ) : null}
      </Card>

      {app.can('productos.editar') ? (
        <Card>
          <H2>Reservar código interno</H2>
          <Muted>Pide al servidor el siguiente código interno disponible (AMA########). Cada reserva consume un número: úsala solo para un producto nuevo.</Muted>
          {reserved ? <Banner kind="ok" title="Código reservado" text={reserved} /> : null}
          {reserveError ? <Banner kind="error" text={reserveError} /> : null}
          <Button
            title="Reservar siguiente código"
            variant="secondary"
            loading={reserving}
            disabled={!app.online}
            onPress={() => Alert.alert('Reservar código', 'Se consumirá el siguiente consecutivo. ¿Continuar?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Reservar', onPress: () => void reserve() }])}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  qrBox: { padding: space.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
});
