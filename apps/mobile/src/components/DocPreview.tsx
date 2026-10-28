/** Ventana con la vista previa de un documento HTML y los botones Imprimir / Compartir o guardar PDF. */
import React, { useEffect, useState } from 'react';
import { Banner, Button, Muted } from './ui';
import { HtmlPreview } from './HtmlPreview';
import { Sheet } from './Sheet';
import { printHtml, shareHtmlPdf } from '../services/documents-service';
import type { PrintOutcome } from '../services/printing';

export function DocPreview(props: {
  visible: boolean;
  title: string;
  html: string;
  onClose: () => void;
  page?: { widthPt: number; heightPt: number };
  note?: string;
  /** Se llama cuando el sistema aceptó el trabajo de impresión. */
  onPrinted?: () => void;
  /** Texto del botón de impresión (por omisión "Imprimir"). */
  printLabel?: string;
}) {
  const { visible, title, html, onClose, page, note, onPrinted, printLabel } = props;
  const [busy, setBusy] = useState<null | 'print' | 'pdf'>(null);
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null);

  useEffect(() => {
    if (visible) setOutcome(null);
  }, [visible]);

  async function run(kind: 'print' | 'pdf') {
    setBusy(kind);
    setOutcome(null);
    const r = kind === 'print' ? await printHtml(html, page) : await shareHtmlPdf(html, title, page);
    setOutcome(r);
    if (kind === 'print' && r.ok) onPrinted?.();
    setBusy(null);
  }

  return (
    <Sheet visible={visible} title={title} onClose={onClose} full>
      <HtmlPreview html={html} height={360} />
      {note ? <Muted>{note}</Muted> : null}
      {outcome ? <Banner kind={outcome.ok ? 'ok' : 'error'} text={outcome.ok ? outcome.detail : outcome.error} /> : null}
      <Button title={printLabel ?? 'Imprimir'} onPress={() => void run('print')} loading={busy === 'print'} disabled={busy !== null} />
      <Button title="Compartir o guardar PDF" variant="secondary" onPress={() => void run('pdf')} loading={busy === 'pdf'} disabled={busy !== null} />
      <Button title="Cerrar" variant="dark" onPress={onClose} disabled={busy !== null} />
    </Sheet>
  );
}
