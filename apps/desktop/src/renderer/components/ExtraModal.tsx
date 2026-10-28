/** Botón "Extra" (v2): cargo adicional sobre un producto (monto + nota). No mueve inventario. */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { MAX_EXTRA_CENTS, MAX_NOTE_LEN } from '../lib/cart.ts';
import { money, parsePesos } from '../lib/format.ts';
import { Field } from './Field.tsx';
import { Modal } from './Modal.tsx';

export function ExtraModal({ productName, onClose, onAdd }: { productName: string; onClose: () => void; onAdd: (cents: number, note: string) => string | null }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parsePesos(amount);
  const amountOk = cents !== null && !Number.isNaN(cents) && cents >= 0 && cents <= MAX_EXTRA_CENTS;
  const noteOk = note.trim().length >= 2;
  const ready = amountOk && noteOk;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready) return;
    const err = onAdd(cents as number, note);
    if (err) setError(err);
  };

  return (
    <Modal
      title="Agregar Extra"
      size="sm"
      onClose={onClose}
      dirty={amount !== '' || note !== ''}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-gold" disabled={!ready} onClick={() => submit()}>Agregar extra</button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <div className="preview">Extra sobre <strong>{productName}</strong>. Se suma al total como cargo adicional; no descuenta existencias.</div>
        <Field label="Monto del extra ($)" error={amount !== '' && !amountOk ? 'Escribe un importe válido (por ejemplo 25 o 25.50)' : null}>
          <input className="inp inp-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0.00" />
        </Field>
        <Field label="Nota (qué se cobra)" hint="Ejemplo: bordado, cargada, empaque especial">
          <input className="inp" value={note} maxLength={MAX_NOTE_LEN} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {amountOk && <div className="muted">Se agregará: <strong>{money(cents as number)}</strong></div>}
        {error && <div className="field-error">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
