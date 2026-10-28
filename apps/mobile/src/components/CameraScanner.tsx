/**
 * Cámara con lectura de códigos (expo-camera: CameraView + onBarcodeScanned).
 *
 * COMPATIBILIDAD: los tipos pedidos son code128, ean13, ean8, upc_a, upc_e y qr. Qué tan bien se
 * leen en la práctica depende del DISPOSITIVO (cámara, enfoque automático, ML Kit), de la luz y de
 * la calidad de la etiqueta. UPC-A puede llegar como EAN-13 con un 0 delante en algunos equipos
 * (la búsqueda prueba ambas formas). Siempre hay captura manual como alternativa.
 */
import React, { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Card, H2, Muted } from './ui';
import { colors, radius, space } from '../theme';
import { SCAN_BARCODE_TYPES, ScanDebouncer } from '../lib/scan-codes';
import type { ScanBarcodeType } from '../lib/scan-codes';

export function CameraScanner(props: {
  onScan: (data: string, type: string) => void;
  /** Con true se ignoran las lecturas (p. ej. mientras se muestra un resultado). */
  paused?: boolean;
  barcodeTypes?: readonly ScanBarcodeType[];
  height?: number;
}) {
  const { onScan, paused = false, barcodeTypes = SCAN_BARCODE_TYPES, height = 280 } = props;
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const debouncer = useRef(new ScanDebouncer(1500));

  if (!permission) {
    return <View style={[styles.box, { height }]} />;
  }

  if (!permission.granted) {
    return (
      <Card>
        <H2>Permiso de cámara</H2>
        <Muted>La cámara se usa solo para leer códigos de barras y QR. Si no la permites, puedes escribir el código a mano.</Muted>
        {permission.canAskAgain ? (
          <Button title="Permitir cámara" onPress={() => void requestPermission()} />
        ) : (
          <Button title="Abrir ajustes del teléfono" variant="secondary" onPress={() => void Linking.openSettings()} />
        )}
      </Card>
    );
  }

  return (
    <View style={[styles.box, { height }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
        onBarcodeScanned={
          paused
            ? undefined
            : (r) => {
                if (debouncer.current.accept(r.data, Date.now())) onScan(r.data, r.type);
              }
        }
      />
      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={styles.frame} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Apagar linterna' : 'Encender linterna'} onPress={() => setTorch((t) => !t)} style={styles.torch}>
        <Text style={styles.torchText}>{torch ? 'Linterna: ON' : 'Linterna'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '78%', height: '55%', borderWidth: 3, borderColor: colors.goldBright, borderRadius: radius.md },
  torch: { position: 'absolute', right: space.md, bottom: space.md, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: space.md, minHeight: 44, borderRadius: 22, justifyContent: 'center' },
  torchText: { color: colors.white, fontWeight: '800' },
});
