import type { ReactNode } from 'react';

/** Campo con etiqueta grande y texto de ayuda/error. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Banner({ kind, children, onClose }: { kind: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="banner-text">{children}</div>
      {onClose && (
        <button className="btn btn-quiet btn-sm" onClick={onClose}>
          Entendido
        </button>
      )}
    </div>
  );
}
