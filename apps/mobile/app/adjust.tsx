/**
 * Cancelación de un ticket o devolución (total/parcial) desde el teléfono.
 *  - Gerente: confirma con su contraseña.
 *  - Vendedor: contraseña de administrador o token con el propósito 'cancelacion' / 'devolucion'.
 * LocalStore vuelve a exigir la autorización (ocultar botones no basta). Las líneas 'extra' devuelven dinero pero nunca existencias.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatMXN } from '@amara/shared';
import type { Sale, SaleAdjustment } from '@amara/shared';
import { Banner, Button, Card, Chip, ChipRow, Divider, Field, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { AuthModal } from '../src/components/AuthModal';
import type { AuthSuccess } from '../src/components/AuthModal';
import { canCancelWhole, refundableLines } from '../src/lib/misc-v2';
import type { RefundableLine } from '../src/lib/misc-v2';
import { useApp } from '../src/state/AppContext';
import { colors, radius, space } from '../src/theme';

export default function Adjust() {
  const { saleId, type } = useLocalSearchParams<{ saleId: string; type: string }>();
  const app = useApp();
  const router = useRouter();
  const { store, actor, device, session } = app;
  const mode: 'cancelacion' | 'devolucion' = type === 'cancelacion' ? 'cancelacion' : 'devolucion';
  const [sale, setSale] = useState<Sale | null>(null);
  const [prior, setPrior] = useState<Pick<SaleAdjustment, 'items'>[]>([]);
  const [missing, setMissing] = useState(false);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askAuth, setAskAuth] = useState(false);

  const load = useCallback(async () => {
    if (!store || !saleId) return;
    const s = await store.getSale(saleId);
    if (!s) return setMissing(true);
    const rows = await store.db.all<{ items_json: string }>('SELECT items_json FROM sale_adjustments WHERE sale_id = ?', [s.id]);
    setPrior(
      rows.map((r) => {
        try {
          return { items: JSON.parse(r.items_json) as SaleAdjustment['items'] };
        } catch {
          return { items: [] };
        }
      }),
    );
    setSale(s);
  }, [store, saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!store || !actor || !device || !session) return <Loading />;
  if (missing) return <Screen><Banner kind="error" text="No se encontró ese ticket en este teléfono." /></Screen>;
  if (!sale) return <Loading />;

  // Un vendedor solo trabaja con sus propios tickets (igual que en la consulta de tickets).
  const own = sale.userId === session.user.id;
  if (!app.can('tickets.archivo') && !own) return <Screen><Banner kind="error" text="Solo puedes cancelar o devolver tus propios tickets." /></Screen>;

  const lines: RefundableLine[] = refundableLines(sale, prior);
  const whole = canCancelWhole(sale, prior);
  const chosen = lines.filter((l) => (qtys[l.saleItemId] ?? 0) > 0);

  function step(l: RefundableLine, d: number) {
    setQtys((q) => ({ ...q, [l.saleItemId]: Math.max(0, Math.min(l.remaining, (q[l.saleItemId] ?? 0) + d)) }));
  }

  function ask() {
    setError(null);
    if (reason.trim().length < 3) return setError('Escribe el motivo (al menos 3 letras).');
    if (mode === 'cancelacion' && !whole.ok) return setError(whole.reason ?? 'Este ticket no se puede cancelar.');
    if (mode === 'devolucion' && chosen.length === 0) return setError('Elige al menos una pieza a devolver.');
    setAskAuth(true);
  }

  async function run(auth: AuthSuccess) {
    if (!store || !actor || !device || !sale) return;
    setAskAuth(false);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'cancelacion') {
        await store.cancelSale({ saleId: sale.id, actor, terminalId: device.terminalId, reason, authorization: auth.authorization, authorizationTrusted: auth.trusted });
        setDone('Ticket cancelado. Las existencias regresaron al inventario y el movimiento se enviará al servidor.');
      } else {
        const adj = await store.refundSale({
          saleId: sale.id,
          actor,
          terminalId: device.terminalId,
          reason,
          lines: chosen.map((l) => ({ saleItemId: l.saleItemId, qty: qtys[l.saleItemId] ?? 0, restock })),
          authorization: auth.authorization,
          authorizationTrusted: auth.trusted,
        });
        setDone(`Devolución registrada por ${formatMXN(adj.amountCents)}. Se enviará al servidor al sincronizar.`);
      }
      app.notifyDataChanged();
      void app.syncNow('auto');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Banner kind="ok" title="Listo" text={done} />
        <Button title="Volver al ticket" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>{mode === 'cancelacion' ? 'Cancelar ticket' : 'Devolución'}</H1>
      <Card>
        <Row label="Folio" value={sale.folio} strong />
        <Row label="Total" value={formatMXN(sale.totalCents)} strong />
        <Row label="Estado" value={sale.status === 'cancelada' ? 'Cancelado' : 'Completado'} />
      </Card>
      {sale.status !== 'completada' ? <Banner kind="error" text="Este ticket ya está cancelado." /> : null}

      {mode === 'cancelacion' ? (
        <>
          {!whole.ok ? <Banner kind="warn" text={whole.reason ?? ''} /> : <Muted>Se cancela el ticket completo y las piezas regresan al inventario.</Muted>}
          <Button title="Ir a devolución parcial" variant="secondary" onPress={() => router.replace({ pathname: '/adjust', params: { saleId: sale.id, type: 'devolucion' } })} />
        </>
      ) : (
        <Card>
          <H2>Piezas a devolver</H2>
          {lines.map((l) => (
            <View key={l.saleItemId} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {l.kind === 'extra' ? 'Extra: ' : ''}
                  {l.name}
                  {l.label ? ` (${l.label})` : ''}
                </Text>
                <Text style={styles.sub}>
                  Vendidas {l.qty} · ya devueltas {l.refundedQty} · disponibles {l.remaining}
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel="Menos" style={styles.step} onPress={() => step(l, -1)}>
                  <Text style={styles.stepText}>-</Text>
                </Pressable>
                <Text style={styles.qty}>{qtys[l.saleItemId] ?? 0}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Más" style={styles.step} onPress={() => step(l, 1)}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Divider />
          <ChipRow>
            <Chip label="Regresa al inventario" selected={restock} onPress={() => setRestock(true)} />
            <Chip label="Dañado (no regresa)" selected={!restock} onPress={() => setRestock(false)} />
          </ChipRow>
          <Muted>Los extras devuelven dinero pero nunca existencias.</Muted>
        </Card>
      )}

      <Field label="Motivo" value={reason} onChangeText={setReason} placeholder="Por qué se cancela o devuelve" multiline />
      {error ? <Banner kind="error" text={error} /> : null}
      <Button
        title={mode === 'cancelacion' ? 'Cancelar ticket' : 'Registrar devolución'}
        variant="danger"
        onPress={ask}
        loading={busy}
        disabled={sale.status !== 'completada' || (mode === 'cancelacion' && !whole.ok)}
      />
      <Muted>
        Se pedirá {app.can('ventas.cancelar') ? 'tu contraseña' : 'la contraseña de un administrador o un token de ' + (mode === 'cancelacion' ? 'cancelación' : 'devolución')}. Si el pago fue en efectivo, la caja de esta terminal debe estar abierta.
      </Muted>

      <AuthModal visible={askAuth} purpose={mode} onCancel={() => setAskAuth(false)} onAuthorized={(a) => void run(a)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.muted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '800', color: colors.text },
  qty: { minWidth: 26, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.text },
});
