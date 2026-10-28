/**
 * Etiquetas: se eligen productos y copias, se ven en una vista previa de la hoja (mostrar u ocultar nombre, precio y QR)
 * y se mandan a Imprimir o a Compartir/guardar PDF. La vista previa es el MISMO HTML que se imprime.
 * Los QR se generan en el teléfono (qrcode core) y el código de barras con el codificador Code 128 propio.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMXN } from '@amara/shared';
import type { CatalogHit } from '@amara/database';
import { Banner, Button, Card, Chip, ChipRow, Field, H1, H2, Loading, Muted, Screen } from '../src/components/ui';
import { DocPreview } from '../src/components/DocPreview';
import { HtmlPreview } from '../src/components/HtmlPreview';
import { DEFAULT_LABEL_OPTIONS, LABEL_SIZES, MAX_COPIES_PER_ITEM, MAX_LABELS, labelsDocument } from '../src/lib/labels';
import type { LabelItem, LabelOptions } from '../src/lib/labels';
import { qrMatrix } from '../src/services/qr';
import { useApp } from '../src/state/AppContext';
import { colors, radius, space } from '../src/theme';

interface Picked {
  hit: CatalogHit;
  copies: number;
}

const toItem = (p: Picked): LabelItem => ({
  name: p.hit.productName,
  variantLabel: p.hit.label,
  priceCents: p.hit.priceCents,
  code: p.hit.barcode || p.hit.internalCode || p.hit.sku,
  qrValue: p.hit.qrValue,
  copies: p.copies,
});

export default function Labels() {
  const { store, device } = useApp();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CatalogHit[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [opts, setOpts] = useState<LabelOptions>(DEFAULT_LABEL_OPTIONS);
  const [open, setOpen] = useState(false);

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

  const doc = useMemo(() => {
    if (picked.length === 0) return null;
    try {
      return { ok: true as const, value: labelsDocument(picked.map(toItem), opts, qrMatrix) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'No se pudo armar la hoja de etiquetas.' };
    }
  }, [picked, opts]);

  if (!store || !device) return <Loading />;

  function add(h: CatalogHit) {
    setPicked((cur) => (cur.some((p) => p.hit.variantId === h.variantId) ? cur : [...cur, { hit: h, copies: 1 }]));
    setQuery('');
  }
  const setCopies = (id: string, n: number) =>
    setPicked((cur) => cur.flatMap((p) => (p.hit.variantId !== id ? [p] : n <= 0 ? [] : [{ ...p, copies: Math.min(MAX_COPIES_PER_ITEM, n) }])));
  const toggle = (k: 'showName' | 'showPrice' | 'showQr' | 'showBarcode') => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const total = picked.reduce((a, p) => a + p.copies, 0);

  return (
    <Screen>
      <H1>Etiquetas</H1>
      <Field label="Buscar producto" value={query} onChangeText={setQuery} placeholder="Nombre o código" autoCorrect={false} />
      {found.map((h) => (
        <Pressable key={h.variantId} accessibilityRole="button" onPress={() => add(h)} style={({ pressed }) => [styles.result, pressed && { opacity: 0.7 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{h.productName}</Text>
            <Text style={styles.sub}>
              {h.label} · {formatMXN(h.priceCents)}
            </Text>
          </View>
          <Text style={styles.plus}>+</Text>
        </Pressable>
      ))}

      <Card>
        <H2>Para imprimir ({total})</H2>
        {picked.length === 0 ? <Muted>Busca y agrega los productos que quieres etiquetar.</Muted> : null}
        {picked.map((p) => (
          <View key={p.hit.variantId} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{p.hit.productName}</Text>
              <Text style={styles.sub}>
                {p.hit.label} · {formatMXN(p.hit.priceCents)}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Menos copias" style={styles.step} onPress={() => setCopies(p.hit.variantId, p.copies - 1)}>
              <Text style={styles.stepText}>-</Text>
            </Pressable>
            <Text style={styles.qty}>{p.copies}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Más copias" style={styles.step} onPress={() => setCopies(p.hit.variantId, p.copies + 1)}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        ))}
        {total > MAX_LABELS ? <Banner kind="warn" text={`Se imprimirán como máximo ${MAX_LABELS} etiquetas por trabajo.`} /> : null}
      </Card>

      <Card>
        <H2>Qué mostrar</H2>
        <ChipRow>
          <Chip label="Nombre" selected={opts.showName} onPress={() => toggle('showName')} />
          <Chip label="Precio" selected={opts.showPrice} onPress={() => toggle('showPrice')} />
          <Chip label="QR" selected={opts.showQr} onPress={() => toggle('showQr')} />
          <Chip label="Código de barras" selected={opts.showBarcode} onPress={() => toggle('showBarcode')} />
        </ChipRow>
        <Muted>Tamaño de etiqueta</Muted>
        <ChipRow>
          {LABEL_SIZES.map((s) => (
            <Chip key={s.id} label={s.name} selected={opts.size === s.id} onPress={() => setOpts((o) => ({ ...o, size: s.id }))} />
          ))}
        </ChipRow>
      </Card>

      {doc && !doc.ok ? <Banner kind="error" text={doc.error} /> : null}
      {doc && doc.ok ? (
        <>
          <H2>Vista previa</H2>
          <HtmlPreview html={doc.value.html} height={300} />
          <Button title="Imprimir o compartir PDF" onPress={() => setOpen(true)} />
          <DocPreview visible={open} title="Etiquetas" html={doc.value.html} page={{ widthPt: doc.value.pageWidthPt, heightPt: doc.value.pageHeightPt }} onClose={() => setOpen(false)} note="El tamaño real depende de la impresora; prueba primero con una etiqueta." />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '800', color: colors.text },
  qty: { minWidth: 28, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.text },
  result: { flexDirection: 'row', alignItems: 'center', padding: space.md, minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  plus: { fontSize: 28, fontWeight: '800', color: colors.gold, paddingHorizontal: space.sm },
});
