/** Componentes de interfaz básicos: modales, campos, avisos, tablas y tarjetas de indicadores. */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ Modales */

/** Permite que los botones "Cancelar" del pie pasen por la confirmación de cambios sin guardar. */
const ModalCloseContext = createContext<() => void>(() => undefined);

/** Botón de pie de modal que cierra respetando la confirmación de cambios sin guardar. */
export function CloseButton({ label = 'Cancelar', disabled }: { label?: string; disabled?: boolean }) {
  const close = useContext(ModalCloseContext);
  return (
    <button type="button" className="btn" onClick={close} disabled={disabled}>
      {label}
    </button>
  );
}

/** Pila de modales abiertos: Escape solo cierra el que está encima. */
const modalStack: symbol[] = [];

export interface ModalProps {
  title: string;
  onClose: () => void;
  /** Si es true, cerrar (Esc, clic fuera, X, Cancelar) pide confirmación antes de descartar. */
  dirty?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, onClose, dirty = false, size = 'md', children, footer }: ModalProps) {
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const me = useRef(Symbol('modal'));
  const panel = useRef<HTMLDivElement>(null);
  const requestClose = () => (dirty ? setConfirming(true) : onClose());
  const latest = useRef(requestClose);
  latest.current = requestClose;

  useEffect(() => {
    const id = me.current;
    modalStack.push(id);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Si un campo ya tomó el foco (autoFocus), no se le quita.
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <>
      <div
        className="modal-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) latest.current();
        }}
      >
        <ModalCloseContext.Provider value={requestClose}>
        <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Cerrar" onClick={requestClose}>
              &times;
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
        </ModalCloseContext.Provider>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Cambios sin guardar"
          message="Si cierras ahora se perderán los cambios que capturaste."
          confirmLabel="Descartar cambios"
          cancelLabel="Seguir editando"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

export function ConfirmDialog(props: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={props.title}
      size="sm"
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onCancel} disabled={props.busy}>
            {props.cancelLabel ?? 'Cancelar'}
          </button>
          <button type="button" className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm} disabled={props.busy}>
            {props.confirmLabel ?? 'Confirmar'}
          </button>
        </>
      }
    >
      <p className="prose">{props.message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------- Campos */

export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${props.error ? 'has-error' : ''} ${props.className ?? ''}`}>
      <span className="field-label">
        {props.label}
        {props.required && <span className="req" aria-hidden="true"> *</span>}
      </span>
      {props.children}
      {props.hint && !props.error && <span className="field-hint">{props.hint}</span>}
      {props.error && (
        <span className="field-error" role="alert">
          {props.error}
        </span>
      )}
    </label>
  );
}

export function Alert(props: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children: ReactNode }) {
  return (
    <div className={`alert alert-${props.tone ?? 'info'}`} role={props.tone === 'error' ? 'alert' : 'note'}>
      {props.title && <strong>{props.title}</strong>}
      <div>{props.children}</div>
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'gold';

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- Estados */

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}...</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Alert tone="error" title="No se pudo cargar">
      <span>{error}</span>
      {onRetry && (
        <>
          {' '}
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Reintentar
          </button>
        </>
      )}
    </Alert>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/* ------------------------------------------------------------------- Layout */

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p className="page-sub">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <div className="card-head">
          <h2>{props.title}</h2>
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {props.items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={props.value === t.id}
          className={`tab ${props.value === t.id ? 'active' : ''}`}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Envoltura de tabla con desplazamiento horizontal en pantallas angostas. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

/* ---------------------------------------------------------------- Indicadores */

/**
 * Tipo de cifra de un indicador. Se muestra una etiqueta y un color de borde propios para que
 * NUNCA se confundan unidades vendidas, importe de ventas, utilidad bruta, efectivo esperado
 * y efectivo contado.
 */
export type MetricKind = 'unidades' | 'importe' | 'utilidad' | 'esperado' | 'contado' | 'costo' | 'conteo';

export const METRIC_LABEL: Record<MetricKind, string> = {
  unidades: 'Unidades vendidas',
  importe: 'Importe de ventas',
  utilidad: 'Utilidad bruta estimada',
  esperado: 'Efectivo esperado',
  contado: 'Efectivo contado',
  costo: 'Costo de lo vendido',
  conteo: 'Cantidad',
};

export function KpiCard(props: { kind: MetricKind; title: string; value: ReactNode; sub?: ReactNode; note?: ReactNode }) {
  return (
    <div className={`kpi kpi-${props.kind}`}>
      <div className="kpi-tag">{METRIC_LABEL[props.kind]}</div>
      <div className="kpi-title">{props.title}</div>
      <div className="kpi-value">{props.value}</div>
      {props.sub && <div className="kpi-sub">{props.sub}</div>}
      {props.note && <div className="kpi-note">{props.note}</div>}
    </div>
  );
}
