/**
 * Inventario (consulta): búsqueda y filtros Todos / Agotados / Bajos sobre la base local.
 * Cantidad visible = existencia del servidor (última sincronización) + movimientos locales sin confirmar.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatMXN } from '@amara/shared';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Chip, ChipRow, H2, Loading, Muted, P, Row } from '../../src/components/ui';
import { StatusBanner } from '../../src/components/StatusBanner';
import { MovementModal } from '../../src/components/MovementModal';
import { isLegacyNegative, shownQty } from '../../src/lib/low-stock';
import { useApp } from '../../src/state/AppContext';
import { useCart } from '../../src/state/CartContext';
import { colors, radius, space } from '../../src/theme';

type Filter = 'todos' | 'agotados' | 'bajos';
const PAGE = 100;

export default function Inventory() {
  const app = useApp();
  const cart = useCart();
  const router = useRouter();
  const { store, device } = app;
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [rows, setRows] = useState<CatalogHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogHit | null>(null);
  const [moving, setMoving] = useState<CatalogHit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const load = useCallback(
    async (offset: number) => {
      if (!store || !device) return;
      const id = ++reqId.current;
      try {
        const r = await store.inventoryList({ branchId: device.branchId, text: debounced, filter, limit: PAGE, offset });
        if (id !== reqId.current) return; // llegó tarde: ya hay una búsqueda más nueva
        setRows((prev) => (offset === 0 ? r : [...prev, ...r]));
        setMore(r.length === PAGE);
        setError(null);
      } catch (e) {
        if (id === reqId.current) setError(e instanceof Error ? e.message : 'No se pudo consultar el inventario.');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [store, device, debounced, filter],
  );

  // Recarga al cambiar búsqueda/filtro, al volver a la pantalla y cuando cambian los datos (sincronización, movimientos).
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load(0);
    }, [load, app.dataVersion]),
  );

  if (!store || !device) return <Loading />;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.top}>
        <TextInput
          style={styles.search}
          value={text}
          onChangeText={setText}
          placeholder="Buscar por nombre, variante, código o categoría"
          placeholderTextColor="#8A8A8A"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Buscar en inventario"
        />
        <ChipRow>
          <Chip label="Todos" selected={filter === 'todos'} onPress={() => setFilter('todos')} />
          <Chip label="Agotados" selected={filter === 'agotados'} onPress={() => setFilter('agotados')} />
          <Chip label="Bajos" selected={filter === 'bajos'} onPress={() => setFilter('bajos')} />
        </ChipRow>
        <StatusBanner compact />
        {notice ? <Banner kind="ok" text={notice} /> : null}
        {error ? <Banner kind="error" text={error} /> : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.variantId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={app.sync.running} onRefresh={() => void app.syncNow('manual')} tintColor={colors.gold} />}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.gold} style={{ margin: 24 }} /> : <Muted style={styles.empty}>No hay productos con ese criterio.</Muted>}
        ListFooterComponent={more ? <Button title="Cargar más" variant="secondary" onPress={() => void load(rows.length)} /> : null}
        renderItem={({ item }) => <ItemRow item={item} onPress={() => setSelected(item)} />}
      />

      <Modal visible={selected !== null} animationType="slide" onRequestClose={() => setSelected(null)} transparent>
        <View style={styles.sheetBackdrop}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            {selected ? (
              <>
                <H2>{selected.productName}</H2>
                <P>{selected.label}</P>
                <Row label="Precio" value={formatMXN(selected.priceCents)} strong />
                <Row label="Existencia (local)" value={String(shownQty(selected.qty))} strong valueColor={selected.qty <= 0 ? colors.danger : undefined} />
                {isLegacyNegative(selected.qty) ? <Banner kind="warn" text="Existencia por corregir: el inventario tiene un descuadre heredado. Avisa al gerente para ajustarlo." /> : null}
                <Row label="Mínimo" value={String(selected.minStock)} />
                <Row label="Sucursal" value={app.myBranches.find((b) => b.id === device.branchId)?.name ?? ''} />
                <Row label="Lugar" value={selected.location ?? 'Sin lugar'} />
                <Row label="Categoría" value={selected.category} />
                <Row label="Código interno" value={selected.internalCode} />
                <Row label="Código de barras" value={selected.barcode ?? 'No tiene'} />
                {app.can('ventas.crear') ? (
                  <Button
                    title={selected.qty <= 0 ? 'Sin existencia' : 'Agregar a la venta'}
                    disabled={selected.qty <= 0}
                    onPress={() => {
                      const blocked = cart.add(selected, 1);
                      setNotice(blocked ?? `Agregado al carrito: ${selected.productName} ${selected.label}`);
                      setSelected(null);
                    }}
                  />
                ) : null}
                {app.can('estadisticas.ver') ? (
                  <Button
                    title="Ventas del producto"
                    variant="secondary"
                    onPress={() => {
                      const hit = selected;
                      setSelected(null);
                      router.push({ pathname: '/product-sales', params: { productId: hit.productId, name: hit.productName } });
                    }}
                  />
                ) : null}
                <Button
                  title="Ver códigos (QR y barras)"
                  variant="secondary"
                  onPress={() => {
                    const id = selected.variantId;
                    setSelected(null);
                    router.push({ pathname: '/codes', params: { variantId: id } });
                  }}
                />
                {app.can('inventario.mover') || app.session?.user.role === 'vendedor' ? (
                  <Button
                    title="Registrar movimiento"
                    variant="dark"
                    onPress={() => {
                      setMoving(selected);
                      setSelected(null);
                    }}
                  />
                ) : null}
                <Button title="Cerrar" variant="secondary" onPress={() => setSelected(null)} />
              </>
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>

      <MovementModal
        visible={moving !== null}
        hit={moving}
        onClose={() => setMoving(null)}
        onDone={(m) => {
          setMoving(null);
          setNotice(m);
        }}
      />
    </SafeAreaView>
  );
}

function ItemRow({ item, onPress }: { item: CatalogHit; onPress: () => void }) {
  const out = item.qty <= 0;
  const low = !out && item.qty <= item.minStock;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.itemName}>{item.productName}</Text>
        <Text style={styles.itemSub}>
          {item.label} · {item.location ?? 'Sin lugar'}
        </Text>
        <Text style={styles.itemSub}>{formatMXN(item.priceCents)}</Text>
      </View>
      <View style={[styles.qty, out && styles.qtyOut, low && styles.qtyLow]}>
        <Text style={[styles.qtyNum, out && { color: colors.danger }]}>{shownQty(item.qty)}</Text>
        <Text style={styles.qtyLabel}>{isLegacyNegative(item.qty) ? 'Por corregir' : out ? 'Agotado' : low ? 'Bajo' : 'pzas'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { padding: space.lg, gap: space.sm },
  search: { minHeight: 52, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, color: colors.text, backgroundColor: colors.white },
  list: { paddingHorizontal: space.lg, paddingBottom: 32, gap: space.sm },
  empty: { textAlign: 'center', margin: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  itemName: { fontSize: 16, fontWeight: '800', color: colors.text },
  itemSub: { fontSize: 14, color: colors.muted },
  qty: { minWidth: 64, alignItems: 'center', borderRadius: radius.sm, padding: space.sm, backgroundColor: colors.surface },
  qtyOut: { backgroundColor: colors.dangerSoft },
  qtyLow: { backgroundColor: colors.goldSoft },
  qtyNum: { fontSize: 20, fontWeight: '900', color: colors.text },
  qtyLabel: { fontSize: 12, color: colors.muted, fontWeight: '700' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.lg, gap: space.sm },
});
