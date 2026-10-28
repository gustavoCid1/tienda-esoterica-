/** Avisos breves (toasts) y confirmaciones (reemplazo de window.confirm, con botones claros). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastKind = 'ok' | 'info' | 'warn' | 'error';
interface Toast { id: number; kind: ToastKind; text: string }

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (kind: ToastKind, text: string) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('FeedbackProvider ausente');
  return v;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500);
  }, []);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    [],
  );

  const answer = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="overlay overlay-top">
          <div className="modal modal-sm" role="alertdialog" aria-modal="true" aria-label={dialog.title}>
            <div className="modal-head">
              <h2>{dialog.title}</h2>
            </div>
            <div className="modal-body">{dialog.message}</div>
            <div className="modal-foot">
              <button className="btn" onClick={() => answer(false)} autoFocus>
                {dialog.cancelText ?? 'Cancelar'}
              </button>
              <button className={dialog.danger ? 'btn btn-danger' : 'btn btn-gold'} onClick={() => answer(true)}>
                {dialog.confirmText ?? 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
