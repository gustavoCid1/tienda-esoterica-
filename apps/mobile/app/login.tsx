/**
 * Bienvenida e inicio de sesión. El logo se muestra completo y sin deformar (aspect ratio fijo).
 * En línea: contra la API. Sin conexión: contra el verificador local (nunca contraseñas en texto plano).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, H1, Muted, P, Spacer } from '../src/components/ui';
import { useApp } from '../src/state/AppContext';
import { ApiError } from '../src/services/api';
import { AuthError } from '../src/services/auth';
import { LOGO_ASPECT, colors, space } from '../src/theme';

export default function LoginScreen() {
  const app = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'online' | 'offline'>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerOffline, setOfferOffline] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [showServer, setShowServer] = useState(!app.apiUrl);
  const [serverUrl, setServerUrl] = useState(app.apiUrl);

  useEffect(() => {
    if (!app.apiUrl) return;
    setServerUrl((cur) => cur || app.apiUrl);
  }, [app.apiUrl]);

  // ¿Este usuario ya puede entrar sin conexión en este teléfono?
  useEffect(() => {
    let off = false;
    if (username.trim().length < 3) {
      setHasProfile(false);
      return;
    }
    app.hasOfflineLogin(username).then((v) => !off && setHasProfile(v)).catch(() => undefined);
    return () => {
      off = true;
    };
    // hasOfflineLogin es estable; depender de todo `app` re-ejecutaría esto en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, app.hasOfflineLogin]);

  const canSubmit = username.trim().length >= 3 && password.length > 0;
  const showOffline = hasProfile && (!app.online || offerOffline);

  async function onLogin() {
    setError(null);
    setBusy('online');
    try {
      if (serverUrl.trim().replace(/\/+$/, '') !== app.apiUrl) await app.setApiUrl(serverUrl);
      const r = await app.login(username, password);
      if (!r.offlineReady) {
        Alert.alert('Acceso sin conexión no disponible', 'Entraste en línea, pero no se pudo preparar el acceso sin conexión para este usuario (la contraseña es demasiado corta para el verificador local).');
      }
      // La navegación la hace el guardia de app/_layout.tsx al cambiar la fase.
    } catch (e) {
      if (e instanceof ApiError && e.unreachable) {
        setError('No hay conexión con el servidor.' + (hasProfile ? ' Puedes entrar sin conexión.' : ' Para el primer inicio de sesión se necesita internet.'));
        setOfferOffline(true);
      } else if (e instanceof ApiError && e.status === 429) {
        setError('Demasiados intentos. Espera unos minutos.');
      } else if (e instanceof ApiError || e instanceof AuthError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function onOffline() {
    setError(null);
    setBusy('offline');
    try {
      await app.loginWithoutConnection(username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión sin conexión.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <Image source={require('../assets/logo-app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Esotérica Amara" />
          </View>
          <H1 style={styles.center}>Bienvenido</H1>
          <Muted style={styles.center}>Inicia sesión para vender, consultar inventario y escanear.</Muted>
          <Spacer h={space.sm} />

          <Field label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" />
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="password" />

          {error ? <Banner kind="error" text={error} /> : null}
          {busy === 'offline' ? <Banner kind="info" text="Verificando... puede tardar unos segundos." /> : null}
          {busy === 'online' ? <Banner kind="info" text="Entrando. La primera vez se prepara el acceso sin conexión y puede tardar unos segundos." /> : null}

          <Button title="Iniciar sesión" onPress={() => void onLogin()} loading={busy === 'online'} disabled={!canSubmit || busy !== null} />
          {showOffline ? <Button title="Entrar sin conexión" variant="secondary" onPress={() => void onOffline()} loading={busy === 'offline'} disabled={!canSubmit || busy !== null} /> : null}
          {!app.online ? <Muted>Sin conexión: solo pueden entrar usuarios que ya hayan iniciado sesión con internet en este teléfono.</Muted> : null}

          <Spacer />
          <Button title={showServer ? 'Ocultar servidor' : 'Servidor'} variant="secondary" onPress={() => setShowServer((v) => !v)} />
          {showServer ? (
            <>
              <Field label="Dirección del servidor (API)" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://..." hint="La da el administrador. Use https en producción." />
              {!app.apiUrl && !serverUrl ? <P>Escribe la dirección del servidor antes de iniciar sesión.</P> : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: space.xl, gap: space.md, paddingBottom: 48 },
  logoWrap: { alignItems: 'center', paddingVertical: space.md },
  logo: { width: 260, aspectRatio: LOGO_ASPECT, borderRadius: 12 },
  center: { textAlign: 'center' },
});
