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
import { formatMXN, isExtraCategory } from '@amara/shared';
import type { PaymentMethod, Sale } from '@amara/shared';
import { StoreError } from '@amara/database';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Chip, ChipRow, Divider, Field, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { StatusBanner } from '../src/components/StatusBanner';
import { Sheet } from '../src/components/Sheet';
import { SaleTicketView } from '../src/components/SaleTicketView';
import { useApp } from '../src/state/AppContext';
import { useCart } from '../src/state/CartContext';
import { parseMoneyInput } from '../src/lib/money-input';
import { summarizePayments, toPaymentInputs, validateNewPayment } from '../src/lib/payments';
import type { PaymentDraft } from '../src/lib/payments';
import { methodName } from '../src/lib/ticket-render';
import { toSaleItems } from '../src/lib/cart';
import { isLegacyNegative, shownQty } from '../src/lib/low-stock';
import type { Employee } from '../src/lib/misc-v2';
import { loadEmployees } from '../src/services/employees';
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
  const [notice, setNotice] = useState<string | null>(null);
  // v2: empleado que vende (ventana antes de cobrar) y botón "Extra".
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [sellerOpen, setSellerOpen] = useState(false);
  const [extraCats, setExtraCats] = useState<string[]>([]);
  const [extraFor, setExtraFor] = useState<string | null>(null);
  const [extraAmount, setExtraAmount] = useState('');
  const [extraNote, setExtraNote] = useState('');
  const [extraError, setExtraError] = useState<string | null>(null);

  const total = cart.totalCents;
  const cartEmpty = cart.cart.lines.length === 0 && (cart.cart.extras ?? []).length === 0;
  const sum = summarizePayments(total, payments);

  // Al cambiar el carrito se descartan pagos ya capturados (el total puede ser otro).
  useEffect(() => {
    setPayments([]);
  }, [total]);

  // Empleados de la sucursal y categorías que admiten "Extra" (datos locales: funciona sin conexión).
  useEffect(() => {
    if (!store || !device || !app.session) return;
    let off = false;
    const u = app.session.user;
    loadEmployees(store, device.branchId, { id: u.id, name: u.name, role: u.role })
      .then((e) => !off && setEmployees(e))
      .catch(() => undefined);
    store
      .getExtraCategories()
      .then((c) => !off && setExtraCats(c))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [store, device, app.session, app.dataVersion]);

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
      const seller = employees.find((e) => e.id === (sellerId ?? app.session?.user.id));
      const r = await store.registerSale({
        saleId: cart.cart.saleId,
        actor,
        branchId: device.branchId,
        terminalId: terminal.terminalId,
        items: toSaleItems(cart.cart),
        payments: toPaymentInputs(payments),
        // v2: quien vendió. Queda en el sistema; NO se imprime en el ticket.
        sellerId: seller?.id ?? app.session?.user.id ?? null,
        sellerName: seller?.name ?? app.session?.user.name ?? null,
      });
      // A partir de aquí la venta ya está en disco.
      setDone({ sale: r.sale, duplicate: r.duplicate, warnings: r.warnings });
      cart.reset();
      setPayments([]);
      app.notifyDataChanged();
      void replicateSaleToPc(store, r.sale.id); // réplica opcional a la PC vinculada
      void app.syncNow('auto'); // envío al servidor si hay conexión
    } catch (e) {
      if (e instanceof StoreError && e.code === 'sin_existencia') {
        const avail = typeof e.data?.available === 'number' ? Math.max(0, e.data.available) : null;
        setError(`${e.message}${avail !== null ? ` Disponible: ${avail}.` : ''} Ajusta el carrito y vuelve a intentar.`);
      } else {
        setError(e instanceof Error ? e.message : 'No se pudo registrar la venta.');
      }
    } finally {
      setBusy(false);
    }
  }

  function saveExtra() {
    const line = cart.cart.lines.find((l) => l.variantId === extraFor);
    if (!line) return;
    const cents = parseMoneyInput(extraAmount);
    if (cents === null || cents <= 0) return setExtraError('Escribe el monto del extra (mayor a cero).');
    const note = extraNote.trim();
    if (note.length < 2) return setExtraError('Escribe una nota que explique el extra.');
    cart.addExtraLine({ variantId: line.variantId, productName: line.productName, label: line.label, amountCents: cents, note: note.slice(0, 120) });
    setExtraFor(null);
    setExtraAmount('');
    setExtraNote('');
    setExtraError(null);
  }

  function tryAdd(h: CatalogHit) {
    const reason = cart.add(h, 1);
    setNotice(reason);
    if (!reason) setQuery('');
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
          <Row label="Productos" value={String(done.sale.items.filter((i) => i.kind !== 'extra').reduce((a, i) => a + i.qty, 0))} />
        </Card>
        {done.warnings.map((w) => (
          <Banner key={w} kind="warn" text={w} />
        ))}
        <SaleTicketView saleId={done.sale.id} />
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
        {cart.cart.lines.length === 0 && (cart.cart.extras ?? []).length === 0 ? <Muted>El carrito está vacío. Escanea un producto o búscalo abajo.</Muted> : null}
        {cart.cart.lines.map((l) => (
          <View key={l.variantId} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{l.productName}</Text>
              <Text style={styles.lineSub}>
                {l.label} · {formatMXN(l.unitPriceCents)} c/u{l.available !== undefined ? ` · existencia ${l.available}` : ''}
              </Text>
              <Text style={styles.lineTotal}>{formatMXN(l.qty * l.unitPriceCents)}</Text>
              {isExtraCategory(l.category, extraCats) ? (
                <Pressable accessibilityRole="button" onPress={() => { setExtraFor(l.variantId); setExtraError(null); }} style={styles.extraBtn}>
                  <Text style={styles.extraBtnText}>+ Extra</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.stepper}>
              <Step label="-" onPress={() => { setNotice(null); cart.changeQty(l.variantId, l.qty - 1); }} />
              <Text style={styles.qty}>{l.qty}</Text>
              <Step label="+" onPress={() => setNotice(cart.changeQty(l.variantId, l.qty + 1))} />
            </View>
          </View>
        ))}
        {(cart.cart.extras ?? []).map((e) => (
          <View key={e.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>Extra: {e.productName}</Text>
              <Text style={styles.lineSub}>{e.note}</Text>
              <Text style={styles.lineTotal}>{formatMXN(e.amountCents)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Quitar extra" onPress={() => cart.removeExtraLine(e.id)}>
              <Text style={styles.remove}>Quitar</Text>
            </Pressable>
          </View>
        ))}
        <Divider />
        <Row label="TOTAL" value={formatMXN(total)} strong />
      </Card>

      <Field label="Agregar sin escáner (buscar)" value={query} onChangeText={setQuery} placeholder="Nombre o código" autoCorrect={false} />
      {notice ? <Banner kind="warn" text={notice} /> : null}
      {found.map((h) => {
        const none = shownQty(h.qty) <= 0;
        return (
          <Pressable
            key={h.variantId}
            accessibilityRole="button"
            accessibilityState={{ disabled: none }}
            onPress={() => tryAdd(h)}
            style={({ pressed }) => [styles.result, none && { opacity: 0.55 }, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{h.productName}</Text>
              <Text style={styles.lineSub}>
                {h.label} · {formatMXN(h.priceCents)} · {none ? 'Sin existencia' : `existencia ${h.qty}`}
              </Text>
              {isLegacyNegative(h.qty) ? <Text style={styles.fix}>Existencia por corregir: el inventario tiene un descuadre heredado.</Text> : null}
            </View>
            <Text style={styles.plus}>{none ? '' : '+'}</Text>
          </Pressable>
        );
      })}
      <Button title="Escanear más productos" variant="secondary" onPress={() => { app.setMode('venta'); router.push('/scan'); }} />

      {!cartEmpty ? (
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
          {employees.length > 0 ? (
            <Card>
              <Row label="Vende" value={employees.find((e) => e.id === (sellerId ?? app.session?.user.id))?.name ?? app.session?.user.name ?? '-'} />
              <Button title="Cambiar quien vende" variant="secondary" onPress={() => setSellerOpen(true)} />
              <Muted>Se guarda en el sistema; no se imprime en el ticket.</Muted>
            </Card>
          ) : null}
          <Button title={`Registrar venta ${formatMXN(total)}`} onPress={() => void charge()} loading={busy} disabled={!sum.complete} />
          <Button title="Vaciar carrito" variant="danger" disabled={busy} onPress={() => { cart.reset(); setPayments([]); }} />
        </>
      ) : null}
      <Sheet visible={sellerOpen} title="¿Quién vende?" onClose={() => setSellerOpen(false)}>
        <Muted>Elige al empleado que atendió esta venta.</Muted>
        {employees.map((e) => {
          const on = e.id === (sellerId ?? app.session?.user.id);
          return <Button key={e.id} title={`${on ? '✓ ' : ''}${e.name}`} variant={on ? 'primary' : 'secondary'} onPress={() => { setSellerId(e.id); setSellerOpen(false); }} />;
        })}
      </Sheet>

      <Sheet visible={extraFor !== null} title="Agregar extra" onClose={() => setExtraFor(null)}>
        <Muted>Cargo adicional sobre este producto (por ejemplo, personalización). No descuenta inventario.</Muted>
        <Field label="Monto del extra" value={extraAmount} onChangeText={setExtraAmount} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Nota" value={extraNote} onChangeText={setExtraNote} placeholder="Ej. Grabado con nombre" maxLength={120} />
        {extraError ? <Banner kind="error" text={extraError} /> : null}
        <Button title="Agregar extra" onPress={saveExtra} />
        <Button title="Cancelar" variant="secondary" onPress={() => setExtraFor(null)} />
      </Sheet>
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
  extraBtn: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, marginTop: space.xs, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.gold },
  extraBtnText: { color: colors.gold, fontWeight: '800', fontSize: 14 },
  fix: { fontSize: 13, color: colors.danger, fontWeight: '700' },
  remove: { color: colors.danger, fontWeight: '800', fontSize: 15, padding: space.sm },
});
