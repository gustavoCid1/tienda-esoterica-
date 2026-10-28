/**
 * Caja. GERENTE: apertura con fondo (queda hora y monto), entradas / retiros / gastos, efectivo esperado en vivo,
 * corte con desglose de billetes y monedas, diferencia, historial de cortes y TICKET DE CIERRE.
 * VENDEDOR (v2): solo ve si la caja está abierta y puede CERRARLA A CIEGAS (sin esperado ni diferencia) con la
 * contraseña de un administrador o un token. Cerrar SIEMPRE exige autorización.
 * El efectivo esperado = fondo + pagos en EFECTIVO (sin el cambio) + entradas - retiros - gastos
 * - devoluciones en efectivo. Tarjeta y transferencia NO entran al cajón.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MXN_DENOMINATIONS, can, formatMXN } from '@amara/shared';
import type { CashBreakdown, CashMovementType, SalesSummary } from '@amara/shared';
import type { CashClosureResult, CashStatus, ClosureRow, SensitiveAuth } from '../../shared/ipc.ts';
import { AuthPrompt } from '../components/AuthPrompt.tsx';
import { DocPreviewModal } from '../components/DocPreviewModal.tsx';
import { Banner, Field } from '../components/Field.tsx';
import { Modal } from '../components/Modal.tsx';
import { call, errorCode, errorText } from '../lib/api.ts';
import { METHOD_LABEL, dateTime, money, parsePesos } from '../lib/format.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

type View = { sessionId: string; openedAt: string; openedByName: string | null; breakdown: CashBreakdown } | null;

export function CashScreen() {
  const { user } = useApp();
  return user && can(user.role, 'caja.corte') ? <ManagerCash /> : <SellerCash />;
}

function ManagerCash() {
  const { toast } = useFeedback();
  const [ticketFor, setTicketFor] = useState<string | null>(null);
  const [view, setView] = useState<View | undefined>(undefined);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [summary, setSummary] = useState<{ summary: SalesSummary; pendingOps: number; mayBeIncomplete: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'open' | 'move' | 'close' | null>(null);
  const [moveType, setMoveType] = useState<CashMovementType>('entrada');
  const [result, setResult] = useState<CashClosureResult | null>(null);

  useScanHandler(() => toast('info', 'En esta pantalla no se usa el escáner.'));

  const load = useCallback(async () => {
    try {
      const [v, c, s] = await Promise.all([call('cash:breakdown'), call('cash:closures'), call('cash:summaryToday').catch(() => null)]);
      setView(v);
      setClosures(c);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const b = view?.breakdown;

  return (
    <div className="page">
      <h1>Caja</h1>
      {error && <Banner kind="error">{error}</Banner>}
      {result && (
        <Banner kind={result.differenceCents === 0 ? 'ok' : 'warn'} onClose={() => setResult(null)}>
          <strong>Corte realizado.</strong> Esperado {money(result.expectedCents)} - Contado {money(result.countedCents)} -{' '}
          {result.differenceCents === 0 ? 'Sin diferencia.' : result.differenceCents < 0 ? `Faltante de ${money(-result.differenceCents)}.` : `Sobrante de ${money(result.differenceCents)}.`}
          {result.provisional && ' El corte es PROVISIONAL: hay operaciones sin sincronizar y se conciliará al conectar.'}
          {result.authorizedByName && ` Autorizó: ${result.authorizedByName}.`}{' '}
          <button className="btn btn-gold btn-sm" onClick={() => setTicketFor(result.sessionId)}>Generar ticket de cierre</button>
        </Banner>
      )}

      {view === undefined ? (
        <p className="muted">Cargando...</p>
      ) : view === null ? (
        <div className="card">
          <h3>La caja está cerrada</h3>
          <p className="muted">Abre la caja con el fondo inicial para que se puedan registrar ventas.</p>
          <button className="btn btn-gold btn-lg" onClick={() => setModal('open')}>Abrir caja</button>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="row-between">
              <div>
                <h3>Caja abierta</h3>
                <div className="muted">
                  Abierta el {dateTime(view.openedAt)}{view.openedByName ? ` por ${view.openedByName}` : ''} con un fondo inicial de <strong>{money(b!.openingCents)}</strong> - {b!.operations} operaciones
                </div>
              </div>
              <div className="stat">
                <span className="muted">Efectivo que debe haber en el cajón</span>
                <div className="stat-big gold">{money(b!.expectedCents)}</div>
              </div>
            </div>
            <table className="table table-tight">
              <tbody>
                <tr><td>Fondo inicial</td><td className="num">{money(b!.openingCents)}</td></tr>
                <tr><td>Ventas en efectivo (sin el cambio)</td><td className="num">{money(b!.cashSalesCents)}</td></tr>
                <tr><td>Entradas de efectivo</td><td className="num">{money(b!.cashInCents)}</td></tr>
                <tr><td>Retiros</td><td className="num">-{money(b!.withdrawalsCents)}</td></tr>
                <tr><td>Gastos</td><td className="num">-{money(b!.expensesCents)}</td></tr>
                <tr><td>Devoluciones y cancelaciones pagadas en efectivo</td><td className="num">-{money(b!.cashRefundsCents)}</td></tr>
              </tbody>
            </table>
            <div className="muted small">
              Por método (informativo, no es efectivo del cajón):{' '}
              {(['tarjeta', 'transferencia', 'otro'] as const).map((m) => `${METHOD_LABEL[m]} ${money(b!.byMethod[m])}`).join(' - ')}
            </div>
            <div className="row-gap">
              <button className="btn" onClick={() => { setMoveType('entrada'); setModal('move'); }}>Entrada de efectivo</button>
              <button className="btn" onClick={() => { setMoveType('retiro'); setModal('move'); }}>Retiro</button>
              <button className="btn" onClick={() => { setMoveType('gasto'); setModal('move'); }}>Gasto</button>
              <button className="btn btn-gold" onClick={() => setModal('close')}>Corte de caja</button>
            </div>
          </div>
        </>
      )}

      {summary && (
        <div className="card">
          <h3>Resumen de ventas de hoy (esta terminal)</h3>
          <div className="stat-row">
            <div><span className="muted">Ventas netas</span><div className="stat-big">{money(summary.summary.netCents)}</div></div>
            <div><span className="muted">Tickets</span><div className="stat-big">{summary.summary.ticketCount}</div></div>
            <div><span className="muted">Ticket promedio</span><div className="stat-big">{money(summary.summary.avgTicketCents)}</div></div>
            <div><span className="muted">Cancelado + devuelto</span><div className="stat-big">{money(summary.summary.cancelledCents + summary.summary.refundedCents)}</div></div>
          </div>
          {summary.mayBeIncomplete && (
            <div className="muted small">
              Calculado con lo que sabe ESTA computadora{summary.pendingOps > 0 ? ` (${summary.pendingOps} operaciones sin enviar)` : ''}. Puede faltar lo de otras terminales hasta sincronizar.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3>Cortes anteriores</h3>
        <table className="table">
          <thead><tr><th>Cierre</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {closures.map((c) => (
              <tr key={c.id}>
                <td>{dateTime(c.closedAt)}</td>
                <td className="num">{money(c.expectedCents)}</td>
                <td className="num">{money(c.countedCents)}</td>
                <td className={`num ${c.differenceCents < 0 ? 'neg' : ''}`}>{money(c.differenceCents)}</td>
                <td className="muted">{c.provisional ? 'Provisional' : 'Definitivo'} - {c.reconciliation === 'conciliado' ? 'conciliado' : c.reconciliation === 'con_diferencias' ? 'con diferencias' : 'por conciliar'}</td>
                <td className="num"><button className="btn btn-sm" onClick={() => setTicketFor(c.id)}>Ticket de cierre</button></td>
              </tr>
            ))}
            {closures.length === 0 && <tr><td colSpan={6} className="center muted">Todavía no hay cortes.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal === 'open' && <OpenModal onClose={() => setModal(null)} onDone={() => { setModal(null); toast('ok', 'Caja abierta.'); void load(); }} />}
      {modal === 'move' && <MoveModal type={moveType} onClose={() => setModal(null)} onDone={() => { setModal(null); toast('ok', 'Movimiento registrado.'); void load(); }} />}
      {modal === 'close' && b && (
        <CloseModal expectedCents={b.expectedCents} onClose={() => setModal(null)} onDone={(r) => { setModal(null); setResult(r); void load(); }} />
      )}
      {ticketFor && <DocPreviewModal doc={{ kind: 'closure', sessionId: ticketFor }} title="Ticket de cierre de caja" onClose={() => setTicketFor(null)} />}
    </div>
  );
}

/** Vendedor: ve la hora de apertura y puede cerrar la caja a ciegas, con autorización de administrador. */
function SellerCash() {
  const { toast } = useFeedback();
  const [status, setStatus] = useState<CashStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState<CashClosureResult | null>(null);

  useScanHandler(() => toast('info', 'En esta pantalla no se usa el escáner.'));
  const load = useCallback(() => {
    call('cash:status').then((s) => { setStatus(s); setError(null); }).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => load(), [load]);

  return (
    <div className="page">
      <h1>Caja</h1>
      {error && <Banner kind="error">{error}</Banner>}
      {done && (
        <Banner kind="ok" onClose={() => setDone(null)}>
          <strong>Caja cerrada.</strong> Autorizó: {done.authorizedByName ?? 'administrador'}. El gerente revisa el corte.
          {done.provisional && ' El corte es provisional: hay operaciones sin sincronizar.'}
        </Banner>
      )}
      {status === null ? (
        <p className="muted">Cargando...</p>
      ) : !status.open ? (
        <div className="card">
          <h3>La caja está cerrada</h3>
          <p className="muted">Un gerente abre la caja con el fondo inicial para que se puedan registrar ventas.</p>
        </div>
      ) : (
        <div className="card">
          <h3>Caja abierta</h3>
          <div className="muted">Abierta el {dateTime(status.openedAt!)}{status.openedByName ? ` por ${status.openedByName}` : ''}.</div>
          <p className="muted">Para cerrarla cuenta el efectivo del cajón y pide a un administrador que escriba su contraseña (o usa un token de cierre de caja). No se muestran importes esperados.</p>
          <button className="btn btn-gold btn-lg" onClick={() => setClosing(true)}>Cerrar caja</button>
        </div>
      )}
      {closing && <CloseModal expectedCents={null} onClose={() => setClosing(false)} onDone={(r) => { setClosing(false); setDone(r); load(); }} />}
    </div>
  );
}

function OpenModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const cents = parsePesos(text);
  const ok = cents !== null && !Number.isNaN(cents);

  const submit = async () => {
    if (submitting.current || !ok) return;
    submitting.current = true;
    setBusy(true);
    try {
      await call('cash:open', { openingCents: cents as number });
      onDone();
    } catch (e) {
      setError(errorText(e));
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal title="Abrir caja" size="sm" onClose={onClose} dirty={text !== ''} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-gold" onClick={() => void submit()} disabled={busy || !ok}>Abrir caja</button></>}>
      <div className="stack">
        <Field label="Fondo inicial en efectivo ($)" hint="Lo que hay en el cajón al empezar. Puede ser 0."><input className="inp inp-lg" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void submit()} /></Field>
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}

function MoveModal({ type, onClose, onDone }: { type: CashMovementType; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const cents = parsePesos(amount);
  const ok = cents !== null && !Number.isNaN(cents) && cents > 0 && concept.trim().length >= 3;
  const title = type === 'entrada' ? 'Entrada de efectivo' : type === 'retiro' ? 'Retiro de efectivo' : 'Gasto';

  const submit = async () => {
    if (submitting.current || !ok) return;
    submitting.current = true;
    setBusy(true);
    try {
      await call('cash:movement', { type, amountCents: cents as number, concept: concept.trim() });
      onDone();
    } catch (e) {
      setError(errorText(e));
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal title={title} size="sm" onClose={onClose} dirty={amount !== '' || concept !== ''} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-gold" onClick={() => void submit()} disabled={busy || !ok}>Registrar</button></>}>
      <div className="stack">
        <Field label="Importe ($)"><input className="inp inp-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Concepto" hint="Ejemplo: compra de bolsas, pago a proveedor, cambio para el cajón"><input className="inp" value={concept} onChange={(e) => setConcept(e.target.value)} /></Field>
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}

/** `expectedCents = null` = cierre a ciegas (vendedor): no se muestra esperado ni diferencia. */
function CloseModal({ expectedCents, onClose, onDone }: { expectedCents: number | null; onClose: () => void; onDone: (r: CashClosureResult) => void }) {
  const [mode, setMode] = useState<'desglose' | 'total'>('desglose');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [totalText, setTotalText] = useState('');
  const [notes, setNotes] = useState('');
  const [auth, setAuth] = useState<SensitiveAuth | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const labels = Object.keys(MXN_DENOMINATIONS);
  const invalidCount = labels.some((l) => counts[l] && (!/^\d+$/.test(counts[l]!)));
  const fromCounts = labels.reduce((a, l) => a + (Number(counts[l] ?? 0) || 0) * MXN_DENOMINATIONS[l]!, 0);
  const totalParsed = parsePesos(totalText);
  const counted = mode === 'desglose' ? (invalidCount ? null : fromCounts) : totalParsed === null || Number.isNaN(totalParsed) ? null : totalParsed;
  const diff = counted === null || expectedCents === null ? null : counted - expectedCents;
  const dirty = Object.values(counts).some((v) => v) || totalText !== '' || notes !== '' || auth !== null;
  const ready = counted !== null && auth !== null;

  const submit = async () => {
    if (submitting.current || !ready) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const denominations: Record<string, number> = {};
      if (mode === 'desglose') for (const l of labels) if (Number(counts[l] ?? 0) > 0) denominations[l] = Number(counts[l]);
      onDone(await call('cash:close', { countedCents: counted as number, denominations, notes, ...auth }));
    } catch (e) {
      setError(errorText(e));
      if (['credenciales', 'autorizacion_requerida', 'autorizacion_invalida'].includes(errorCode(e))) setResetSignal((n) => n + 1);
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal title="Corte de caja" size="lg" onClose={onClose} dirty={dirty} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-gold btn-lg" onClick={() => void submit()} disabled={busy || !ready}>{busy ? 'Cerrando...' : 'Cerrar caja y guardar corte'}</button></>}>
      <div className="stack">
        <div className="segmented">
          <button type="button" className={mode === 'desglose' ? 'seg seg-on' : 'seg'} onClick={() => setMode('desglose')}>Contar billetes y monedas</button>
          <button type="button" className={mode === 'total' ? 'seg seg-on' : 'seg'} onClick={() => setMode('total')}>Escribir solo el total</button>
        </div>
        {mode === 'desglose' ? (
          <div className="denoms">
            {labels.map((l) => (
              <label key={l} className="denom">
                <span>{l}</span>
                <input className="inp inp-qty" inputMode="numeric" placeholder="0" value={counts[l] ?? ''} onChange={(e) => setCounts({ ...counts, [l]: e.target.value })} />
                <span className="muted small">{formatMXN((Number(counts[l] ?? 0) || 0) * MXN_DENOMINATIONS[l]!)}</span>
              </label>
            ))}
          </div>
        ) : (
          <Field label="Efectivo contado ($)"><input className="inp inp-lg" inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value)} /></Field>
        )}
        {invalidCount && <Banner kind="warn">Las cantidades de billetes y monedas deben ser números enteros.</Banner>}
        {expectedCents === null ? (
          <div className="stat-row">
            <div><span className="muted">Contado</span><div className="stat-big">{counted === null ? '--' : money(counted)}</div></div>
          </div>
        ) : (
          <div className="stat-row">
            <div><span className="muted">Esperado</span><div className="stat-big">{money(expectedCents)}</div></div>
            <div><span className="muted">Contado</span><div className="stat-big">{counted === null ? '--' : money(counted)}</div></div>
            <div>
              <span className="muted">Diferencia</span>
              <div className={`stat-big ${diff !== null && diff < 0 ? 'neg' : ''}`}>
                {diff === null ? '--' : diff === 0 ? 'Sin diferencia' : diff < 0 ? `Faltan ${money(-diff)}` : `Sobran ${money(diff)}`}
              </div>
            </div>
          </div>
        )}
        <Field label="Notas (opcional)"><input className="inp" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></Field>
        <AuthPrompt purpose="cierre_caja" onChange={setAuth} resetSignal={resetSignal} disabled={busy} managerLabel="Tu contraseña (confirmación de cierre)" />
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}
