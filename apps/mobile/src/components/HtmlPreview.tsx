/**
 * Vista previa de un documento HTML (ticket, etiquetas, cierre, permiso) en un WebView. Es EL MISMO HTML que se manda a
 * imprimir o a PDF, así que lo que se ve aquí es lo que se imprime (la hoja real depende de la impresora/servicio de Android).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, radius } from '../theme';

export function HtmlPreview({ html, height = 380, style }: { html: string; height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.box, { height }, style]}>
      <WebView
        source={{ html }}
        style={styles.web}
        scalesPageToFit={false}
        javaScriptEnabled={false}
        setSupportMultipleWindows={false}
        accessibilityLabel="Vista previa del documento"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.white },
  web: { flex: 1, backgroundColor: colors.white },
});
