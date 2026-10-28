/**
 * Componentes de interfaz básicos: blanco predominante, dorado de acento, botones grandes.
 * Sin emojis ni imágenes decorativas.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RefreshControlProps, StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { colors, radius, space } from '../theme';

// ───────────── Pantalla ─────────────
export function Screen(props: {
  children: React.ReactNode;
  scroll?: boolean;
  /** Bordes con margen seguro. Con encabezado nativo basta ['left','right','bottom']. */
  edges?: Edge[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { children, scroll = true, edges = ['left', 'right', 'bottom'], refreshControl, contentStyle } = props;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView refreshControl={refreshControl} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, contentStyle]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

// ───────────── Texto ─────────────
export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}
export function P({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.p, style]}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

// ───────────── Botón (alto mínimo 56) ─────────────
export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'danger';

export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { title, onPress, variant = 'primary', disabled, loading, style } = props;
  const off = disabled || loading;
  const v = buttonStyles[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, v.box, off && styles.buttonOff, pressed && !off && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color={v.spinner} /> : <Text style={[styles.buttonText, { color: v.text }]}>{title}</Text>}
    </Pressable>
  );
}

const buttonStyles: Record<ButtonVariant, { box: ViewStyle; text: string; spinner: string }> = {
  primary: { box: { backgroundColor: colors.goldBright }, text: colors.dark, spinner: colors.dark },
  secondary: { box: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.borderStrong }, text: colors.dark, spinner: colors.dark },
  dark: { box: { backgroundColor: colors.dark }, text: colors.white, spinner: colors.white },
  danger: { box: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.danger }, text: colors.danger, spinner: colors.danger },
};

// ───────────── Tarjeta, fila, divisor ─────────────
export function Card({ children, style, tone = 'plain' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'plain' | 'gold' | 'dark' }) {
  return <View style={[styles.card, tone === 'gold' && styles.cardGold, tone === 'dark' && styles.cardDark, style]}>{children}</View>;
}

export function Row({ label, value, strong, valueColor }: { label: string; value: string; strong?: boolean; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.bold, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** Fila grande navegable (menú). */
export function MenuItem({ title, subtitle, onPress, badge }: { title: string; subtitle?: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <Text style={styles.menuTitle}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.chevron}>{'>'}</Text>
    </Pressable>
  );
}

// ───────────── Campo de texto ─────────────
export function Field({ label, hint, error, style, ...input }: { label: string; hint?: string; error?: string | null; style?: StyleProp<ViewStyle> } & TextInputProps) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#8A8A8A"
        accessibilityLabel={label}
        {...input}
        style={[styles.input, error ? styles.inputError : null, input.multiline ? styles.inputMulti : null]}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

// ───────────── Chip (filtros / selección) ─────────────
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

// ───────────── Aviso ─────────────
export type BannerKind = 'info' | 'warn' | 'error' | 'ok';

export function Banner({ kind = 'info', title, text }: { kind?: BannerKind; title?: string; text: string }) {
  const b = bannerStyles[kind];
  return (
    <View style={[styles.banner, { backgroundColor: b.bg, borderLeftColor: b.bar }]} accessibilityRole="alert">
      {title ? <Text style={[styles.bannerTitle, { color: b.text }]}>{title}</Text> : null}
      <Text style={[styles.bannerText, { color: b.text }]}>{text}</Text>
    </View>
  );
}

const bannerStyles: Record<BannerKind, { bg: string; bar: string; text: string }> = {
  info: { bg: colors.surface, bar: colors.border, text: colors.muted },
  warn: { bg: colors.goldSoft, bar: colors.gold, text: colors.dark },
  error: { bg: colors.dangerSoft, bar: colors.danger, text: colors.danger },
  ok: { bg: colors.okSoft, bar: colors.ok, text: colors.ok },
};

export function Spacer({ h = space.md }: { h?: number }) {
  return <View style={{ height: h }} />;
}

export function Loading({ text = 'Cargando...' }: { text?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  h1: { fontSize: 26, fontWeight: '800', color: colors.text },
  h2: { fontSize: 19, fontWeight: '700', color: colors.text },
  p: { fontSize: 16, color: colors.text, lineHeight: 22 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  bold: { fontWeight: '800' },
  button: { minHeight: 56, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  buttonOff: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardGold: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  cardDark: { backgroundColor: colors.dark, borderColor: colors.dark },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text },
  rowValue: { fontSize: 15, color: colors.text, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border },
  menuItem: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.md, paddingHorizontal: space.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, gap: space.md },
  menuTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  chevron: { fontSize: 22, color: colors.gold, fontWeight: '800' },
  badge: { backgroundColor: colors.goldBright, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontWeight: '800', color: colors.dark, fontSize: 13 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 17, color: colors.text, backgroundColor: colors.white },
  inputMulti: { minHeight: 90, paddingTop: space.md, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 14 },
  chip: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: 22, borderWidth: 1.5, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.dark, borderColor: colors.dark },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.text },
  chipTextOn: { color: colors.white },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  banner: { borderLeftWidth: 5, borderRadius: radius.sm, padding: space.md, gap: 2 },
  bannerTitle: { fontSize: 15, fontWeight: '800' },
  bannerText: { fontSize: 14, lineHeight: 20 },
  loading: { alignItems: 'center', gap: space.md, padding: space.xl },
});
