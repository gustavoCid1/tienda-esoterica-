/**
 * Vinculación con la PC (red local). La PC muestra un QR con un secreto de un solo uso y caducidad; este
 * teléfono lo escanea, demuestra conocerlo con un HMAC y deriva su llave (que nunca viaja por la red y se
 * guarda en SecureStore). Después las lecturas y órdenes se firman con esa llave.
 * AVISO: el enlace va en HTTP sin cifrar. Úsalo solo en la red del negocio, no en Wi-Fi público.
 */
import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Banner, Button, Card, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { CameraScanner } from '../src/components/CameraScanner';
import { useApp } from '../src/state/AppContext';
import { evaluatePairingPayload } from '../src/lib/pairing';
import { clearLink, clientFromLink, lanErrorMessage, loadLink, pairWithPc } from '../src/services/lan';
import type { LanLink } from '../src/services/lan';
import { formatMxDateTime } from '@amara/shared';

export default function PcLink() {
  const app = useApp();
  const router = useRouter();
  const [link, setLink] = useState<LanLink | null | undefined>(undefined);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadLink().then(setLink);
    }, []),
  );

  async function onQr(text: string) {
    if (busy) return;
    setError(null);
    setOk(null);
    const check = evaluatePairingPayload(text, Date.now());
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const l = await pairWithPc(check.payload, `Teléfono ${app.terminal?.terminalCode ?? ''}`.trim());
      setLink(l);
      setScanning(false);
      try {
        await clientFromLink(l).ping();
        setOk('Vinculado y verificado: la PC respondió.');
      } catch {
        setOk('Vinculado, pero la PC no respondió a la prueba. Revisa que esté en la misma red.');
      }
    } catch (e) {
      setError(lanErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!link) return;
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const r = await clientFromLink(link).ping();
      setOk(`La PC respondió (terminal ${r.terminal}).`);
    } catch (e) {
      setError(lanErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function unlink() {
    Alert.alert('Desvincular', 'Este teléfono dejará de enviar lecturas a la PC. Para revocar el acceso también en la PC, hazlo desde su pantalla de dispositivos. ¿Continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desvincular',
        style: 'destructive',
        onPress: () => {
          void clearLink().then(() => {
            setLink(null);
            setOk(null);
          });
        },
      },
    ]);
  }

  if (link === undefined) return <Loading />;

  return (
    <Screen>
      <Banner kind="warn" title="Solo en la red del negocio" text="La conexión con la PC no está cifrada (HTTP). Nadie puede falsificar órdenes sin la llave, pero el contenido es visible en la red. No la uses en Wi-Fi público." />
      {error ? <Banner kind="error" text={error} /> : null}
      {ok ? <Banner kind="ok" text={ok} /> : null}

      {link ? (
        <Card>
          <H2>Teléfono vinculado</H2>
          <Row label="PC" value={`${link.host}:${link.port}`} />
          <Row label="Terminal de la PC" value={link.terminalId} />
          <Row label="Vinculado" value={formatMxDateTime(link.linkedAt)} />
          <Button title="Usar como escáner de la PC" onPress={() => router.push('/pc-scanner')} />
          <Button title="Probar conexión" variant="secondary" onPress={() => void test()} loading={busy} />
          <Button title="Desvincular" variant="danger" onPress={unlink} disabled={busy} />
        </Card>
      ) : (
        <Card>
          <H2>Sin vincular</H2>
          <Muted>En la PC abre "Vincular teléfono" para mostrar el código QR y escanéalo aquí. El código caduca en pocos minutos y sirve una sola vez.</Muted>
        </Card>
      )}

      <Button title={scanning ? 'Cancelar escaneo' : link ? 'Volver a vincular (escanear QR)' : 'Escanear QR de la PC'} variant={link ? 'secondary' : 'primary'} onPress={() => { setError(null); setScanning((s) => !s); }} />
      {scanning ? <CameraScanner paused={busy} barcodeTypes={['qr']} onScan={(d) => void onQr(d)} height={300} /> : null}
    </Screen>
  );
}
