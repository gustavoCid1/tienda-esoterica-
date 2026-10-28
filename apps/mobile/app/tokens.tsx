/**
 * Tokens de seguridad (SOLO gerente, SOLO en línea): crear con propósitos y duración (minutos u horas, hasta 7 días),
 * ver estado y revocar. El CÓDIGO (hasta 10 caracteres) lo genera el servidor y se muestra UNA sola vez, aquí mismo,
 * justo después de crear el token. El "ticket de permiso" (violeta) solo puede generarse mientras ese código está en pantalla.
 * Crear exige confirmar la contraseña (POST /auth/reauth -> cabecera x-reauth), como pide el servidor.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatMxDateTime, tokenStatus } from '@amara/shared';
import type { TokenPurpose } from '@amara/shared';
import { Banner, Button, Card, Chip, ChipRow, Divider, Field, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { DocPreview } from '../src/components/DocPreview';
import { PermitButton } from '../src/components/PermitButton';
import { Sheet } from '../src/components/Sheet';
import { PURPOSE_NAME, formatDuration, groupCode, minutesBetween, permitHtml } from '../src/lib/documents';
import { STATUS_LABEL, TOKEN_PURPOSE_OPTIONS, buildTokenBody, parseCreatedToken, parseTokenList } from '../src/lib/tokens-form';
import type { CreatedToken, DurationUnit, TokenRow } from '../src/lib/tokens-form';
import { ApiError } from '../src/services/api';
import { useApp } from '../src/state/AppContext';
import { DOC_COLORS } from '../src/lib/documents';
import { colors, space } from '../src/theme';

interface JustCreated extends CreatedToken {
  label: string;
  purposes: TokenPurpose[];
  issuedAtIso: string;
  maxUses: number | null;
  branchName: string | null;
}

export default function Tokens() {
  const app = useApp();
  const params = useLocalSearchParams<{ nuevo?: string }>();
  const { session, device, online, api } = app;
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(params.nuevo === '1');
  const [label, setLabel] = useState('');
  const [purposes, setPurposes] = useState<TokenPurpose[]>([]);
  const [durationText, setDurationText] = useState('1');
  const [unit, setUnit] = useState<DurationUnit>('horas');
  const [codeLength, setCodeLength] = useState('8');
  const [maxUses, setMaxUses] = useState('');
  const [thisBranch, setThisBranch] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<JustCreated | null>(null);
  const [permitDoc, setPermitDoc] = useState<string | null>(null);

  const canUse = online && !!session?.token;

  const load = useCallback(async () => {
    if (!canUse) return;
    setLoading(true);
    try {
      setRows(parseTokenList(await api.get<unknown>('/security/tokens')));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Tu rol no puede ver los tokens.' : e instanceof Error ? e.message : 'No se pudo cargar la lista.');
    } finally {
      setLoading(false);
    }
  }, [api, canUse]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // Al salir de la pantalla el código recién creado se descarta: el servidor no lo vuelve a mostrar.
      return () => {
        setCreated(null);
        setPermitDoc(null);
      };
    }, [load]),
  );

  useEffect(() => {
    if (params.nuevo === '1') setShowForm(true);
  }, [params.nuevo]);

  if (!session || !device) return <Loading />;
  if (!app.can('config.editar')) return <Screen><Banner kind="error" text="Solo el gerente puede administrar tokens de seguridad." /></Screen>;
  const branch = app.myBranches.find((b) => b.id === device.branchId);

  function togglePurpose(p: TokenPurpose) {
    setPurposes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  function askToCreate() {
    setFormError(null);
    const r = buildTokenBody({ label, purposes, durationText, unit, codeLengthText: codeLength, maxUsesText: maxUses, branchId: thisBranch ? device!.branchId : null });
    if (!r.ok) return setFormError(r.error);
    setAskPassword(true);
  }

  async function create() {
    if (!device || !session) return;
    const r = buildTokenBody({ label, purposes, durationText, unit, codeLengthText: codeLength, maxUsesText: maxUses, branchId: thisBranch ? device.branchId : null });
    if (!r.ok) return setFormError(r.error);
    setBusy(true);
    setFormError(null);
    try {
      const re = await api.post<{ token?: string }>('/auth/reauth', { password });
      if (!re.token) throw new Error('El servidor no confirmó la contraseña.');
      const issuedAtIso = new Date().toISOString();
      const json = await api.post<unknown>('/security/tokens', r.body, { headers: { 'x-reauth': re.token } });
      const t = parseCreatedToken(json);
      if (!t) throw new Error('El servidor no devolvió el código del token.');
      setPassword('');
      setAskPassword(false);
      setShowForm(false);
      setCreated({ ...t, label: r.body.label, purposes: r.body.purposes, issuedAtIso, maxUses: r.body.maxUses ?? null, branchName: thisBranch ? (branch?.name ?? null) : null });
      setLabel('');
      setPurposes([]);
      void load();
    } catch (e) {
      setAskPassword(false);
      setPassword('');
      setFormError(e instanceof ApiError && e.status === 401 ? 'Contraseña incorrecta.' : e instanceof Error ? e.message : 'No se pudo crear el token.');
    } finally {
      setBusy(false);
    }
  }

  function revoke(t: TokenRow) {
    Alert.alert('Revocar token', `¿Revocar "${t.label || t.id.slice(0, 8)}"? Dejará de servir de inmediato en línea y en cada teléfono al sincronizar.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Revocar',
        style: 'destructive',
        onPress: () => {
          api
            .post<unknown>(`/security/tokens/${encodeURIComponent(t.id)}/revoke`, {})
            .then(() => load())
            .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo revocar.'));
        },
      },
    ]);
  }

  const permit = created
    ? permitHtml({
        code: created.code,
        label: created.label,
        purposes: created.purposes,
        issuedAtIso: created.issuedAtIso,
        expiresAtIso: created.expiresAt,
        branchName: created.branchName,
        forUserName: null,
        maxUses: created.maxUses,
        authorizedBy: session.user.name,
      })
    : '';

  return (
    <Screen edges={['left', 'right']}>
      <H1>Tokens de seguridad</H1>
      {!canUse ? <Banner kind="warn" title="Se necesita conexión" text="Los tokens se crean, consultan y revocan solo en línea, con la sesión iniciada con internet." /> : null}
      {error ? <Banner kind="error" text={error} /> : null}

      {created ? (
        <Card style={{ borderColor: DOC_COLORS.permiso.main, borderWidth: 2 }}>
          <H2>Token creado</H2>
          <Text style={styles.code} selectable accessibilityLabel={`Código ${created.code.split('').join(' ')}`}>
            {groupCode(created.code)}
          </Text>
          <Banner kind="warn" title="Se muestra una sola vez" text="Anótalo o genera el ticket de permiso AHORA. Al salir de esta pantalla el código ya no se puede consultar (solo se guarda un hash)." />
          <Row label="Para" value={created.purposes.map((p) => PURPOSE_NAME[p]).join(', ')} />
          <Row label="Vence" value={formatMxDateTime(created.expiresAt)} />
          <Row label="Duración" value={formatDuration(minutesBetween(created.issuedAtIso, created.expiresAt))} />
          <PermitButton title="Generar ticket de permiso" onPress={() => setPermitDoc(permit)} />
          <Button title="Ya lo anoté, ocultar código" variant="secondary" onPress={() => { setCreated(null); setPermitDoc(null); }} />
        </Card>
      ) : null}

      {!showForm ? <Button title="Crear token" onPress={() => setShowForm(true)} disabled={!canUse} /> : null}

      {showForm ? (
        <Card>
          <H2>Nuevo token</H2>
          <Field label="¿Para qué es? (nombre)" value={label} onChangeText={setLabel} placeholder="Ej. Cierre de Ana" maxLength={80} />
          <Muted>Propósitos (elige uno o más)</Muted>
          <ChipRow>
            {TOKEN_PURPOSE_OPTIONS.map((p) => (
              <Chip key={p.id} label={p.label} selected={purposes.includes(p.id)} onPress={() => togglePurpose(p.id)} />
            ))}
          </ChipRow>
          <Field label="Duración" value={durationText} onChangeText={setDurationText} keyboardType="decimal-pad" hint="De 1 minuto a 7 días." />
          <ChipRow>
            <Chip label="Minutos" selected={unit === 'minutos'} onPress={() => setUnit('minutos')} />
            <Chip label="Horas" selected={unit === 'horas'} onPress={() => setUnit('horas')} />
          </ChipRow>
          <Field label="Largo del código (6 a 10)" value={codeLength} onChangeText={setCodeLength} keyboardType="number-pad" maxLength={2} />
          <Field label="Máximo de usos (opcional)" value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" hint="Vacío = sin límite dentro de su vigencia." />
          <ChipRow>
            <Chip label="Solo esta sucursal" selected={thisBranch} onPress={() => setThisBranch(true)} />
            <Chip label="Cualquier sucursal mía" selected={!thisBranch} onPress={() => setThisBranch(false)} />
          </ChipRow>
          {formError ? <Banner kind="error" text={formError} /> : null}
          <Button title="Crear token" onPress={askToCreate} loading={busy} disabled={!canUse} />
          <Button title="Cancelar" variant="secondary" onPress={() => { setShowForm(false); setFormError(null); }} disabled={busy} />
        </Card>
      ) : null}

      <H2>Tokens</H2>
      {loading ? <Loading /> : null}
      {!loading && rows.length === 0 && canUse ? <Muted>No hay tokens todavía.</Muted> : null}
      {rows.map((t) => {
        const st = t.status ?? tokenStatus(t, new Date().toISOString());
        return (
          <Card key={t.id}>
            <View style={styles.head}>
              <Text style={styles.name}>{t.label || 'Sin nombre'}</Text>
              <Text style={[styles.status, st === 'vigente' ? { color: colors.ok } : { color: colors.muted }]}>{STATUS_LABEL[st] ?? st}</Text>
            </View>
            <Muted>{t.purposes.map((p) => PURPOSE_NAME[p]).join(', ') || 'Sin propósito'}</Muted>
            <Row label="Vence" value={t.expiresAt ? formatMxDateTime(t.expiresAt) : '-'} />
            <Row label="Usos" value={t.maxUses === null ? `${t.usedCount} (sin límite)` : `${t.usedCount} de ${t.maxUses}`} />
            {t.createdByName ? <Row label="Creó" value={t.createdByName} /> : null}
            <Divider />
            {st === 'vigente' || st === 'pendiente' ? <Button title="Revocar" variant="danger" onPress={() => revoke(t)} /> : null}
          </Card>
        );
      })}

      <Sheet visible={askPassword} title="Confirma tu contraseña" onClose={() => { setAskPassword(false); setPassword(''); }}>
        <Muted>Crear un token es una acción sensible: el servidor pide confirmar tu contraseña.</Muted>
        <Field label="Tu contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        <Button title="Crear token" onPress={() => void create()} loading={busy} disabled={password === ''} />
        <Button title="Cancelar" variant="secondary" onPress={() => { setAskPassword(false); setPassword(''); }} disabled={busy} />
      </Sheet>

      <DocPreview
        visible={permitDoc !== null}
        title="Ticket de permiso"
        html={permitDoc ?? ''}
        onClose={() => setPermitDoc(null)}
        note="Color violeta: no es un ticket de venta. En impresoras de un solo color saldrá en negro; el rótulo y el marco lo distinguen."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 34, fontWeight: '900', letterSpacing: 3, textAlign: 'center', color: DOC_COLORS.permiso.main, backgroundColor: DOC_COLORS.permiso.tint, paddingVertical: space.md, borderRadius: 12, fontFamily: 'monospace' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  name: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  status: { fontSize: 14, fontWeight: '800' },
});
