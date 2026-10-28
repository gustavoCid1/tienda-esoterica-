import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';
import type { ScanMode } from '../state/AppContext';

/**
 * Modo del escáner mostrado de forma inconfundible:
 *  VENTA      -> fondo dorado: cada lectura se agrega al carrito con 1 unidad.
 *  INVENTARIO -> fondo negro:  cada lectura abre el formulario de movimiento.
 */
export function ModeBadge({ mode }: { mode: ScanMode }) {
  const venta = mode === 'venta';
  return (
    <View style={[styles.badge, venta ? styles.venta : styles.inv]} accessibilityRole="header" accessibilityLabel={`Modo ${venta ? 'venta' : 'inventario'}`}>
      <Text style={[styles.title, { color: venta ? colors.dark : colors.white }]}>MODO {venta ? 'VENTA' : 'INVENTARIO'}</Text>
      <Text style={[styles.sub, { color: venta ? colors.dark : colors.white }]}>
        {venta ? 'Cada lectura se agrega al carrito (1 unidad).' : 'Cada lectura abre el formulario de movimiento.'}
      </Text>
    </View>
  );
}

/** Selector de dos botones grandes. */
export function ModeSwitch({ mode, onChange }: { mode: ScanMode; onChange: (m: ScanMode) => void }) {
  return (
    <View style={styles.switchRow}>
      <Seg label="Venta" on={mode === 'venta'} onPress={() => onChange('venta')} />
      <Seg label="Inventario" on={mode === 'inventario'} onPress={() => onChange('inventario')} />
    </View>
  );
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.seg, on && styles.segOn]}>
      <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: radius.md, padding: space.md, gap: 2 },
  venta: { backgroundColor: colors.goldBright },
  inv: { backgroundColor: colors.dark },
  title: { fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  sub: { fontSize: 14 },
  switchRow: { flexDirection: 'row', gap: space.sm },
  seg: { flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  segOn: { backgroundColor: colors.dark },
  segText: { fontSize: 17, fontWeight: '800', color: colors.dark },
  segTextOn: { color: colors.white },
});
