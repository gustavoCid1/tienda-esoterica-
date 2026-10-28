/**
 * Formulario de movimiento de inventario (modo INVENTARIO del escáner, detalle de inventario y entradas).
 * Pregunta: cantidad, sucursal, lugar, variante y motivo (+ tipo de movimiento).
 *
 * Reglas:
 *  - El movimiento NUNCA pisa la existencia: LocalStore.registerMovement guarda un movimiento con
 *    signo (y para "conteo" la diferencia) y lo encola para sincronizar.
 *  - Entradas del vendedor: SOLO con permiso temporal vigente comprobado en el teléfono (lib/entry-guard);
 *    si no se puede comprobar, se bloquea. El servidor vuelve a validar al sincronizar.
 *  - El id del movimiento se genera al abrir el formulario: un reintento no duplica.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newId } from '@amara/shared';
import { StoreError } from '@amara/database';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Chip, ChipRow, Field, H1, H2, Muted, P } from './ui';
import { colors, space } from '../theme';
import { useApp } from '../state/AppContext';
import { loadEntryAccess } from '../services/entry';
import type { EntryAccess } from '../lib/entry-guard';
import { parseIntInput } from '../lib/money-input';

type MoveType = 'entrada' | 'salida' | 'ajuste' | 'conteo';

const TYPE_LABEL: Record<MoveType, string> = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste (+/-)', conteo: 'Conteo físico' };
const TYPE_HELP: Record<MoveType, string> = {
  entrada: 'Suma mercancía que llegó. Cantidad positiva.',
  salida: 'Resta mercancía que sale (merma, uso interno). Cantidad positiva.',
  ajuste: 'Corrige con signo: 3 suma, -2 resta.',
  conteo: 'Escribe lo que CONTASTE; la app registra la diferencia contra lo que había.',
};
const QUICK_REASONS: Record<MoveType, string[]> = {
  entrada: ['Compra a proveedor', 'Reposición de bodega'],
  salida: ['Merma', 'Producto dañado'],
  ajuste: ['Corrección de captura', 'Diferencia detectada'],
  conteo: ['Conteo físico'],
};

export function MovementModal(props: {
  visible: boolean;
  hit: CatalogHit | null;
  initialType?: MoveType;
  onClose: () => void;
  /** Mensaje de confirmación para mostrar en la pantalla que lo abrió. */
  onDone: (message: string) => void;
}) {
  const { visible, hit, onClose, onDone, initialType } = props;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {visible && hit ? <MovementForm key={hit.variantId} hit={hit} initialType={initialType} onClose={onClose} onDone={onDone} /> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function MovementForm({ hit, initialType, onClose, onDone }: { hit: CatalogHit; initialType?: MoveType; onClose: () => void; onDone: (m: string) => void }) {
  const { store, actor, device, terminal, myBranches, can, notifyDataChanged } = useApp();

  const allowedTypes = useMemo<MoveType[]>(() => (can('inventario.mover') ? ['entrada', 'salida', 'ajuste', 'conteo'] : ['entrada']), [can]);
  const [type, setType] = useState<MoveType>(initialType && allowedTypes.includes(initialType) ? initialType : allowedTypes[0]!);
  const [variantId, setVariantId] = useState(hit.variantId);
  const [siblings, setSiblings] = useState<CatalogHit[]>([hit]);
  const [branchId, setBranchId] = useState(device?.branchId ?? myBranches[0]?.id ?? '');
  const [qtyText, setQtyText] = useState(initialType === 'conteo' ? '' : '1');
  const [location, setLocation] = useState(hit.location ?? '');
  const [reason, setReason] = useState('');
  const [currentQty, setCurrentQty] = useState<number | null>(hit.qty);
  const [access, setAccess] = useState<EntryAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const movementId = useRef(newId());

  // Variantes hermanas del mismo producto (para elegir variante).
  useEffect(() => {
    if (!store || !device) return;
    let off = false;
    store
      .inventoryList({ branchId: device.branchId, text: hit.productName, limit: 60 })
      .then((rows) => {
        if (off) return;
        const same = rows.filter((r) => r.productId === hit.productId);
        setSiblings(same.length > 0 ? same : [hit]);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [store, device, hit]);

  // Existencia local de la variante en la sucursal elegida.
  useEffect(() => {
    if (!store || !branchId) return;
    let off = false;
    store.stockQty(variantId, branchId).then((q) => !off && setCurrentQty(q)).catch(() => undefined);
    return () => {
      off = true;
    };
  }, [store, variantId, branchId]);

  // Permiso para entradas.
  useEffect(() => {
    if (!store || !actor || type !== 'entrada' || !branchId) {
      setAccess(null);
      return;
    }
    let off = false;
    loadEntryAccess(store, actor, branchId).then((a) => !off && setAccess(a)).catch(() => undefined);
    return () => {
      off = true;
    };
  }, [store, actor, type, branchId]);

  const entryBlocked = type === 'entrada' && access !== null && !access.allowed;
  const selected = siblings.find((s) => s.variantId === variantId) ?? hit;

  async function submit() {
    if (!store || !actor || !device || !terminal) return;
    setError(null);
    const qty = parseIntInput(qtyText, { allowNegative: type === 'ajuste', allowZero: type === 'conteo' });
    if (qty === null) return setError(type === 'ajuste' ? 'Escribe un número entero distinto de cero (puede ser negativo).' : type === 'conteo' ? 'Escribe la cantidad contada (0 o más).' : 'Escribe una cantidad entera mayor a cero.');
    if ((type === 'entrada' || type === 'salida') && qty <= 0) return setError('La cantidad debe ser mayor a cero.');
    if (type === 'conteo' && qty < 0) return setError('La cantidad contada no puede ser negativa.');
    if (reason.trim().length < 3) return setError('Escribe el motivo (mínimo 3 letras).');
    if (!branchId) return setError('Elige la sucursal.');

    setBusy(true);
    try {
      if (type === 'entrada') {
        // Se vuelve a comprobar justo antes de guardar (el permiso pudo vencer mientras se llenaba el formulario).
        const fresh = await loadEntryAccess(store, actor, branchId);
        setAccess(fresh);
        if (!fresh.allowed) {
          setError(fresh.message);
          return;
        }
      }
      const r = await store.registerMovement({
        id: movementId.current,
        actor,
        branchId,
        terminalId: terminal.terminalId,
        variantId,
        type,
        qty,
        reason: reason.trim(),
        location: location.trim() || undefined,
      });
      notifyDataChanged();
      const label = `${selected.productName} ${selected.label}`.trim();
      onDone(`${TYPE_LABEL[type]} registrada: ${label}. ${r.delta >= 0 ? '+' : ''}${r.delta}. Existencia local ahora: ${r.newQty}.${r.duplicate ? ' (ya estaba registrada)' : ''}`);
    } catch (e) {
      setError(e instanceof StoreError || e instanceof Error ? e.message : 'No se pudo guardar el movimiento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <H1>Movimiento de inventario</H1>
      <View style={styles.summary}>
        <H2>{selected.productName}</H2>
        <P>{selected.label}</P>
        <Muted>Existencia local en la sucursal elegida: {currentQty ?? '...'}</Muted>
      </View>

      {allowedTypes.length > 1 ? (
        <>
          <H2>Tipo</H2>
          <ChipRow>
            {allowedTypes.map((t) => (
              <Chip key={t} label={TYPE_LABEL[t]} selected={type === t} onPress={() => setType(t)} />
            ))}
          </ChipRow>
        </>
      ) : null}
      <Muted>{TYPE_HELP[type]}</Muted>

      {type === 'entrada' && access ? (
        access.allowed ? (
          access.viaGrant ? (
            <Banner kind="ok" title="Permiso temporal vigente" text={`Vence en ${access.minutesLeft} min.${access.warnings.length ? ' ' + access.warnings.join(' ') : ''}`} />
          ) : null
        ) : (
          <Banner kind="error" title="Entrada bloqueada" text={access.message} />
        )
      ) : null}

      {siblings.length > 1 ? (
        <>
          <H2>Variante</H2>
          <ChipRow>
            {siblings.map((s) => (
              <Chip key={s.variantId} label={s.label} selected={s.variantId === variantId} onPress={() => setVariantId(s.variantId)} />
            ))}
          </ChipRow>
        </>
      ) : null}

      <Field
        label={type === 'conteo' ? 'Cantidad contada' : type === 'ajuste' ? 'Cantidad (con signo)' : 'Cantidad'}
        value={qtyText}
        onChangeText={setQtyText}
        keyboardType={type === 'ajuste' ? 'default' : 'number-pad'}
        inputMode={type === 'ajuste' ? undefined : 'numeric'}
      />

      {myBranches.length > 1 ? (
        <>
          <H2>Sucursal</H2>
          <ChipRow>
            {myBranches.map((b) => (
              <Chip key={b.id} label={b.name} selected={b.id === branchId} onPress={() => setBranchId(b.id)} />
            ))}
          </ChipRow>
        </>
      ) : null}

      <Field label="Lugar (vitrina, bodega, estante...)" value={location} onChangeText={setLocation} autoCapitalize="sentences" />

      <Field label="Motivo" value={reason} onChangeText={setReason} autoCapitalize="sentences" hint="Obligatorio. Queda en el historial y en la auditoría." />
      <ChipRow>
        {QUICK_REASONS[type].map((r) => (
          <Chip key={r} label={r} onPress={() => setReason(r)} />
        ))}
      </ChipRow>

      {error ? <Banner kind="error" text={error} /> : null}

      <Button title="Guardar movimiento" onPress={() => void submit()} loading={busy} disabled={entryBlocked} />
      <Button title="Cancelar" variant="secondary" onPress={onClose} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  summary: { backgroundColor: colors.surface, borderRadius: 12, padding: space.md, gap: 2, borderWidth: 1, borderColor: colors.border },
});
