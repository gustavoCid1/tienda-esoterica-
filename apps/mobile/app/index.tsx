import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../src/theme';

/** Ruta raíz: solo espera; el guardia de app/_layout.tsx redirige según la fase. */
export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}
