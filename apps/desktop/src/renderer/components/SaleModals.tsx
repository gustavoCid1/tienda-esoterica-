/** Ventanas del punto de venta: cobro (pagos mixtos y cambio), descuento y elección de variante. */
import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CatalogHit } from '@amara/database';
import { newId } from '@amara/shared';
import type { Sale } from '@amara/shared';
import { call, errorText } from '../lib/api.ts';
import { money, parsePesos, pesosText } from '../lib/format.ts';
import { planPayments } from '../lib/payments.ts';
import type { PaymentDraft } from '../lib/payments.ts';
import type { CartLine } from '../state/PosState.tsx';
import { Banner, Field } from './Field.tsx';
import { Modal } from './Modal.tsx';

export interface PaidResult {
  sale: Sale;
  duplicate: boolean;
  warnings: string[];
}

export function PaymentModal({
  totalCents, discountCents, lines, onClose, onPaid,
}: {
  totalCents: number; discountCents: number; lines: CartLine[]; onClose: () => void; onPaid: (r: PaidResult) => void;
}) {
  // El id se crea UNA vez al abrir: si el cobro se reintenta (o se da doble clic), es la MISMA venta
  // y el almacén responde "duplicada" en vez de registrar dos.
  const saleId = useRef(newId());
  const submitting = useRef(false);
  const [card, setCard] = useState('');
  const [transfer, setTransfer] = useState('');
  const [other, setOther] = useState('');
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = { tarjeta: parsePesos(card), transferencia: parsePesos(transfer), otro: parsePesos(other) };
  const tenderedCents = parsePesos(tendered);
  const invalid = Object.values(parsed).some((v) => v !== null && Number.isNaN(v)) || (tenderedCents !== null && Number.isNaN(tenderedCents));

  const plan = useMemo(() => {
    if (invalid) return null;
    const draft: PaymentDraft = {
      totalCents,
      nonCash: { tarjeta: parsed.tarjeta ?? 0, transferencia: parsed.transferencia ?? 0, otro: parsed.otro ?? 0 },
      cashTenderedCents: tenderedCents,
    };
    return planPayments(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid, totalCents, card, transfer, other, tendered]);

  const dirty = card !== '' || transfer !== '' || other !== '' || tendered !== '';
  const cashDue = plan?.cashDueCents ?? 0;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting.current || !plan || !plan.ok) return; // bloqueo síncrono: el doble clic no llega a la segunda llamada
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call('sales:create', {
        saleId: saleId.current,
        items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        discountCents,
        payments: plan.payments,
      });
      onPaid(r);
    } catch (err) {
      setError(errorText(err));
      submitting.current = false;
      setBusy(false);
    }
  };

  const bills = [50, 100, 200, 500, 1000];

  return (
    <Modal
      title="Cobrar"
      size="md"
      onClose={onClose}
      dirty={dirty}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-gold btn-lg" onClick={() => void submit()} disabled={busy || !plan || !plan.ok}>
            {busy ? 'Guardando venta...' : 'Confirmar cobro'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <div className="paytotal">
          <span>Total a cobrar</span>
          <strong>{money(totalCents)}</strong>
        </div>
        <div className="grid3">
          <Field label="Tarjeta ($)">
            <input className="inp" inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Transferencia ($)">
            <input className="inp" inputMode="decimal" value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Otro ($)">
            <input className="inp" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <div className="row-gap">
          <button type="button" className="btn btn-sm" onClick={() => { setCard(pesosText(totalCents)); setTransfer(''); setOther(''); setTendered(''); }}>Todo con tarjeta</button>
          <button type="button" className="btn btn-sm" onClick={() => { setTransfer(pesosText(totalCents)); setCard(''); setOther(''); setTendered(''); }}>Todo por transferencia</button>
          <button type="button" className="btn btn-sm" onClick={() => { setCard(''); setTransfer(''); setOther(''); setTendered(''); }}>Todo en efectivo</button>
        </div>

        <div className="cashbox">
          <div className="cashbox-row">
            <span>Falta por cobrar en efectivo</span>
            <strong>{money(cashDue)}</strong>
          </div>
          {cashDue > 0 && (
            <>
              <Field label="Efectivo recibido ($)" hint="Déjalo vacío si el cliente paga exacto">
                <input className="inp inp-lg" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={pesosText(cashDue)} autoFocus />
              </Field>
              <div className="row-gap">
                {bills.filter((b) => b * 100 >= cashDue || b === 1000).map((b) => (
                  <button type="button" key={b} className="btn btn-sm" onClick={() => setTendered(String(b))}>{money(b * 100)}</button>
                ))}
                <button type="button" className="btn btn-sm" onClick={() => setTendered('')}>Exacto</button>
              </div>
            </>
          )}
          <div className="change">
            <span>Cambio</span>
            <strong>{plan && plan.ok ? money(plan.changeCents) : '--'}</strong>
          </div>
        </div>

        {invalid && <Banner kind="error">Hay un importe con formato no válido. Usa solo números, por ejemplo 150 o 150.50.</Banner>}
        {plan && !plan.ok && !invalid && (card || transfer || other || tendered) && <Banner kind="warn">{plan.error}</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function DiscountModal({
  subtotalCents, currentCents, onClose, onApply,
}: {
  subtotalCents: number; currentCents: number; onClose: () => void; onApply: (cents: number) => void;
}) {
  const [mode, setMode] = useState<'monto' | 'porcentaje'>('monto');
  const [value, setValue] = useState(currentCents > 0 ? pesosText(currentCents) : '');
  const n = parsePesos(value);
  let cents: number | null = null;
  if (n !== null && !Number.isNaN(n)) cents = mode === 'monto' ? n : Math.round((subtotalCents * n) / 10000);
  const tooBig = cents !== null && cents > subtotalCents;
  const valid = cents !== null && !tooBig;

  return (
    <Modal
      title="Descuento a toda la venta"
      size="sm"
      onClose={onClose}
      dirty={value !== (currentCents > 0 ? pesosText(currentCents) : '')}
      footer={
        <>
          {currentCents > 0 && <button className="btn" onClick={() => onApply(0)}>Quitar descuento</button>}
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-gold" disabled={!valid} onClick={() => valid && onApply(cents as number)}>Aplicar</button>
        </>
      }
    >
      <div className="stack">
        <div className="segmented">
          <button type="button" className={mode === 'monto' ? 'seg seg-on' : 'seg'} onClick={() => setMode('monto')}>Monto ($)</button>
          <button type="button" className={mode === 'porcentaje' ? 'seg seg-on' : 'seg'} onClick={() => setMode('porcentaje')}>Porcentaje (%)</button>
        </div>
        <Field label={mode === 'monto' ? 'Descuento en pesos' : 'Descuento en porcentaje'} error={tooBig ? 'No puede ser mayor al subtotal' : n !== null && Number.isNaN(n) ? 'Valor no válido' : null}>
          <input className="inp inp-lg" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <div className="preview">
          Subtotal {money(subtotalCents)} - Descuento {money(valid ? (cents as number) : 0)} = <strong>{money(subtotalCents - (valid ? (cents as number) : 0))}</strong>
        </div>
      </div>
    </Modal>
  );
}

export function VariantChoiceModal({ hits, onClose, onPick }: { hits: CatalogHit[]; onClose: () => void; onPick: (h: CatalogHit) => void }) {
  return (
    <Modal title="Elige el producto" size="sm" onClose={onClose} footer={<button className="btn" onClick={onClose}>Cancelar</button>}>
      <p className="muted">Ese código corresponde a más de un producto.</p>
      <div className="stack">
        {hits.map((h) => (
          <button key={h.variantId} className="btn btn-block btn-left" onClick={() => onPick(h)}>
            <strong>{h.productName}</strong> - {h.label}
            <span className="muted"> ({money(h.priceCents)}, existencia {h.qty})</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
