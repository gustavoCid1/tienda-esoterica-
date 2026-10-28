/**
 * Historial / archivo de tickets. El gerente ve todos con filtros; el vendedor SOLO los suyos y sin
 * totales acumulados (el proceso principal lo impone, no solo la pantalla). Reimpresión sin crear venta,
 * cancelaciones y devoluciones (solo gerente, con contraseña).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { can, mxTodayKey, newId } from '@amara/shared';
import type { PaymentMethod } from '@amara/shared';
import type { SaleDetail, SaleRow, SensitiveAuth } from '../../shared/ipc.ts';
import { AuthPrompt } from '../components/AuthPrompt.tsx';
import { DocPreviewModal } from '../components/DocPreviewModal.tsx';
import { Banner, Field } from '../components/Field.tsx';
import { Modal } from '../components/Modal.tsx';
import { call, errorCode, errorText } from '../lib/api.ts';
import { METHOD_LABEL, dateTime, money } from '../lib/format.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

export function TicketsScreen() {
  const { user } = useApp();
  const { toast } = useFeedback();
  const manager = !!user && can(user.role, 'tickets.archivo');
  const today = mxTodayKey();
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);
  const [folio, setFolio] = useState('');
  const [status, setStatus] = useState<'' | 'completada' | 'cancelada'>('');
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await call('sales:list', { fromDay, toDay, folio: folio.trim() || undefined, status: status || undefined }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [fromDay, toDay, folio, status]);

  useEffect(() => {
    void load();
    // Se recarga al cambiar filtros de fecha/estado; el folio se busca con el botón o Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDay, toDay, status]);

  // Escanear un ticket/folio no aplica: se avisa en vez de ignorar en silencio.
  useScanHandler((code) => {
    setFolio(code);
    toast('info', 'Se puso el código en la búsqueda de folio. Pulsa Buscar.');
  });

  const total = useMemo(() => rows.filter((r) => r.status === 'completada').reduce((a, r) => a + r.totalCents, 0), [rows]);

  return (
    <div className="page">
      <h1>{manager ? 'Archivo de tickets' : 'Mis tickets'}</h1>
      <div className="filters">
        <Field label="Desde"><input className="inp" type="date" value={fromDay} max={toDay} onChange={(e) => e.target.value && setFromDay(e.target.value)} /></Field>
        <Field label="Hasta"><input className="inp" type="date" value={toDay} min={fromDay} onChange={(e) => e.target.value && setToDay(e.target.value)} /></Field>
        <Field label="Folio">
          <input className="inp" value={folio} onChange={(e) => setFolio(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} placeholder="AMA-..." />
        </Field>
        <Field label="Estado">
          <select className="inp" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">Todos</option>
            <option value="completada">Completadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </Field>
        <button className="btn btn-gold" onClick={() => void load()} disabled={loading}>Buscar</button>
        <button className="btn" onClick={() => { setFromDay(today); setToDay(today); setFolio(''); setStatus(''); }}>Hoy</button>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <table className="table">
        <thead>
          <tr><th>Folio</th><th>Fecha y hora</th><th>Atendió</th><th className="num">Total</th><th>Estado</th><th>Envío al servidor</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === 'cancelada' ? 'row-cancel' : ''}>
              <td className="mono">{r.folio}{r.type === 'limpia' && <span className="chip chip-violet">Limpia</span>}</td>
              <td>{dateTime(r.createdAt)}</td>
              <td>{r.userName}</td>
              <td className="num strong">{money(r.totalCents)}</td>
              <td>{r.status === 'cancelada' ? 'Cancelada' : 'Completada'}</td>
              <td className="muted">{r.syncState === 'sincronizada' ? 'Enviada' : r.syncState === 'conflicto' ? 'Con aviso' : 'Pendiente'}</td>
              <td className="num"><button className="btn btn-sm" onClick={() => setOpenId(r.id)}>Ver</button></td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr><td colSpan={7} className="center muted">No hay tickets con esos filtros.</td></tr>
          )}
        </tbody>
        {manager && rows.length > 0 && (
          <tfoot>
            <tr><td colSpan={3} className="num">Total de tickets completados en la lista</td><td className="num strong">{money(total)}</td><td colSpan={3} /></tr>
          </tfoot>
        )}
      </table>
      {openId && <TicketDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
    </div>
  );
}

function TicketDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useApp();
  const { toast } = useFeedback();
  const [d, setD] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [sub, setSub] = useState<'refund' | 'cancel' | null>(null);

  const reload = useCallback(async () => {
    try {
      setD(await call('sales:detail', { id }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const sale = d?.sale;
  // Gerente: confirma su contraseña. Vendedor (solo sus ventas): contraseña de administrador o token de devolución/cancelación.
  const canAdjust = !!user && sale?.status === 'completada' && (can(user.role, 'ventas.cancelar') || (user.role === 'vendedor' && sale.userId === user.id));
  const manager = !!user && can(user.role, 'tickets.archivo');
  const returnedAll = !!d && !!sale && sale.items.every((i) => (d.returned[i.id] ?? 0) >= i.qty);

  return (
    <Modal title={sale ? `Ticket ${sale.folio}` : 'Ticket'} size="lg" onClose={onClose} footer={<button className="btn" onClick={onClose}>Cerrar</button>}>
      {error && <Banner kind="error">{error}</Banner>}
      {sale && d && (
        <div className="stack">
          <div className="row-between">
            <div>
              <div className="muted">
                {dateTime(sale.createdAt)} - Atendió {sale.userName}
                {manager && sale.sellerName ? ` - Vendió ${sale.sellerName}` : ''}
                {sale.type === 'limpia' && <span className="chip chip-violet">Limpia</span>}
              </div>
              {sale.status === 'cancelada' && <div className="neg strong">VENTA CANCELADA</div>}
            </div>
            <div className="strong big">{money(sale.totalCents)}</div>
          </div>
          <table className="table">
            <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Importe</th><th className="num">Devueltas</th></tr></thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.kind === 'extra' ? <><span className="chip chip-info">Extra</span> {i.extraNote} <span className="muted">sobre {i.productName} {i.variantLabel}</span></> : <>{i.productName} <span className="muted">{i.variantLabel}</span></>}
                  </td>
                  <td className="num">{i.qty}</td>
                  <td className="num">{money(i.unitPriceCents)}</td>
                  <td className="num">{money(i.netCents)}</td>
                  <td className="num">{d.returned[i.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid2">
            <div>
              <strong>Pagos</strong>
              {sale.payments.map((p, k) => (
                <div key={k} className="row-between"><span>{METHOD_LABEL[p.method] ?? p.method}</span><span>{money(p.amountCents)}</span></div>
              ))}
              {sale.changeCents > 0 && <div className="row-between muted"><span>Cambio entregado</span><span>{money(sale.changeCents)}</span></div>}
            </div>
            <div>
              <div className="row-between"><span>Subtotal</span><span>{money(sale.subtotalCents)}</span></div>
              {sale.discountCents > 0 && <div className="row-between"><span>Descuento</span><span>-{money(sale.discountCents)}</span></div>}
            </div>
          </div>
          {d.adjustments.length > 0 && (
            <div>
              <strong>Cancelaciones y devoluciones</strong>
              {d.adjustments.map((a) => (
                <div key={a.id} className="row-between small">
                  <span>{a.type === 'cancelacion' ? 'Cancelación' : 'Devolución'} - {dateTime(a.createdAt)} - {a.reason}</span>
                  <span>{money(a.amountCents)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="muted small">Impresiones registradas: {d.printCount}</div>
          {d.lastPrintError && <Banner kind="warn">Último error de impresión: {d.lastPrintError}</Banner>}
          <div className="row-gap">
            <button className="btn btn-gold" onClick={() => setPreview(true)}>Ver ticket / Imprimir</button>
            {canAdjust && !returnedAll && <button className="btn" onClick={() => setSub('refund')}>Devolución</button>}
            {canAdjust && <button className="btn btn-danger" onClick={() => setSub('cancel')}>Cancelar venta</button>}
          </div>
        </div>
      )}
      {preview && <DocPreviewModal doc={{ kind: 'ticket', saleId: id }} title={sale ? `Ticket ${sale.folio}` : 'Ticket'} onPrinted={() => void reload()} onClose={() => setPreview(false)} />}
      {sub === 'refund' && d && <RefundModal detail={d} onClose={() => setSub(null)} onDone={() => { setSub(null); void reload(); onChanged(); }} />}
      {sub === 'cancel' && d && <CancelModal detail={d} onClose={() => setSub(null)} onDone={() => { setSub(null); void reload(); onChanged(); }} />}
    </Modal>
  );
}

function RefundModal({ detail, onClose, onDone }: { detail: SaleDetail; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const adjId = useRef(newId());
  const submitting = useRef(false);
  const { sale, returned } = detail;
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(sale.payments.some((p) => p.method === 'efectivo') ? 'efectivo' : sale.payments[0]!.method);
  const [auth, setAuth] = useState<SensitiveAuth | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = sale.items
    .map((i) => ({ id: i.id, max: i.qty - (returned[i.id] ?? 0), q: Number(qty[i.id] ?? 0), restock: restock[i.id] !== false }))
    .filter((l) => l.q > 0);
  const bad = sale.items.some((i) => {
    const q = Number(qty[i.id] ?? 0);
    return !Number.isInteger(q) || q < 0 || q > i.qty - (returned[i.id] ?? 0);
  });
  const dirty = Object.values(qty).some((v) => v !== '' && v !== '0') || reason !== '' || auth !== null;
  const ready = lines.length > 0 && !bad && reason.trim().length >= 3 && auth !== null;

  const submit = async () => {
    if (submitting.current || !ready) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await call('sales:refund', { saleId: sale.id, reason: reason.trim(), ...auth, adjustmentId: adjId.current, method, lines: lines.map((l) => ({ saleItemId: l.id, qty: l.q, restock: l.restock })) });
      toast('ok', 'Devolución registrada.');
      onDone();
    } catch (e) {
      setError(errorText(e));
      if (['credenciales', 'autorizacion_requerida', 'autorizacion_invalida'].includes(errorCode(e))) setResetSignal((n) => n + 1);
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Devolución"
      size="lg"
      onClose={onClose}
      dirty={dirty}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-gold" onClick={() => void submit()} disabled={busy || !ready}>{busy ? 'Guardando...' : 'Registrar devolución'}</button>
        </>
      }
    >
      <div className="stack">
        <table className="table">
          <thead><tr><th>Producto</th><th className="num">Se pueden devolver</th><th className="num">Devolver</th><th>Regresa a inventario</th></tr></thead>
          <tbody>
            {sale.items.map((i) => {
              const max = i.qty - (returned[i.id] ?? 0);
              return (
                <tr key={i.id}>
                  <td>{i.kind === 'extra' ? <><span className="chip chip-info">Extra</span> {i.extraNote}</> : <>{i.productName} <span className="muted">{i.variantLabel}</span></>}</td>
                  <td className="num">{max}</td>
                  <td className="num"><input className="inp inp-qty" inputMode="numeric" disabled={max === 0} value={qty[i.id] ?? ''} placeholder="0" onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /></td>
                  <td>
                    {i.kind === 'extra' ? (
                      <span className="muted small">No aplica (es un cargo, no una pieza)</span>
                    ) : (
                      <label className="check"><input type="checkbox" checked={restock[i.id] !== false} onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} /> Sí (desmarca si está dañado)</label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="grid2">
          <Field label="Cómo se devuelve el dinero">
            <select className="inp" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(['efectivo', 'tarjeta', 'transferencia', 'otro'] as const).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Motivo" hint="Mínimo 3 letras"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <AuthPrompt purpose="devolucion" onChange={setAuth} resetSignal={resetSignal} disabled={busy} />
        {bad && <Banner kind="warn">Revisa las cantidades: no pueden exceder lo que falta por devolver.</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}

function CancelModal({ detail, onClose, onDone }: { detail: SaleDetail; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const adjId = useRef(newId());
  const submitting = useRef(false);
  const [reason, setReason] = useState('');
  const [auth, setAuth] = useState<SensitiveAuth | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasReturns = Object.keys(detail.returned).length > 0;
  const ready = reason.trim().length >= 3 && auth !== null && !hasReturns;

  const submit = async () => {
    if (submitting.current || !ready) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await call('sales:cancel', { saleId: detail.sale.id, reason: reason.trim(), ...auth, adjustmentId: adjId.current });
      toast('ok', 'Venta cancelada. La existencia regresó al inventario.');
      onDone();
    } catch (e) {
      setError(errorText(e));
      if (['credenciales', 'autorizacion_requerida', 'autorizacion_invalida'].includes(errorCode(e))) setResetSignal((n) => n + 1);
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Cancelar venta"
      size="md"
      onClose={onClose}
      dirty={reason !== '' || auth !== null}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>No cancelar</button>
          <button className="btn btn-danger" onClick={() => void submit()} disabled={busy || !ready}>{busy ? 'Cancelando...' : 'Cancelar la venta'}</button>
        </>
      }
    >
      <div className="stack">
        <Banner kind="warn">
          Se cancela el ticket <strong>{detail.sale.folio}</strong> por {money(detail.sale.totalCents)}. No se borra: queda registrado como cancelación y la mercancía regresa a inventario.
        </Banner>
        {hasReturns && <Banner kind="error">Esta venta ya tiene devoluciones. Registra devoluciones por el resto de las piezas.</Banner>}
        <Field label="Motivo de la cancelación" hint="Mínimo 3 letras"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        <AuthPrompt purpose="cancelacion" onChange={setAuth} resetSignal={resetSignal} disabled={busy} />
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}
