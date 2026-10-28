/**
 * Vista previa del ticket recién generado (las dos copias, cliente y tienda) con Imprimir (las dos seguidas en un solo
 * trabajo) y Compartir o guardar PDF. Es el mismo HTML para pantalla, impresión y PDF. El vendedor no aparece en el ticket.
 */
import React, { useEffect, useState } from 'react';
import type { TicketPayload } from '@amara/database';
import { Banner, Button, Muted } from './ui';
import { HtmlPreview } from './HtmlPreview';
import { ticketCopiesHtml } from '../lib/ticket-render';
import { printWithSystem, sharePdf } from '../services/printing';
import type { PrintOutcome } from '../services/printing';
import { useApp } from '../state/AppContext';

export function SaleTicketView({ saleId, onChanged }: { saleId: string; onChanged?: () => void }) {
  const { store } = useApp();
  const [payload, setPayload] = useState<TicketPayload | null>(null);
  const [printed, setPrinted] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<null | 'print' | 'pdf'>(null);
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null);

  useEffect(() => {
    if (!store) return;
    let off = false;
    store
      .getTicket(saleId)
      .then((t) => {
        if (off) return;
        if (t) {
          setPayload(t.payload);
          setPrinted(t.printCount > 0);
        } else setMissing(true);
      })
      .catch(() => !off && setMissing(true));
    return () => {
      off = true;
    };
  }, [store, saleId]);

  if (missing) return <Banner kind="error" text="No se encontró el ticket de esta venta en el teléfono." />;
  if (!payload || !store) return <Muted>Preparando vista previa del ticket...</Muted>;

  async function run(kind: 'print' | 'pdf') {
    if (!store || !payload) return;
    setBusy(kind);
    setOutcome(null);
    const r = kind === 'print' ? await printWithSystem(store, saleId, payload, printed) : await sharePdf(payload, printed);
    setOutcome(r);
    if (kind === 'print' && r.ok) setPrinted(true);
    setBusy(null);
    onChanged?.();
  }

  return (
    <>
      <HtmlPreview html={ticketCopiesHtml(payload, { reprint: printed })} height={380} />
      <Muted>Vista previa: copia del cliente y copia de la tienda. "Imprimir" manda las dos seguidas.</Muted>
      {outcome ? <Banner kind={outcome.ok ? 'ok' : 'error'} text={outcome.ok ? outcome.detail : outcome.error} /> : null}
      <Button title="Imprimir ticket (cliente y tienda)" onPress={() => void run('print')} loading={busy === 'print'} disabled={busy !== null} />
      <Button title="Compartir o guardar PDF" variant="secondary" onPress={() => void run('pdf')} loading={busy === 'pdf'} disabled={busy !== null} />
    </>
  );
}
