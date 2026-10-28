/**
 * Consulta y reimpresión de un ticket guardado. El ticket es una copia exacta tomada al vender
 * (mismo folio, importes y fecha): reimprimir nunca recalcula nada.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatMxDateTime } from '@amara/shared';
import type { Sale } from '@amara/shared';
import type { TicketPayload } from '@amara/database';
import { Banner, Button, Card, H2, Loading, Muted, Row, Screen } from '../../src/components/ui';
import { useApp } from '../../src/state/AppContext';
import { ticketLines } from '../../src/lib/ticket-render';
import { clientFromLink, loadLink } from '../../src/services/lan';
import type { LanLink } from '../../src/services/lan';
import { printViaPc, printWithSystem, sharePdf } from '../../src/services/printing';
import type { PrintOutcome } from '../../src/services/printing';
import { colors, radius, space } from '../../src/theme';

interface Loaded {
  payload: TicketPayload;
  printCount: number;
  lastPrintError: string | null;
  saleId: string;
  sale: Sale;
}

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const { store, session } = app;
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [link, setLink] = useState<LanLink | null>(null);
  const [busy, setBusy] = useState<null | 'system' | 'pc' | 'pdf'>(null);
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null);

  const reload = useCallback(async () => {
    if (!store || !id) return;
    const [t, sale] = await Promise.all([store.getTicket(id), store.getSale(id)]);
    if (!t || !sale) {
      setMissing(true);
      return;
    }
    setData({ ...t, sale });
  }, [store, id]);

  useEffect(() => {
    void reload();
    void loadLink().then(setLink);
  }, [reload]);

  if (!store || !session) return <Loading />;
  if (missing) return <Screen><Banner kind="error" text="No se encontró ese ticket en este teléfono." /></Screen>;
  if (!data) return <Loading />;

  // Autorización local (el servidor también la aplica en su archivo): vendedor solo sus tickets.
  const own = data.sale.userId === session.user.id;
  const allowed = app.can('tickets.archivo') || (app.can('tickets.imprimir_propios') && own);
  if (!allowed) return <Screen><Banner kind="error" text="No tienes permiso para ver este ticket." /></Screen>;

  const reprint = data.printCount > 0;
  const lines = ticketLines(data.payload);

  async function run(kind: 'system' | 'pc' | 'pdf') {
    if (!store || !data) return;
    setBusy(kind);
    setOutcome(null);
    let r: PrintOutcome;
    if (kind === 'system') r = await printWithSystem(store, data.saleId, data.payload, reprint);
    else if (kind === 'pdf') r = await sharePdf(data.payload, reprint);
    else if (link) r = await printViaPc(store, clientFromLink(link), data.saleId, data.payload.folio);
    else r = { ok: false, error: 'Este teléfono no está vinculado con la PC.' };
    setOutcome(r);
    setBusy(null);
    await reload();
  }

  return (
    <Screen>
      <Card>
        <View style={styles.paper}>
          {lines.map((l, i) => (
            <Text key={i} style={[styles.line, l.strong && styles.strong]}>
              {l.text}
            </Text>
          ))}
        </View>
      </Card>

      <Card>
        <H2>Impresión</H2>
        <Row label="Veces impreso" value={String(data.printCount)} />
        <Row label="Estado de la venta" value={data.sale.status === 'cancelada' ? 'Cancelada' : 'Completada'} />
        <Row label="Fecha" value={formatMxDateTime(data.sale.createdAt)} />
        {data.printCount === 0 ? <Banner kind="warn" text="Este ticket todavía no se ha impreso. Está guardado y puedes imprimirlo cuando tengas impresora." /> : null}
        {data.lastPrintError ? <Banner kind="error" title="Último intento fallido" text={data.lastPrintError} /> : null}
        {outcome ? <Banner kind={outcome.ok ? 'ok' : 'error'} text={outcome.ok ? outcome.detail : outcome.error} /> : null}

        <Button title="Pedir a la PC que imprima las 2 copias" onPress={() => void run('pc')} loading={busy === 'pc'} disabled={!link || busy !== null} />
        {!link ? <Muted>Para usar la impresora de la PC, vincula este teléfono en Más - Vincular con la PC.</Muted> : null}
        <Button title="Imprimir con el teléfono" variant="secondary" onPress={() => void run('system')} loading={busy === 'system'} disabled={busy !== null} />
        <Button title="Guardar o compartir PDF (2 copias)" variant="secondary" onPress={() => void run('pdf')} loading={busy === 'pdf'} disabled={busy !== null} />
        <Muted>
          "Imprimir con el teléfono" usa el servicio de impresión de Android: sirve con impresoras de red compatibles; las térmicas Bluetooth normalmente no aparecen. Si no hay impresora, no pasa nada: el ticket queda guardado con su folio y se reimprime después.
        </Muted>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  paper: { backgroundColor: colors.white, padding: space.sm, borderRadius: radius.sm, gap: 2 },
  line: { fontFamily: 'monospace', fontSize: 13, color: colors.text },
  strong: { fontWeight: '800' },
});
