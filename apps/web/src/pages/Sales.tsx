import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, formatMxDateTime, type PaymentMethod, type Sale, type SaleAdjustment } from '@amara/shared';
import { api, asList } from '../lib/api.ts';
import { errorMessage, useAsync, useDebounced } from '../lib/hooks.ts';
import { centsToInput, formatMXN, parseMoneyInput } from '../lib/format.ts';
import { computeReturnAmount, validateReturn, type ReturnSelection } from '../lib/ops.ts';
import { mxTodayKey } from '../lib/dates.ts';
import type { AdminUser, Terminal } from '../lib/types.ts';
import { Alert, Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, TableWrap, CloseButton } from '../components/ui.tsx';
import { BranchSelect, DateRangeBar } from '../components/common.tsx';
import { useAuth, useBranches, useToast } from '../context.tsx';

const METHOD_LABEL: Record<PaymentMethod, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' };

export function Sales() {
  const { branchName } = useBranches();
  const today = mxTodayKey();
  const [range, setRange] = useState({ from: today, to: today });
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [folio, setFolio] = useState('');
  const [userId, setUserId] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const dfolio = useDebounced(folio.trim(), 300);

  // Listas para los filtros; si el usuario no puede verlas, el filtro simplemente queda vacío.
  const users = useAsync((s) => api.get<unknown>('/admin/users', undefined, s).then((d) => asList<AdminUser>(d)), []);
  const terminals = useAsync((s) => api.get<unknown>('/admin/terminals', undefined, s).then((d) => asList<Terminal>(d)), []);

  const valid = range.from !== '' && range.to !== '' && range.from <= range.to;
  const res = useAsync(
    (signal) =>
      api
        .get<unknown>('/sales', { from: range.from, to: range.to, branchId, status, folio: dfolio, userId, terminalId }, signal)
        .then((d) => asList<Sale>(d)),
    [range.from, range.to, branchId, status, dfolio, userId, terminalId],
    valid,
  );
  const rows = res.data ?? [];
  const sumCompleted = useMemo(() => rows.filter((s) => s.status === 'completada').reduce((a, s) => a + s.totalCents, 0), [rows]);
  const termName = (id: string) => terminals.data?.find((t) => t.id === id)?.name ?? id.slice(0, 6);

  return (
    <>
      <PageHeader title="Ventas y archivo de tickets" subtitle="Consulta tickets por fecha con sus precios originales. Cancelar o devolver crea un ajuste: la venta nunca se borra." />
      <div className="filters">
        <DateRangeBar from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="inline-field">
          <span>Sucursal</span>
          <BranchSelect value={branchId} onChange={setBranchId} allLabel="Todas" />
        </label>
        <label className="inline-field">
          <span>Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="completada">Completadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </label>
        <label className="inline-field">
          <span>Vendedor</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todos</option>
            {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="inline-field">
          <span>Terminal</span>
          <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
            <option value="">Todas</option>
            {(terminals.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="inline-field">
          <span>Folio</span>
          <input value={folio} placeholder="AMA-..." onChange={(e) => setFolio(e.target.value)} />
        </label>
      </div>
      {!valid && <Alert tone="warn">Elige un rango de fechas válido.</Alert>}
      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          <p className="muted small">
            {rows.length} ticket(s). Suma de totales de tickets completados mostrados: <strong>{formatMXN(sumCompleted)}</strong> (no descuenta devoluciones; para ventas netas usa Informes).
          </p>
          {rows.length === 0 ? (
            <Empty>No hay tickets con esos filtros.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Folio</th><th>Fecha</th><th>Sucursal</th><th>Terminal</th><th>Vendedor</th><th className="num">Total</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.folio}</strong></td>
                      <td>{formatMxDateTime(s.createdAt)}</td>
                      <td>{branchName(s.branchId)}</td>
                      <td>{termName(s.terminalId)}</td>
                      <td>{s.userName}</td>
                      <td className="num strong">{formatMXN(s.totalCents)}</td>
                      <td>{s.status === 'cancelada' ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="ok">Completada</Badge>}</td>
                      <td className="row-actions"><button type="button" className="btn btn-sm" onClick={() => setOpenId(s.id)}>Ver detalle</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
      {openId && <SaleDetail id={openId} onClose={() => setOpenId(null)} onChanged={res.reload} />}
    </>
  );
}

type DetailSale = Sale & { adjustments?: SaleAdjustment[] };

function SaleDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const { branchName } = useBranches();
  const res = useAsync((s) => api.get<DetailSale>(`/sales/${id}`, undefined, s), [id]);
  const [action, setAction] = useState<'cancel' | 'return' | null>(null);
  const sale = res.data;

  const done = () => {
    setAction(null);
    res.reload();
    onChanged();
  };

  return (
    <>
      <Modal title={sale ? `Ticket ${sale.folio}` : 'Ticket'} size="xl" onClose={onClose}>
        {res.loading && !sale && <Spinner />}
        {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
        {sale && (
          <div className="form">
            <div className="detail-grid">
              <div><span className="muted small">Fecha</span><div>{formatMxDateTime(sale.createdAt)}</div></div>
              <div><span className="muted small">Sucursal</span><div>{branchName(sale.branchId)}</div></div>
              <div><span className="muted small">Vendedor</span><div>{sale.userName}</div></div>
              <div><span className="muted small">Estado</span><div>{sale.status === 'cancelada' ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="ok">Completada</Badge>}</div></div>
            </div>
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Producto</th><th>SKU</th><th className="num">Cant.</th><th className="num">Precio original</th><th className="num">Desc. línea</th><th className="num">Importe final</th></tr>
                </thead>
                <tbody>
                  {sale.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.productName} <span className="muted">{it.variantLabel}</span></td>
                      <td className="small">{it.sku || it.code}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">{formatMXN(it.unitPriceCents)}</td>
                      <td className="num">{it.lineDiscountCents ? `-${formatMXN(it.lineDiscountCents)}` : '-'}</td>
                      <td className="num strong">{formatMXN(it.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="totals">
              <div><span>Subtotal (precios originales)</span><span>{formatMXN(sale.subtotalCents)}</span></div>
              {sale.discountCents > 0 && <div><span>Descuento general</span><span>-{formatMXN(sale.discountCents)}</span></div>}
              <div className="strong"><span>Total</span><span>{formatMXN(sale.totalCents)}</span></div>
              {sale.payments.map((p, i) => (
                <div key={i} className="muted">
                  <span>Pago {METHOD_LABEL[p.method]}{p.tenderedCents ? ` (recibido ${formatMXN(p.tenderedCents)}, cambio ${formatMXN(p.changeCents ?? 0)})` : ''}</span>
                  <span>{formatMXN(p.amountCents)}</span>
                </div>
              ))}
            </div>
            {sale.adjustments && sale.adjustments.length > 0 && (
              <Alert tone="warn" title="Ajustes registrados">
                <ul className="plain-list">
                  {sale.adjustments.map((a) => (
                    <li key={a.id}>
                      <span>{a.type === 'cancelacion' ? 'Cancelación' : 'Devolución'} &middot; {formatMxDateTime(a.createdAt)} &middot; {a.reason}</span>
                      <strong>{formatMXN(a.amountCents)}</strong>
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {sale.status === 'completada' && (
              <div className="btn-row">
                {can('ventas.devolver') && <button type="button" className="btn" onClick={() => setAction('return')}>Registrar devolución</button>}
                {can('ventas.cancelar') && <button type="button" className="btn btn-danger" onClick={() => setAction('cancel')}>Cancelar venta</button>}
              </div>
            )}
          </div>
        )}
      </Modal>
      {sale && action === 'cancel' && <CancelModal sale={sale} onClose={() => setAction(null)} onDone={done} />}
      {sale && action === 'return' && <ReturnModal sale={sale} onClose={() => setAction(null)} onDone={done} />}
    </>
  );
}

function CancelModal({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Escribe el motivo (mínimo 3 caracteres).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Acción sensible: pide la contraseña (x-reauth) antes de enviar.
      await api.post(`/sales/${sale.id}/cancel`, { reason: reason.trim() }, { reauth: true });
      notify('Venta cancelada. Se registró un ajuste; el ticket se conserva.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Cancelar ${sale.folio}`}
      size="sm"
      dirty={reason.trim() !== ''}
      onClose={onClose}
      footer={
        <>
          <CloseButton label="Volver" disabled={busy} />
          <button type="submit" form="cancel-form" className="btn btn-danger" disabled={busy}>{busy ? 'Cancelando...' : 'Cancelar venta'}</button>
        </>
      }
    >
      <form id="cancel-form" className="form" onSubmit={submit} noValidate>
        <Alert tone="warn">Se cancelará el ticket por {formatMXN(sale.totalCents)}, se reintegrarán existencias y se ajustará la caja. Pedirá tu contraseña.</Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Motivo de la cancelación" required>
          <textarea rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function ReturnModal({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [sel, setSel] = useState<Record<string, { qty: string; restock: boolean }>>(() =>
    Object.fromEntries(sale.items.map((i) => [i.id, { qty: '0', restock: true }])),
  );
  const [reason, setReason] = useState('');
  const [pays, setPays] = useState<{ method: PaymentMethod; amount: string }[]>([
    { method: sale.payments[0]?.method ?? 'efectivo', amount: '' },
  ]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const selections: ReturnSelection[] = sale.items.map((i) => ({
    saleItemId: i.id,
    qty: Math.max(0, Number.parseInt(sel[i.id]?.qty ?? '0', 10) || 0),
    restock: sel[i.id]?.restock ?? true,
  }));
  const expected = computeReturnAmount(sale.items, selections);

  // Con un solo medio de pago, el importe se completa solo.
  useEffect(() => {
    setPays((p) => (p.length === 1 ? [{ ...p[0]!, amount: centsToInput(expected) }] : p));
  }, [expected]);

  const dirty = reason.trim() !== '' || selections.some((s) => s.qty > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payments = pays.map((p) => ({ method: p.method, amountCents: parseMoneyInput(p.amount) ?? -1 }));
    const errs = validateReturn(sale.items, selections, reason, payments.map((p) => ({ amountCents: p.amountCents })), expected);
    if (payments.some((p) => p.amountCents < 0)) errs.push('Hay un importe de pago no válido');
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      await api.post(
        `/sales/${sale.id}/return`,
        {
          reason: reason.trim(),
          items: selections.filter((s) => s.qty > 0).map((s) => ({ saleItemId: s.saleItemId, qty: s.qty, restock: s.restock })),
          payments: payments.filter((p) => p.amountCents > 0),
        },
        { reauth: true },
      );
      notify('Devolución registrada.');
      onDone();
    } catch (err) {
      setErrors([errorMessage(err)]);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Devolución de ${sale.folio}`}
      size="lg"
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <CloseButton label="Volver" disabled={busy} />
          <button type="submit" form="return-form" className="btn btn-primary" disabled={busy}>{busy ? 'Registrando...' : 'Registrar devolución'}</button>
        </>
      }
    >
      <form id="return-form" className="form" onSubmit={submit} noValidate>
        {errors.length > 0 && <Alert tone="error"><ul className="plain-list">{errors.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
        <TableWrap>
          <table className="table">
            <thead><tr><th>Producto</th><th className="num">Vendidas</th><th className="num">Devolver</th><th>Regresa a existencia</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {sale.items.map((it, idx) => (
                <tr key={it.id}>
                  <td>{it.productName} <span className="muted">{it.variantLabel}</span></td>
                  <td className="num">{it.qty}</td>
                  <td className="num">
                    <input className="qty-input" inputMode="numeric" aria-label={`Cantidad a devolver de ${it.productName}`} value={sel[it.id]?.qty ?? '0'}
                      onChange={(e) => setSel((s) => ({ ...s, [it.id]: { ...s[it.id]!, qty: e.target.value } }))} />
                  </td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={sel[it.id]?.restock ?? true} onChange={(e) => setSel((s) => ({ ...s, [it.id]: { ...s[it.id]!, restock: e.target.checked } }))} />
                      <span>{sel[it.id]?.restock ? 'Sí' : 'No (dañado / merma)'}</span>
                    </label>
                  </td>
                  <td className="num">{selections[idx]!.qty > 0 ? formatMXN(computeReturnAmount([it], [selections[idx]!])) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="strong">Importe a devolver: {formatMXN(expected)}</p>
        <fieldset className="fieldset">
          <legend>Cómo se devuelve el dinero</legend>
          {pays.map((p, i) => (
            <div className="stock-row" key={i}>
              <Field label="Medio">
                <select value={p.method} onChange={(e) => setPays((l) => l.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x)))}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                </select>
              </Field>
              <Field label="Importe (MXN)">
                <input inputMode="decimal" value={p.amount} onChange={(e) => setPays((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              </Field>
              {pays.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPays((l) => l.filter((_, j) => j !== i))}>Quitar</button>}
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setPays((l) => [...l, { method: 'efectivo', amount: '' }])}>Dividir en otro medio</button>
          <p className="muted small">La devolución en efectivo sale del cajón y afecta el corte de la sesión abierta. Pedirá tu contraseña al registrar.</p>
        </fieldset>
        <Field label="Motivo de la devolución" required>
          <textarea rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
