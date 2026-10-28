/**
 * "Resumen de ventas de hoy" - pantalla EXCLUSIVA del gerente (permiso estadisticas.ver).
 *
 *  - El vendedor no ve el acceso ni puede abrir esta ruta (redirige), y además el SERVIDOR responde 403.
 *  - Se actualiza: al abrir, al volver a la pantalla (useFocusEffect), al recuperar conexión (NetInfo),
 *    al cambiar fecha/sucursal, tras sincronizar, cada SUMMARY_AUTO_REFRESH_MS mientras se ve, y a mano.
 *  - Con conexión: cifras del SERVIDOR (GET /stats/today; otros rangos /stats/summary).
 *    Sin conexión: cálculo LOCAL (store.summary), rotulado como tal, con última sincronización,
 *    pendientes y el aviso de que puede estar incompleto. NUNCA se suman servidor y local (sin doble conteo).
 *  - Vendido NO es efectivo en caja: el "efectivo esperado" se calcula aparte y se muestra en su propia tarjeta.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { formatMXN, formatMxDateTime, mxTodayKey } from '@amara/shared';
import { Banner, Button, Card, Chip, ChipRow, Divider, Field, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { useApp } from '../src/state/AppContext';
import { useNow } from '../src/hooks';
import { SUMMARY_AUTO_REFRESH_MS } from '../src/config';
import { formatDayRange, presetRange, validateRange } from '../src/lib/date-range';
import type { RangePreset } from '../src/lib/date-range';
import { CASH_VS_SALES_NOTE, methodRows, netExplanation } from '../src/lib/summary-model';
import type { SummaryView } from '../src/lib/summary-model';
import { humanAge } from '../src/lib/staleness';
import { SummaryForbiddenError, loadCashExpected, loadSummaryView } from '../src/services/summary-service';
import type { CashExpected, SummaryQuery } from '../src/services/summary-service';
import { colors, radius, space } from '../src/theme';

type Why = 'focus' | 'auto' | 'manual' | 'change';

export default function SummaryScreen() {
  const app = useApp();
  const { store, device, terminal } = app;
  const allowed = app.can('estadisticas.ver');
  const now = useNow(30_000);

  const [preset, setPreset] = useState<RangePreset>('hoy');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  /** 'todas' = consolidado de todas las sucursales autorizadas. */
  const [branchSel, setBranchSel] = useState<string>(device?.branchId ?? 'todas');
  const [view, setView] = useState<SummaryView | null>(null);
  const [cash, setCash] = useState<CashExpected | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const reqId = useRef(0);
  const loadedKey = useRef('');
  const focused = useRef(false);

  // Cambia con fecha, sucursal o conexión (NetInfo). Los datos sincronizados se recargan con el refresco
  // automático/manual; el propio ciclo de carga ya espera a que termine la sincronización en curso.
  const key = `${preset}|${custom?.from}|${custom?.to}|${branchSel}|${app.online}`;

  const load = useCallback(
    async (why: Why) => {
      if (!store || !device || !terminal || !allowed) return;
      const id = ++reqId.current;
      loadedKey.current = key;
      setLoading(true);
      try {
        // Primero se envía lo pendiente de este teléfono para que el servidor ya lo incluya
        // (así no hay que sumar nada a mano ni hay doble conteo).
        // (con tope de 8 s: si el servidor no responde se sigue y cae a datos locales)
        if (app.online) await Promise.race([app.syncNow(why === 'manual' ? 'manual' : 'auto'), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);

        const today = mxTodayKey();
        const range = preset === 'personalizado' && custom ? custom : presetRange(preset === 'personalizado' ? 'hoy' : preset, today);
        const consolidated = branchSel === 'todas';
        const branchName = app.myBranches.find((b) => b.id === branchSel)?.name ?? 'Sucursal';
        const query: SummaryQuery = {
          fromDay: range.from,
          toDay: range.to,
          branchId: consolidated ? null : branchSel,
          branchLabel: consolidated ? `Consolidado: todas mis sucursales (${app.myBranches.length})` : branchName,
          todayKey: today,
        };
        const deps = { api: app.api, store, online: app.online, nowIso: new Date().toISOString() };
        const [v, c] = await Promise.all([loadSummaryView(deps, query), loadCashExpected(deps, terminal.terminalId)]);
        if (id !== reqId.current) return; // respuesta vieja: ya hay una consulta más nueva
        setView(v);
        setCash(c);
        setError(null);
        setForbidden(false);
      } catch (e) {
        if (id !== reqId.current) return;
        if (e instanceof SummaryForbiddenError) {
          setForbidden(true);
          setView(null);
        } else {
          setError(e instanceof Error ? e.message : 'No se pudo calcular el resumen.');
        }
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, device, terminal, allowed, preset, custom, branchSel, app.online, app.api, app.myBranches, key],
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  // Al abrir y cada vez que se vuelve a la pantalla + refresco automático moderado mientras está visible.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadRef.current('focus');
      const t = setInterval(() => void loadRef.current('auto'), SUMMARY_AUTO_REFRESH_MS);
      return () => {
        focused.current = false;
        clearInterval(t);
      };
    }, []),
  );

  // Cambios de fecha/sucursal, de conexión (NetInfo) y datos sincronizados.
  useEffect(() => {
    if (focused.current && loadedKey.current !== key) void loadRef.current('change');
  }, [key]);

  const ranges = useMemo(() => {
    const today = mxTodayKey();
    return preset === 'personalizado' && custom ? custom : presetRange(preset === 'personalizado' ? 'hoy' : preset, today);
  }, [preset, custom, now]);

  // Un vendedor (u otro rol) NO debe ver esto aunque llegue a la ruta.
  if (!allowed) return <Redirect href="/home" />;
  if (!store || !device || !terminal) return <Loading />;

  function applyCustom() {
    const problem = validateRange(fromText.trim(), toText.trim());
    setRangeError(problem);
    if (problem) return;
    setCustom({ from: fromText.trim(), to: toText.trim() });
    setPreset('personalizado');
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load('manual')} tintColor={colors.gold} />}>
      {/* Selectores */}
      <Card>
        <H2>Periodo</H2>
        <ChipRow>
          <Chip label="Hoy" selected={preset === 'hoy'} onPress={() => setPreset('hoy')} />
          <Chip label="Ayer" selected={preset === 'ayer'} onPress={() => setPreset('ayer')} />
          <Chip label="7 días" selected={preset === '7dias'} onPress={() => setPreset('7dias')} />
          <Chip label="Este mes" selected={preset === 'mes'} onPress={() => setPreset('mes')} />
          <Chip label="Personalizado" selected={preset === 'personalizado'} onPress={() => setPreset('personalizado')} />
        </ChipRow>
        {preset === 'personalizado' ? (
          <>
            <Field label="Desde (AAAA-MM-DD)" value={fromText} onChangeText={setFromText} autoCapitalize="none" autoCorrect={false} placeholder={ranges.from} />
            <Field label="Hasta (AAAA-MM-DD)" value={toText} onChangeText={setToText} autoCapitalize="none" autoCorrect={false} placeholder={ranges.to} error={rangeError} />
            <Button title="Aplicar intervalo" variant="secondary" onPress={applyCustom} />
          </>
        ) : null}
        {app.myBranches.length > 1 ? (
          <>
            <H2>Sucursal</H2>
            <ChipRow>
              {app.myBranches.map((b) => (
                <Chip key={b.id} label={b.name} selected={branchSel === b.id} onPress={() => setBranchSel(b.id)} />
              ))}
              <Chip label="Todas (consolidado)" selected={branchSel === 'todas'} onPress={() => setBranchSel('todas')} />
            </ChipRow>
          </>
        ) : null}
      </Card>

      {forbidden ? <Banner kind="error" title="Sin permiso" text="El servidor indica que tu rol no puede ver el resumen de ventas." /> : null}
      {error ? <Banner kind="error" text={error} /> : null}
      {!view && loading ? <Loading text="Calculando..." /> : null}

      {view ? <SummaryBody view={view} now={now} cash={cash} loading={loading} onRefresh={() => void load('manual')} /> : null}
    </Screen>
  );
}

function SummaryBody({ view, now, cash, loading, onRefresh }: { view: SummaryView; now: number; cash: CashExpected | null; loading: boolean; onRefresh: () => void }) {
  const s = view.summary;
  const local = view.source === 'local';
  const explanation = netExplanation(s);
  const rows = methodRows(s);
  const age = now - Date.parse(view.updatedAt);

  return (
    <>
      {/* Encabezado: fuente, sucursal y actualización */}
      <Card tone={local ? 'plain' : 'gold'} style={local ? styles.localCard : undefined}>
        <Text style={[styles.source, local && { color: colors.danger }]}>{local ? 'DATOS LOCALES (sin conexión)' : 'Datos del servidor'}</Text>
        <Row label="Periodo" value={formatDayRange(view.context.fromDay, view.context.toDay)} strong />
        <Row label="Sucursal" value={view.context.branchLabel} strong />
        <Row label="Última actualización" value={`${formatMxDateTime(view.updatedAt)}${age > 90_000 ? ` (hace ${humanAge(age)})` : ''}`} />
        <Row label="Última sincronización correcta" value={view.lastSyncOkAt ? formatMxDateTime(view.lastSyncOkAt) : 'Nunca'} />
        <Row label="Operaciones pendientes de enviar" value={String(view.pendingOps)} strong={view.pendingOps > 0} />
        <Button title="Actualizar ahora" variant="secondary" onPress={onRefresh} loading={loading} />
      </Card>

      {view.notices.map((n, i) => (
        <Banner key={i} kind={n.kind === 'warn' ? 'warn' : 'info'} text={n.text} />
      ))}

      {/* Cifras principales */}
      <Card>
        <Stat label="Total vendido" value={formatMXN(s.grossCents)} note="Suma de los totales de todos los tickets del periodo, antes de cancelaciones y devoluciones." />
        <Divider />
        <Stat label="Ventas netas" value={formatMXN(s.netCents)} note="Lo vendido menos cancelaciones y devoluciones." big />
        {explanation.map((t, i) => (
          <Muted key={i}>{t}</Muted>
        ))}
        <Divider />
        <Row label="Tickets" value={String(s.ticketCount)} strong />
        <Row label="Promedio por ticket" value={formatMXN(s.avgTicketCents)} strong />
        <Muted>El promedio es ventas netas entre los tickets no cancelados.</Muted>
      </Card>

      {/* Por método de pago */}
      <Card>
        <H2>Por método de pago</H2>
        {rows.map((r) => (
          <View key={r.method} style={styles.method}>
            <Row label={r.label} value={formatMXN(r.grossCents)} strong />
            {r.refundedCents > 0 ? <Muted>Devuelto o cancelado: {formatMXN(r.refundedCents)} · Neto: {formatMXN(r.netCents)}</Muted> : null}
          </View>
        ))}
        <Muted>Importes cobrados por cada método (efectivo sin el cambio entregado).</Muted>
      </Card>

      {/* Cancelaciones y devoluciones, por separado */}
      <Card>
        <H2>Cancelaciones</H2>
        <Row label={`${s.cancelledCount} ${s.cancelledCount === 1 ? 'venta anulada' : 'ventas anuladas'}`} value={formatMXN(s.cancelledCents)} strong />
        <Muted>Anulan una venta completa.</Muted>
      </Card>
      <Card>
        <H2>Devoluciones</H2>
        <Row label={`${s.refundCount} ${s.refundCount === 1 ? 'devolución' : 'devoluciones'}`} value={formatMXN(s.refundedCents)} strong />
        <Muted>Regresan solo parte de una venta.</Muted>
      </Card>

      {/* Efectivo esperado: OTRA cifra, calculada aparte */}
      <Card tone="dark">
        <Text style={styles.cashTitle}>Efectivo esperado en caja (esta terminal)</Text>
        <Text style={styles.cashValue}>{cash && cash.cents !== null ? formatMXN(cash.cents) : 'No disponible'}</Text>
        <Text style={styles.cashNote}>{cash ? cash.note : 'Calculando...'}</Text>
        {cash?.source ? <Text style={styles.cashNote}>Origen: {cash.source === 'servidor' ? 'servidor' : 'cálculo local'}.</Text> : null}
        <Text style={styles.cashNote}>{CASH_VS_SALES_NOTE}</Text>
      </Card>
    </>
  );
}

function Stat({ label, value, note, big }: { label: string; value: string; note?: string; big?: boolean }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && styles.statBig]}>{value}</Text>
      {note ? <Muted>{note}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  source: { fontSize: 15, fontWeight: '900', color: colors.dark, letterSpacing: 0.5 },
  localCard: { borderColor: colors.danger, borderWidth: 2 },
  method: { gap: 2 },
  statLabel: { fontSize: 15, fontWeight: '700', color: colors.muted },
  statValue: { fontSize: 30, fontWeight: '900', color: colors.text },
  statBig: { fontSize: 38, color: colors.gold },
  cashTitle: { fontSize: 16, fontWeight: '800', color: colors.white },
  cashValue: { fontSize: 32, fontWeight: '900', color: colors.goldBright },
  cashNote: { fontSize: 13, color: '#D8D8D8', lineHeight: 19, borderRadius: radius.sm },
});
