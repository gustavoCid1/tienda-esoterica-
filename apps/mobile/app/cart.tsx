/**
 * Venta de emergencia (funciona sin conexión).
 *  - El saleId se genera ANTES de cobrar (CartContext): reintentar nunca duplica la venta.
 *  - LocalStore.registerSale guarda en UNA transacción venta, partidas, pagos, ticket, movimientos de
 *    inventario, operación de sincronización y auditoría. Solo DESPUÉS del guardado se muestra el folio.
 *  - Descuenta las existencias LOCALES y sobrevive reinicios (SQLite en disco, WAL + synchronous FULL).
 *  - Se sincroniza sola al haber conexión. Sin descuentos en el móvil (los fija el gerente en caja).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMXN } from '@amara/shared';
import type { PaymentMethod, Sale } from '@amara/shared';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Chip, ChipRow, Divider, Field, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { StatusBanner } from '../src/components/StatusBanner';
import { useApp } from '../src/state/AppContext';
import { useCart } from '../src/state/CartContext';
import { parseMoneyInput } from '../src/lib/money-input';
import { summarizePayments, toPaymentInputs, validateNewPayment } from '../src/lib/payments';
import type { PaymentDraft } from '../src/lib/payments';
import { methodName } from '../src/lib/ticket-render';
import { replicateSaleToPc } from '../src/services/lan';
import { colors, radius, space } from '../src/theme';

const METHODS: PaymentMethod[] = ['efectivo', 'tarjeta', 'transferencia', 'otro'];
const toInput = (cents: number) => (cents / 100).toFixed(2);

interface Done {
  sale: Sale;
  duplicate: boolean;
  warnings: string[];
}

export default function CartScreen() {
  const app = useApp();
  const cart = useCart();
  const router = useRouter();
  const { store, device, actor, terminal } = app;

  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [amountText, setAmountText] = useState('');
  const [tenderedText, setTenderedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CatalogHit[]>([]);

  const total = cart.totalCents;
  const sum = summarizePayments(total, payments);

  // Al cambiar el carrito se descartan pagos ya capturados (el total puede ser otro).
  useEffect(() => {
    setPayments([]);
  }, [total]);

  // Importe sugerido = lo que falta por cobrar.
  useEffect(() => {
    setAmountText(sum.remainingCents > 0 ? toInput(sum.remainingCents) : '');
    setTenderedText('');
  }, [sum.remainingCents, method]);

  // Búsqueda para agregar productos sin escáner.
  useEffect(() => {
    if (!store || !device || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let off = false;
    const t = setTimeout(() => {
      store.search(query, device.branchId, 15).then((r) => !off && setFound(r)).catch(() => undefined);
    }, 250);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [query, store, device]);

  if (!store || !device || !actor || !terminal) return <Loading />;

  function addPayment() {
    setError(null);
    const amount = parseMoneyInput(amountText);
    if (amount === null) return setError('Escribe un importe válido.');
    let tendered: number | undefined;
    if (method === 'efectivo') {
      const t = tenderedText.trim() ? parseMoneyInput(tenderedText) : amount;
      if (t === null) return setError('Escribe el efectivo recibido correctamente.');
      tendered = t;
    }
    const draft: PaymentDraft = { method, amountCents: amount, tenderedCents: tendered };
    const problem = validateNewPayment(total, payments, draft);
    if (problem) return setError(problem);
    setPayments([...payments, draft]);
  }

  async function charge() {
    if (!store || !device || !actor || !terminal) return;
    setError(null);
    setBusy(true);
    try {
      const r = await store.registerSale({
        saleId: cart.cart.saleId,
        actor,
        branchId: device.branchId,
        terminalId: terminal.terminalId,
        items: cart.cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        payments: toPaymentInputs(payments),
      });
      // A partir de aquí la venta ya está en disco.
      setDone({ sale: r.sale, duplicate: r.duplicate, warnings: r.warnings });
      cart.reset();
      setPayments([]);
      app.notifyDataChanged();
      void replicateSaleToPc(store, r.sale.id); // réplica opcional a la PC vinculada
      void app.syncNow('auto'); // envío al servidor si hay conexión
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la venta.');
    } finally {
      setBusy(false);
    }
  }

  // ───────────── Venta registrada ─────────────
  if (done) {
    const cash = done.sale.payments.find((p) => p.method === 'efectivo');
    return (
      <Screen>
        <Banner kind="ok" title={done.duplicate ? 'Esta venta ya estaba registrada' : 'Venta registrada'} text="Quedó guardada en el teléfono y se enviará al servidor en cuanto haya conexión." />
        <Card tone="gold">
          <Muted>Folio</Muted>
          <H1>{done.sale.folio}</H1>
          <Row label="Total" value={formatMXN(done.sale.totalCents)} strong />
          {cash ? <Row label="Cambio" value={formatMXN(cash.changeCents ?? 0)} strong /> : null}
          <Row label="Productos" value={String(done.sale.items.reduce((a, i) => a + i.qty, 0))} />
        </Card>
        {done.warnings.map((w) => (
          <Banner key={w} kind="warn" text={w} />
        ))}
        <Button title="Ver e imprimir ticket" onPress={() => router.push(`/ticket/${done.sale.id}`)} />
        <Button title="Nueva venta" variant="dark" onPress={() => setDone(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Banner kind="warn" title="Venta de emergencia" text="Se guarda en este teléfono con folio único y descuenta las existencias locales, aunque no haya internet." />
      <StatusBanner compact />

      <Card>
        <H2>Productos ({cart.units})</H2>
        {cart.cart.lines.length === 0 ? <Muted>El carrito está vacío. Escanea un producto o búscalo abajo.</Muted> : null}
        {cart.cart.lines.map((l) => (
          <View key={l.variantId} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{l.productName}</Text>
              <Text style={styles.lineSub}>
                {l.label} · {formatMXN(l.unitPriceCents)} c/u
              </Text>
              <Text style={styles.lineTotal}>{formatMXN(l.qty * l.unitPriceCents)}</Text>
            </View>
            <View style={styles.stepper}>
              <Step label="-" onPress={() => cart.changeQty(l.variantId, l.qty - 1)} />
              <Text style={styles.qty}>{l.qty}</Text>
              <Step label="+" onPress={() => cart.changeQty(l.variantId, l.qty + 1)} />
            </View>
          </View>
        ))}
        <Divider />
        <Row label="TOTAL" value={formatMXN(total)} strong />
      </Card>

      <Field label="Agregar sin escáner (buscar)" value={query} onChangeText={setQuery} placeholder="Nombre o código" autoCorrect={false} />
      {found.map((h) => (
        <Pressable
          key={h.variantId}
          accessibilityRole="button"
          onPress={() => {
            cart.add(h, 1);
            setQuery('');
          }}
          style={({ pressed }) => [styles.result, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{h.productName}</Text>
            <Text style={styles.lineSub}>
              {h.label} · {formatMXN(h.priceCents)} · existencia {h.qty}
            </Text>
          </View>
          <Text style={styles.plus}>+</Text>
        </Pressable>
      ))}
      <Button title="Escanear más productos" variant="secondary" onPress={() => { app.setMode('venta'); router.push('/scan'); }} />

      {cart.cart.lines.length > 0 ? (
        <>
          <Card>
            <H2>Cobro</H2>
            {payments.map((p, i) => (
              <View key={i} style={styles.payRow}>
                <Text style={styles.lineName}>
                  {methodName(p.method)} {formatMXN(p.amountCents)}
                  {p.method === 'efectivo' && p.tenderedCents !== undefined && p.tenderedCents > p.amountCents ? ` (recibido ${formatMXN(p.tenderedCents)})` : ''}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Quitar pago" onPress={() => setPayments(payments.filter((_, j) => j !== i))}>
                  <Text style={styles.remove}>Quitar</Text>
                </Pressable>
              </View>
            ))}
            {sum.remainingCents > 0 ? (
              <>
                <Muted>Falta por cobrar: {formatMXN(sum.remainingCents)}</Muted>
                <ChipRow>
                  {METHODS.map((m) => (
                    <Chip key={m} label={methodName(m)} selected={method === m} onPress={() => setMethod(m)} />
                  ))}
                </ChipRow>
                <Field label="Importe a cobrar con este método" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" />
                {method === 'efectivo' ? <Field label="Efectivo recibido (si es más, se calcula el cambio)" value={tenderedText} onChangeText={setTenderedText} keyboardType="decimal-pad" placeholder={amountText} /> : null}
                <Button title="Agregar pago" variant="secondary" onPress={addPayment} />
              </>
            ) : null}
            {sum.changeCents > 0 ? <Row label="Cambio a entregar" value={formatMXN(sum.changeCents)} strong /> : null}
          </Card>

          {error ? <Banner kind="error" text={error} /> : null}
          <Button title={`Registrar venta ${formatMXN(total)}`} onPress={() => void charge()} loading={busy} disabled={!sum.complete} />
          <Button title="Vaciar carrito" variant="danger" disabled={busy} onPress={() => { cart.reset(); setPayments([]); }} />
        </>
      ) : null}
    </Screen>
  );
}

function Step({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label === '+' ? 'Sumar una unidad' : 'Restar una unidad'} onPress={onPress} style={({ pressed }) => [styles.step, pressed && { opacity: 0.6 }]}>
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  lineName: { fontSize: 16, fontWeight: '800', color: colors.text },
  lineSub: { fontSize: 14, color: colors.muted },
  lineTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  step: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 24, fontWeight: '800', color: colors.text },
  qty: { minWidth: 28, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.text },
  result: { flexDirection: 'row', alignItems: 'center', padding: space.md, minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  plus: { fontSize: 28, fontWeight: '800', color: colors.gold, paddingHorizontal: space.sm },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  remove: { color: colors.danger, fontWeight: '800', fontSize: 15, padding: space.sm },
});
