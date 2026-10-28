/**
 * Vista previa de la hoja de etiquetas (v2) con "Imprimir" y "Guardar PDF" (diálogo nativo de guardado).
 * La vista usa las mismas etiquetas (mismo HTML interno y mismas reglas) que la hoja que se imprime.
 */
import { useMemo, useRef, useState } from 'react';
import { buildLabelPreviewHtml } from '../../shared/label-html.ts';
import type { LabelRender, LabelSheetOptions } from '../../shared/label-html.ts';
import { call, errorText } from '../lib/api.ts';
import { useFeedback } from '../state/Feedback.tsx';
import { Banner } from './Field.tsx';
import { HtmlFrame } from './HtmlFrame.tsx';
import { Modal } from './Modal.tsx';

export function LabelPreviewModal({
  labels, options, printHtml, onClose, onPrinted,
}: {
  labels: LabelRender[];
  options: LabelSheetOptions;
  /** Hoja de impresión ya armada (una etiqueta por página). */
  printHtml: string;
  onClose: () => void;
  onPrinted: () => void;
}) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const previewHtml = useMemo(() => buildLabelPreviewHtml(labels, options), [labels, options]);
  const { widthMm, heightMm } = options;

  const run = async (kind: 'print' | 'pdf') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'print') {
        const r = await call('print:labels', { html: printHtml, widthMm, heightMm });
        if (!r.ok) return void setError(r.error ?? 'No se pudo imprimir.');
        toast('ok', `${labels.length} etiqueta(s) enviadas a la impresora.`);
        onPrinted();
      } else {
        const r = await call('labels:savePdf', { html: printHtml, widthMm, heightMm });
        if (r.savedPath) toast('ok', `PDF guardado en ${r.savedPath}`);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  return (
    <Modal
      title={`Vista previa: ${labels.length} etiqueta${labels.length === 1 ? '' : 's'} de ${widthMm} x ${heightMm} mm`}
      size="lg"
      onClose={onClose}
      busy={busy === 'print'}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy !== null}>Cerrar</button>
          <button className="btn" onClick={() => void run('pdf')} disabled={busy !== null}>{busy === 'pdf' ? 'Generando PDF...' : 'Guardar PDF'}</button>
          <button className="btn btn-gold btn-lg" onClick={() => void run('print')} disabled={busy !== null}>{busy === 'print' ? 'Enviando...' : 'Imprimir'}</button>
        </>
      }
    >
      <div className="stack">
        {error && <Banner kind="error">{error}</Banner>}
        <div className="muted small">Así saldrá cada etiqueta (una por hoja del rollo). Los recuadros grises solo existen en esta vista.</div>
        <HtmlFrame html={previewHtml} title="Hoja de etiquetas" autoHeight={false} height={420} />
      </div>
    </Modal>
  );
}
