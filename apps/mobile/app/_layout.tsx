/**
 * Raíz de la app: proveedores globales, pantalla de arranque/errores y "guardia" de navegación según
 * la fase (login -> terminal -> sucursal -> listo). El servidor es quien autoriza de verdad; ocultar o
 * redirigir pantallas aquí es solo comodidad.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../src/state/AppContext';
import { AlertsProvider } from '../src/state/AlertsContext';
import { CartProvider } from '../src/state/CartContext';
import { LOGO_ASPECT, colors, space } from '../src/theme';

function Gate() {
  const { phase, session } = useApp();
  const adminShownFor = useRef<string | null>(null);
  const router = useRouter();
  const segments = useSegments() as string[];
  const navState = useRootNavigationState();
  const first = segments[0];

  useEffect(() => {
    if (!navState?.key) return; // el navegador aún no está montado
    const atRoot = first === undefined || first === 'index';
    switch (phase) {
      case 'login':
        if (first !== 'login') router.replace('/login');
        break;
      case 'terminal':
        if (first !== 'terminal-setup') router.replace('/terminal-setup');
        break;
      case 'sucursal':
        if (first !== 'branch') router.replace('/branch');
        break;
      case 'listo':
        if (atRoot || first === 'login') {
          router.replace('/home');
          // v2: el gerente entra al Panel administrativo (una vez por inicio de sesión); el vendedor no lo ve.
          if (session?.user.role === 'gerente' && adminShownFor.current !== session.user.id) {
            adminShownFor.current = session.user.id;
            setTimeout(() => router.push('/admin'), 0);
          }
        }
        break;
      default:
        break;
    }
  }, [phase, first, navState?.key, router, session]);

  return null;
}

function Overlay() {
  const { phase, fatalError } = useApp();
  if (phase !== 'cargando' && phase !== 'error') return null;
  return (
    <View style={styles.overlay}>
      <Image source={require('../assets/logo-app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Esotérica Amara" />
      {phase === 'cargando' ? (
        <ActivityIndicator color={colors.gold} size="large" />
      ) : (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>No se pudo abrir la base de datos</Text>
          <Text style={styles.errorText}>{fatalError}</Text>
          <Text style={styles.errorText}>No se borró nada. Cierra la app y vuelve a abrirla; si persiste, avisa al administrador antes de reinstalar (los datos locales sin enviar podrían perderse).</Text>
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <CartProvider>
          <AlertsProvider>
          <StatusBar style="dark" />
          <Gate />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '800' },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
              headerBackTitle: 'Atrás',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="terminal-setup" options={{ title: 'Terminal' }} />
            <Stack.Screen name="branch" options={{ title: 'Sucursal' }} />
            <Stack.Screen name="cart" options={{ title: 'Venta de emergencia' }} />
            <Stack.Screen name="ticket/[id]" options={{ title: 'Ticket' }} />
            <Stack.Screen name="codes" options={{ title: 'Códigos' }} />
            <Stack.Screen name="entry" options={{ title: 'Entrada de mercancía' }} />
            <Stack.Screen name="pc-link" options={{ title: 'Vincular con la PC' }} />
            <Stack.Screen name="pc-scanner" options={{ title: 'Escáner de la PC' }} />
            <Stack.Screen name="sync" options={{ title: 'Sincronización' }} />
            <Stack.Screen name="summary" options={{ title: 'Resumen de ventas' }} />
            <Stack.Screen name="product-new" options={{ title: 'Alta de producto' }} />
            <Stack.Screen name="about" options={{ title: 'Compatibilidad' }} />
            <Stack.Screen name="admin" options={{ title: 'Panel administrativo' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notificaciones' }} />
            <Stack.Screen name="today" options={{ title: 'Tickets de hoy' }} />
            <Stack.Screen name="cash" options={{ title: 'Caja' }} />
            <Stack.Screen name="adjust" options={{ title: 'Devolución o cancelación' }} />
            <Stack.Screen name="tokens" options={{ title: 'Tokens de seguridad' }} />
            <Stack.Screen name="limpias" options={{ title: 'Limpias' }} />
            <Stack.Screen name="extras" options={{ title: 'Extras' }} />
            <Stack.Screen name="labels" options={{ title: 'Etiquetas' }} />
            <Stack.Screen name="product-sales" options={{ title: 'Ventas del producto' }} />
          </Stack>
          <Overlay />
          </AlertsProvider>
        </CartProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.xl },
  logo: { width: 220, aspectRatio: LOGO_ASPECT },
  errorBox: { gap: space.sm },
  errorTitle: { fontSize: 18, fontWeight: '800', color: colors.danger, textAlign: 'center' },
  errorText: { fontSize: 14, color: colors.text, textAlign: 'center' },
});
