/**
 * Caja en el teléfono (v2).
 *  - Apertura (solo gerente): se registran la HORA y el monto inicial.
 *  - Cierre: EXIGE contraseña de administrador o token (el gerente confirma con su propia contraseña; el vendedor necesita
 *    la de un administrador o un token de "cierre de caja"). LocalStore lo vuelve a exigir: ocultar el botón no basta.
 *  - El vendedor cuenta a ciegas: no ve el efectivo esperado, la diferencia ni totales.
 *  - Tras cerrar, el gerente puede generar el ticket de cierre.
 */
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { formatMXN, formatMxDateTime } from '@amara/shared';
import { Banner, Button, Card, Divider, Field, H1, H2, Loading, Muted, Row, Screen } from '../src/components/ui';
import { AuthModal } from '../src/components/AuthModal';
import type { AuthSuccess } from '../src/components/AuthModal';
import { DocPreview } from '../src/components/DocPreview';
import { StatusBanner } from '../src/components/StatusBanner';
import { loadClosureTicketData } from '../src/lib/closure-data';
import { closureHtml, differenceText } from '../src/lib/documents';
import { parseMoneyInput } from '../src/lib/money-input';
import { useApp } from '../src/state/AppContext';
import { colors } from '../src/theme';

interface OpenSession {
  id: string;
  openedAt: string;
  openingCents: number;
  expectedCents: number | null;
  operations: number;
}

export default function Cash() {
  const app = useApp();
  const { store, device, actor, session } = app;
  const [open, setOpen] = useState<OpenSession | null | undefined>(undefined);
  const [openingText, setOpeningText] = useState('');
  const [countedText, setCountedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askAuth, setAskAuth] = useState(false);
  const [lastClosed, setLastClosed] = useState<{ sessionId: string; differenceCents: number; provisional: boolean } | null>(null);
  const [closureDoc, setClosureDoc] = useState<string | null>(null);

  const isManager = app.can('caja.corte');

  const load = useCallback(async () => {
    if (!store || !device) return;
    const cur = await store.currentSession(device.terminalId);
    if (!cur) {
      setOpen(null);
      return;
    }
    const { breakdown } = await store.cashBreakdown(cur.id);
    setOpen({ id: cur.id, openedAt: cur.opened_at, openingCents: cur.opening_cents, expectedCents: isManager ? breakdown.expectedCents : null, operations: breakdown.operations });
  }, [store, device, isManager]);

  useFocusEffect(
    useCallback(() => {
      void load().catch((e) => setError(e instanceof Error ? e.message : 'No se pudo leer la caja.'));
    }, [load, app.dataVersion]),
  );

  if (!store || !device || !actor || !session) return <Loading />;

  async function doOpen() {
    if (!store || !device || !actor) return;
    setError(null);
    setNotice(null);
    const cents = parseMoneyInput(openingText);
    if (cents === null) return setError('Escribe el monto con el que abres la caja (puede ser 0).');
    setBusy(true);
    try {
      await store.openCash({ actor, branchId: device.branchId, terminalId: device.terminalId, openingCents: cents });
      setOpeningText('');
      setLastClosed(null);
      setNotice('Caja abierta. Se registraron la hora y el monto inicial.');
      app.notifyDataChanged();
      void app.syncNow('auto');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la caja.');
    } finally {
      setBusy(false);
    }
  }

  async function doClose(auth: AuthSuccess) {
    if (!store || !device || !actor || !open) return;
    setAskAuth(false);
    setError(null);
    const counted = parseMoneyInput(countedText);
    if (counted === null) return setError('Escribe el efectivo contado.');
    setBusy(true);
    try {
      const r = await store.closeCash({
        actor,
        terminalId: device.terminalId,
        countedCents: counted,
        offline: !app.online,
        authorization: auth.authorization,
        authorizationTrusted: auth.trusted,
      });
      setCountedText('');
      setLastClosed({ sessionId: r.sessionId, differenceCents: r.differenceCents, provisional: r.provisional });
      setNotice('Caja cerrada.');
      app.notifyDataChanged();
      void app.syncNow('auto');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar la caja.');
    } finally {
      setBusy(false);
    }
  }

  async function makeTicket() {
    if (!store || !device || !lastClosed) return;
    const branch = app.myBranches.find((b) => b.id === device.branchId);
    const d = await loadClosureTicketData(store, lastClosed.sessionId, { branchName: branch?.name ?? device.branchCode, terminalCode: device.terminalCode });
    if (!d) return setError('No se pudo armar el ticket de cierre.');
    setClosureDoc(closureHtml(d));
  }

  const pending = app.sync.status?.pending ?? 0;
  return (
    <Screen edges={['left', 'right']}>
      <H1>Caja</H1>
      <StatusBanner compact />
      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {open === undefined ? <Loading /> : null}

      {open === null ? (
        <Card>
          <H2>La caja está cerrada</H2>
          {app.can('caja.abrir') ? (
            <>
              <Muted>Al abrir se registran la hora actual y el monto inicial.</Muted>
              <Field label="Monto inicial en caja" value={openingText} onChangeText={setOpeningText} keyboardType="decimal-pad" placeholder="0.00" />
              <Button title="Abrir caja" onPress={() => void doOpen()} loading={busy} disabled={openingText.trim() === ''} />
            </>
          ) : (
            <Muted>Solo el gerente puede abrir la caja.</Muted>
          )}
        </Card>
      ) : null}

      {open ? (
        <Card tone="gold">
          <H2>Caja abierta</H2>
          <Row label="Apertura" value={formatMxDateTime(open.openedAt)} />
          <Row label="Monto inicial" value={isManager ? formatMXN(open.openingCents) : 'Registrado'} />
          {isManager ? (
            <>
              <Row label="Operaciones" value={String(open.operations)} />
              <Row label="Efectivo esperado" value={formatMXN(open.expectedCents ?? 0)} strong />
            </>
          ) : null}
          <Divider />
          <Field label="Efectivo contado al cerrar" value={countedText} onChangeText={setCountedText} keyboardType="decimal-pad" placeholder="0.00" />
          {pending > 0 ? <Banner kind="warn" text={`Hay ${pending} operaciones sin enviar: el cierre quedará PROVISIONAL y se concilia al sincronizar.`} /> : null}
          <Muted>Para cerrar se pide {isManager ? 'tu contraseña' : 'la contraseña de un administrador o un token de cierre de caja'}.</Muted>
          <Button title="Cerrar caja" variant="dark" onPress={() => setAskAuth(true)} loading={busy} disabled={countedText.trim() === ''} />
        </Card>
      ) : null}

      {lastClosed ? (
        <Card>
          <H2>Último cierre</H2>
          {isManager ? (
            <>
              <Row label="Diferencia" value={differenceText(lastClosed.differenceCents)} strong valueColor={lastClosed.differenceCents === 0 ? colors.ok : colors.danger} />
              {lastClosed.provisional ? <Banner kind="warn" text="Cierre provisional: había operaciones sin enviar." /> : null}
              <Button title="Generar ticket de cierre" onPress={() => void makeTicket()} />
            </>
          ) : (
            <Muted>La caja quedó cerrada. Entrega el efectivo al gerente; él ve el resumen del cierre.</Muted>
          )}
        </Card>
      ) : null}

      <AuthModal visible={askAuth} purpose="cierre_caja" onCancel={() => setAskAuth(false)} onAuthorized={(a) => void doClose(a)} />
      <DocPreview visible={closureDoc !== null} title="Ticket de cierre" html={closureDoc ?? ''} onClose={() => setClosureDoc(null)} />
    </Screen>
  );
}
