/** Botón violeta de los "tickets de permiso": distinto al botón dorado/negro para que no se confunda con acciones de venta. */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { DOC_COLORS } from '../lib/documents';
import { colors, radius, space } from '../theme';

export function PermitButton({ title, onPress, loading, disabled, style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.btn, off && { opacity: 0.45 }, pressed && !off && { opacity: 0.75 }, style]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.text}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: DOC_COLORS.permiso.main },
  text: { fontSize: 17, fontWeight: '800', textAlign: 'center', color: colors.white },
});
