/**
 * Ventana modal ordenada. REGLA: no se cierra con cambios sin confirmar.
 *  - Esc, clic fuera y la X piden confirmación si `dirty` es true.
 *  - Mientras hay una ventana abierta las lecturas del escáner NO llegan a la pantalla de fondo
 *    (se avisa), salvo que la ventana declare `onScan` (p. ej. el alta de producto recibe el código).
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFeedback } from '../state/Feedback.tsx';
import { useScanHandler } from '../state/Scanner.tsx';
import type { ScanSource } from '../state/Scanner.tsx';

/** Pila de ventanas abiertas: Esc solo cierra la de más arriba (no todas a la vez). */
const openModals: symbol[] = [];

interface ModalProps {
  title: string;
  onClose: () => void;
  /** Hay cambios sin guardar: pedir confirmación antes de cerrar. */
  dirty?: boolean;
  /** Operación en curso: no se puede cerrar. */
  busy?: boolean;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  onScan?: (code: string, source: ScanSource) => void;
  children: ReactNode;
}

export function Modal({ title, onClose, dirty, busy, size = 'md', footer, onScan, children }: ModalProps) {
  const { confirm, toast } = useFeedback();
  const closing = useRef(false);

  useScanHandler((code, source) => {
    if (onScan) onScan(code, source);
    else toast('warn', 'Termina o cierra esta ventana para seguir escaneando.');
  });

  const request = async () => {
    if (busy || closing.current) return;
    if (dirty) {
      closing.current = true;
      const discard = await confirm({
        title: 'Hay cambios sin guardar',
        message: 'Si cierras esta ventana se perderá lo que capturaste. ¿Quieres descartarlo?',
        confirmText: 'Descartar cambios',
        cancelText: 'Seguir editando',
        danger: true,
      });
      closing.current = false;
      if (!discard) return;
    }
    onClose();
  };

  const reqRef = useRef(request);
  reqRef.current = request;
  useEffect(() => {
    const me = Symbol('modal');
    openModals.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === me) void reqRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && void request()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-quiet" onClick={() => void request()} aria-label="Cerrar" disabled={busy}>
            Cerrar
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
