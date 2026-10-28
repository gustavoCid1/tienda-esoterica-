/**
 * Vista previa de un documento imprimible (v2) con "Imprimir" y "Guardar PDF":
 *  - Ticket de venta: muestra COPIA CLIENTE y COPIA TIENDA tal como saldrán; "Imprimir" manda las DOS seguidas con un
 *    solo clic y SIN guardar PDF. La venta ya está guardada: imprimir o reimprimir nunca crea otra venta.
 *  - Ticket de cierre de caja y ticket de permiso (violeta, rótulo TICKET DE PERMISO).
 * "Guardar PDF" genera un PDF real en el proceso principal y abre el diálogo nativo de guardado.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocPreview, DocRequest, PrintResult } from '../../shared/ipc.ts';
import { call, errorText } from '../lib/api.ts';
import { useFeedback } from '../state/Feedback.tsx';
import { Banner } from './Field.tsx';
import { HtmlFrame } from './HtmlFrame.tsx';
import { Modal } from './Modal.tsx';

export function DocPreviewModal({
  doc, title, onClose, autoPrint, onPrinted, intro,
}: {
  doc: DocRequest;
  title?: string;
  onClose: () => void;
  /** Mandar a imprimir apenas aparezca la vista previa (ajuste "imprimir al cobrar"). */
  autoPrint?: boolean;
  onPrinted?: () => void;
  intro?: string;
}) {
  const { toast } = useFeedback();
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [printedOnce, setPrintedOnce] = useState(false);
  const busyRef = useRef(false);
  const autoDone = useRef(false);
  const docRef = useRef(doc);
  docRef.current = doc;

  const load = useCallback(async () => {
    try {
      setPreview(await call('print:preview', docRef.current));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const print = useCallback(async () => {
    if (busyRef.current) return; // doble clic: un solo trabajo de impresión
    busyRef.current = true;
    setBusy('print');
    setResult(null);
    try {
      const r = await call('print:document', { doc: docRef.current, action: 'print' });
      setResult(r);
      if (r.ok) {
        setPrintedOnce(true);
        toast('ok', docRef.current.kind === 'ticket' ? 'Se enviaron las dos copias (cliente y tienda) a la impresora.' : 'Documento enviado a la impresora.');
        onPrinted?.();
        void load(); // la siguiente impresión de un ticket sale marcada como REIMPRESIÓN: la vista previa lo refleja
      }
    } catch (e) {
      setResult({ ok: false, printedCopies: [], error: errorText(e) });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [load, onPrinted, toast]);

  const savePdf = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('pdf');
    try {
      const r = await call('print:document', { doc, action: 'pdf' });
      if (r.savedPath) toast('ok', `PDF guardado en ${r.savedPath}`);
      else if (!r.ok) setError(r.error ?? 'No se pudo generar el PDF.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  useEffect(() => {
    if (autoPrint && preview && !autoDone.current) {
      autoDone.current = true;
      void print();
    }
  }, [autoPrint, preview, print]);

  const isTicket = doc.kind === 'ticket';
  return (
    <Modal
      title={title ?? preview?.title ?? 'Vista previa'}
      size="lg"
      onClose={onClose}
      busy={busy === 'print'}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy === 'print'}>Cerrar</button>
          <button className="btn" onClick={() => void savePdf()} disabled={!preview || busy !== null}>{busy === 'pdf' ? 'Generando PDF...' : 'Guardar PDF'}</button>
          <button className="btn btn-gold btn-lg" onClick={() => void print()} disabled={!preview || busy !== null}>
            {busy === 'print' ? 'Imprimiendo...' : isTicket ? (printedOnce ? 'Imprimir otra vez (2 copias)' : 'Imprimir (2 copias)') : 'Imprimir'}
          </button>
        </>
      }
    >
      <div className="stack">
        {intro && <Banner kind="ok">{intro}</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
        {result && !result.ok && (
          <Banner kind="error">
            No se pudo imprimir, pero el ticket SIGUE guardado. {result.error}
            {result.printedCopies.length > 0 && ` (Ya salió la copia ${result.printedCopies.join(' y ')}.)`} Puedes volver a pulsar Imprimir.
          </Banner>
        )}
        {!preview && !error && <p className="muted">Preparando vista previa...</p>}
        {preview && (
          <>
            <div className="muted small">
              {isTicket
                ? 'Esto es lo que saldrá en la impresora: la copia del cliente y la de la tienda, una tras otra. Imprimir no vuelve a registrar la venta.'
                : 'Esto es lo que saldrá en la impresora.'}
            </div>
            <div className="docpages">
              {preview.pages.map((p) => (
                <figure key={p.label} className="docpage">
                  <figcaption className="muted small">{p.label}</figcaption>
                  <HtmlFrame html={p.html} title={p.label} widthMm={preview.paperMm} />
                </figure>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
