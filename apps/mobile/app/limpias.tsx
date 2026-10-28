/**
 * Limpias: se arma una limpia con artículos y cantidades, un cargo opcional por servicio y el pago. Registra una venta de
 * tipo 'limpia' (con ticket, descuento de inventario y sincronización como cualquier venta).
 *  - Gerente: entra directo.
 *  - Vendedor: solo con la contraseña de un administrador o un token con propósito 'limpias' (AuthModal), y la autorización
 *    viaja con la venta (LocalStore la vuelve a exigir; el servidor también al sincronizar).
 * No se puede vender sin existencia ni más de lo disponible. El cargo por servicio es una línea 'extra' (sin inventario).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMXN, newId } from '@amara/shared';
import type { PaymentMethod, Sale } from '@amara/shared';
import { StoreError } from '@amara/database';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Chip, ChipRow, Divider, Field, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { AuthModal } from '../src/components/AuthModal';
import type { AuthSuccess } from '../src/components/AuthModal';
import { SaleTicketView } from '../src/components/SaleTicketView';
import { addLimpiaArticle, limpiaSaleItems, limpiaTotalCents, setLimpiaQty } from '../src/lib/misc-v2';
import type { LimpiaArticle } from '../src/lib/misc-v2';
import { isLegacyNegative, shownQty } from '../src/lib/low-stock';
import { parseMoneyInput } from '../src/lib/money-input';
import { methodName } from '../src/lib/ticket-render';
import { useApp } from '../src/state/AppContext';
import { colors, radius, space } from '../src/theme';

const METHODS: PaymentMethod[] = ['efectivo', 'tarjeta', 'transferencia', 'otro'];

export default function Limpias() {
  const app = useApp();
  const { store, device, actor, terminal, session } = app;
  const isManager = session?.user.role === 'gerente';
  const [saleId, setSaleId] = useState(() => newId());
  const [articles, setArticles] = useState<LimpiaArticle[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CatalogHit[]>([]);
  const [serviceText, setServiceText] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [tenderedText, setTenderedText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askAuth, setAskAuth] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);

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

  if (!store || !device || !actor || !terminal || !session) return <Loading />;

  const serviceCents = serviceText.trim() === '' ? 0 : parseMoneyInput(serviceText);
  const total = serviceCents === null ? 0 : limpiaTotalCents(articles, serviceCents);

  function addArticle(h: CatalogHit) {
    const r = addLimpiaArticle(articles, { variantId: h.variantId, name: h.productName, label: h.label, priceCents: h.priceCents, available: shownQty(h.qty) });
    setNotice(r.error);
    if (!r.error) {
      setArticles(r.list);
      setQuery('');
    }
  }

  function startRegister() {
    setError(null);
    if (articles.length === 0) return setError('Agrega al menos un artículo a la limpia.');
    if (serviceCents === null) return setError('El cargo por servicio no es un monto válido.');
    if (total <= 0) return setError('El total debe ser mayor a cero.');
    const tendered = method === 'efectivo' && tenderedText.trim() !== '' ? parseMoneyInput(tenderedText) : total;
    if (tendered === null || tendered < total) return setError('El efectivo recibido debe cubrir el total.');
    if (isManager) void register(undefined);
    else setAskAuth(true);
  }

  async function register(auth: AuthSuccess | undefined) {
    if (!store || !device || !actor || !terminal || !session) return;
    setBusy(true);
    setError(null);
    try {
      const tendered = method === 'efectivo' ? (tenderedText.trim() !== '' ? (parseMoneyInput(tenderedText) ?? total) : total) : undefined;
      const r = await store.registerSale({
        saleId,
        actor,
        branchId: device.branchId,
        terminalId: terminal.terminalId,
        type: 'limpia',
        items: limpiaSaleItems(articles, serviceCents ?? 0),
        payments: [method === 'efectivo' ? { method, amountCents: total, tenderedCents: tendered ?? total } : { method, amountCents: total }],
        sellerId: session.user.id,
        sellerName: session.user.name,
        ...(auth ? { authorization: auth.authorization, authorizationTrusted: auth.trusted } : {}),
      });
      setDone(r.sale);
      setArticles([]);
      setServiceText('');
      setTenderedText('');
      setSaleId(newId());
      app.notifyDataChanged();
      void app.syncNow('auto');
    } catch (e) {
      if (e instanceof StoreError && e.code === 'sin_existencia') {
        const avail = typeof e.data?.available === 'number' ? Math.max(0, e.data.available) : null;
        setError(`${e.message}${avail !== null ? ` Disponible: ${avail}.` : ''}`);
      } else {
        setError(e instanceof Error ? e.message : 'No se pudo registrar la limpia.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Banner kind="ok" title="Limpia registrada" text="Quedó guardada en el teléfono, descontó el inventario y se enviará al servidor al haber conexión." />
        <Card tone="gold">
          <Muted>Folio</Muted>
          <H1>{done.folio}</H1>
          <Row label="Total" value={formatMXN(done.totalCents)} strong />
        </Card>
        <SaleTicketView saleId={done.id} />
        <Button title="Nueva limpia" variant="dark" onPress={() => setDone(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>Limpias</H1>
      {!isManager ? <Banner kind="info" text="Para registrar una limpia se te pedirá la contraseña de un administrador o un token de Limpias." /> : null}

      <Card>
        <H2>Artículos</H2>
        {articles.length === 0 ? <Muted>Busca y agrega los artículos que se usan en la limpia.</Muted> : null}
        {articles.map((a) => (
          <View key={a.variantId} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{a.name}</Text>
              <Text style={styles.sub}>
                {a.label} · {formatMXN(a.priceCents)} c/u · existencia {a.available}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Restar una unidad" style={styles.step} onPress={() => { const r = setLimpiaQty(articles, a.variantId, a.qty - 1); setNotice(r.error); setArticles(r.list); }}>
              <Text style={styles.stepText}>-</Text>
            </Pressable>
            <Text style={styles.qty}>{a.qty}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Sumar una unidad" style={styles.step} onPress={() => { const r = setLimpiaQty(articles, a.variantId, a.qty + 1); setNotice(r.error); setArticles(r.list); }}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <Field label="Buscar artículo" value={query} onChangeText={setQuery} placeholder="Nombre o código" autoCorrect={false} />
      {notice ? <Banner kind="warn" text={notice} /> : null}
      {found.map((h) => {
        const none = shownQty(h.qty) <= 0;
        return (
          <Pressable key={h.variantId} accessibilityRole="button" onPress={() => addArticle(h)} style={({ pressed }) => [styles.result, none && { opacity: 0.55 }, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{h.productName}</Text>
              <Text style={styles.sub}>
                {h.label} · {formatMXN(h.priceCents)} · {none ? 'Sin existencia' : `existencia ${h.qty}`}
              </Text>
              {isLegacyNegative(h.qty) ? <Text style={styles.fix}>Existencia por corregir.</Text> : null}
            </View>
            <Text style={styles.plus}>{none ? '' : '+'}</Text>
          </Pressable>
        );
      })}

      <Card>
        <H2>Servicio y pago</H2>
        <Field label="Cargo por servicio (opcional)" value={serviceText} onChangeText={setServiceText} keyboardType="decimal-pad" placeholder="0.00" error={serviceCents === null ? 'Monto no válido' : null} />
        <Divider />
        <Row label="TOTAL" value={formatMXN(total)} strong />
        <ChipRow>
          {METHODS.map((m) => (
            <Chip key={m} label={methodName(m)} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </ChipRow>
        {method === 'efectivo' ? <Field label="Efectivo recibido (si es más, se calcula el cambio)" value={tenderedText} onChangeText={setTenderedText} keyboardType="decimal-pad" placeholder={(total / 100).toFixed(2)} /> : null}
      </Card>

      {error ? <Banner kind="error" text={error} /> : null}
      <Button title={`Registrar limpia ${formatMXN(total)}`} onPress={startRegister} loading={busy} disabled={articles.length === 0} />

      <AuthModal
        visible={askAuth}
        purpose="limpias"
        onCancel={() => setAskAuth(false)}
        onAuthorized={(a) => {
          setAskAuth(false);
          void register(a);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
  fix: { fontSize: 13, color: colors.danger, fontWeight: '700' },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '800', color: colors.text },
  qty: { minWidth: 26, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.text },
  result: { flexDirection: 'row', alignItems: 'center', padding: space.md, minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  plus: { fontSize: 28, fontWeight: '800', color: colors.gold, paddingHorizontal: space.sm },
});
