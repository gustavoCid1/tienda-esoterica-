/**
 * Vista previa de un PDF en un modal, con Imprimir (imprime ESE PDF, no la página de la aplicación)
 * y Guardar PDF. El PDF se muestra con una URL temporal (blob) que se libera al cerrar.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadBlob, printPdfFrame } from '../lib/pdf.ts';
import { Modal } from './ui.tsx';
import { useToast } from '../context.tsx';

export function PdfPreviewModal(props: {
  title: string;
  blob: Blob;
  filename: string;
  onClose: () => void;
  /** Se llama cuando la persona manda el PDF a imprimir o lo guarda (para registrar la reimpresión). */
  onOutput?: (kind: 'imprimir' | 'guardar') => void;
  /** Texto o aviso que se muestra sobre la vista previa. */
  note?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const { notify } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const u = URL.createObjectURL(props.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [props.blob]);

  const print = () => {
    if (!url) return;
    const ok = printPdfFrame(frame.current, url);
    if (!ok) {
      notify('El navegador bloqueó la impresión. Usa Guardar PDF e imprímelo desde tu visor.', 'error');
      return;
    }
    props.onOutput?.('imprimir');
  };

  const save = () => {
    downloadBlob(props.filename, props.blob);
    props.onOutput?.('guardar');
  };

  return (
    <Modal
      title={props.title}
      size={props.size ?? 'xl'}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Cerrar
          </button>
          <button type="button" className="btn" onClick={save}>
            Guardar PDF
          </button>
          <button type="button" className="btn btn-primary" onClick={print} disabled={!url}>
            Imprimir
          </button>
        </>
      }
    >
      {props.note}
      {url ? (
        <iframe ref={frame} className="pdf-frame" src={url} title={props.title} />
      ) : (
        <div className="loading">Preparando vista previa...</div>
      )}
    </Modal>
  );
}
