/** Ventana (hoja inferior) reutilizable para las pantallas de la v2: autorización, empleado, extra, vistas previas. */
import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '../theme';
import { H2 } from './ui';

export function Sheet({ visible, title, onClose, children, full }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; full?: boolean }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Cerrar ventana" />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, full && styles.full]}>
          <View style={styles.grip} />
          <H2>{title}</H2>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.lg, gap: space.sm, maxHeight: '88%' },
  full: { maxHeight: '96%' },
  grip: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border },
  body: { gap: space.sm, paddingBottom: space.lg },
});
