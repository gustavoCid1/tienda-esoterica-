/**
 * El teléfono como escáner de la PC: cada lectura se envía firmada a la PC (LanClient.scan) y se muestra
 * la CONFIRMACIÓN de recibido (con el producto que la PC reconoció, si lo encontró). Si falla el envío, se
 * dice claramente que NO se entregó y se puede reintentar; no hay cola oculta.
 */
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { newId } from '@amara/shared';
import type { LanClient } from '@amara/sync';
import { Banner, Button, Card, H2, Loading, Muted, Screen } from '../src/components/ui';
import { CameraScanner } from '../src/components/CameraScanner';
import { ModeBadge, ModeSwitch } from '../src/components/ModeBadge';
import { useApp } from '../src/state/AppContext';
import { clientFromLink, lanErrorMessage, loadLink } from '../src/services/lan';
import type { LanLink } from '../src/services/lan';
import { colors, space } from '../src/theme';

interface Send {
  id: string;
  code: string;
  mode: 'venta' | 'inventario';
  status: 'enviando' | 'recibido' | 'error';
  found?: boolean;
  productName?: string;
  error?: string;
}

export default function PcScanner() {
  const app = useApp();
  const router = useRouter();
  const [link, setLink] = useState<LanLink | null | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const [sends, setSends] = useState<Send[]>([]);
  const client = useRef<LanClient | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void loadLink().then((l) => {
        setLink(l);
        client.current = l ? clientFromLink(l) : null;
      });
      return () => setFocused(false);
    }, []),
  );

  function patch(id: string, p: Partial<Send>) {
    setSends((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  async function send(entry: Send) {
    const c = client.current;
    if (!c) return patch(entry.id, { status: 'error', error: 'Este teléfono no está vinculado.' });
    patch(entry.id, { status: 'enviando', error: undefined });
    try {
      const r = await c.scan(entry.code, entry.mode);
      patch(entry.id, { status: r.received ? 'recibido' : 'error', found: r.found, productName: r.productName, error: r.received ? undefined : 'La PC no confirmó la recepción.' });
    } catch (e) {
      patch(entry.id, { status: 'error', error: lanErrorMessage(e) });
    }
  }

  function onScan(code: string) {
    const entry: Send = { id: newId(), code: code.trim(), mode: app.mode, status: 'enviando' };
    setSends((list) => [entry, ...list].slice(0, 20));
    void send(entry);
  }

  if (link === undefined) return <Loading />;
  if (link === null) {
    return (
      <Screen>
        <Banner kind="warn" text="Primero vincula este teléfono con la PC." />
        <Button title="Vincular con la PC" onPress={() => router.replace('/pc-link')} />
      </Screen>
    );
  }

  const last = sends[0];
  return (
    <Screen>
      <ModeBadge mode={app.mode} />
      <ModeSwitch mode={app.mode} onChange={app.setMode} />
      <Muted>Las lecturas se envían a la PC ({link.host}). Aquí no se agrega nada al carrito ni se mueve el inventario del teléfono.</Muted>

      {focused ? <CameraScanner onScan={(d) => onScan(d)} /> : <Loading />}

      {last ? (
        <Card tone={last.status === 'recibido' ? 'gold' : 'plain'}>
          <H2>{last.status === 'enviando' ? 'Enviando a la PC...' : last.status === 'recibido' ? 'Recibido por la PC' : 'NO se entregó a la PC'}</H2>
          <Text style={styles.code}>{last.code}</Text>
          {last.status === 'recibido' ? <Muted>{last.found ? `La PC reconoció: ${last.productName ?? 'producto'}` : 'La PC recibió el código, pero no está en su catálogo.'}</Muted> : null}
          {last.status === 'error' ? <Banner kind="error" text={last.error ?? 'Error desconocido.'} /> : null}
          {last.status === 'error' ? <Button title="Reintentar envío" onPress={() => void send(last)} /> : null}
        </Card>
      ) : null}

      {sends.length > 1 ? (
        <Card>
          <H2>Anteriores</H2>
          {sends.slice(1).map((s) => (
            <View key={s.id} style={styles.row}>
              <Text style={styles.prevCode}>{s.code}</Text>
              <Text style={[styles.prevState, s.status === 'error' && { color: colors.danger }]}>{s.status === 'recibido' ? 'Recibido' : s.status === 'enviando' ? 'Enviando' : 'Error'}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 18, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  prevCode: { flex: 1, fontSize: 14, color: colors.text },
  prevState: { fontSize: 14, fontWeight: '700', color: colors.ok },
});
