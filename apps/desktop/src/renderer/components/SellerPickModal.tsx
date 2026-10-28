/**
 * "¿Quién vende?" (v2): ventana que aparece ANTES del pago con los empleados activos de la sucursal.
 * El elegido se guarda en la venta (sellerId/sellerName) y NO se imprime en el ticket.
 * La última selección solo se SUGIERE (queda marcada), pero siempre hay que confirmar.
 */
import { useEffect, useState } from 'react';
import type { SellerRow } from '../../shared/ipc.ts';
import { call, errorText } from '../lib/api.ts';
import { getLastSeller, setLastSeller } from '../lib/seller-memory.ts';
import { useApp } from '../state/AppState.tsx';
import { Banner } from './Field.tsx';
import { Modal } from './Modal.tsx';

export function SellerPickModal({ onClose, onPick }: { onClose: () => void; onPick: (s: SellerRow) => void }) {
  const { user } = useApp();
  const [sellers, setSellers] = useState<SellerRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('sellers:list')
      .then((list) => {
        setSellers(list);
        const last = getLastSeller();
        // Sugerencia: el último elegido; si no existe, quien tiene la sesión. Nada se confirma solo.
        setSelected(list.find((s) => s.id === last)?.id ?? list.find((s) => s.id === user?.id)?.id ?? null);
      })
      .catch((e) => setError(errorText(e)));
  }, [user?.id]);

  const suggested = getLastSeller();
  const confirmPick = () => {
    const s = sellers?.find((x) => x.id === selected);
    if (!s) return;
    setLastSeller(s.id);
    onPick(s);
  };

  return (
    <Modal
      title="¿Quién vende?"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-gold btn-lg" disabled={!selected} onClick={confirmPick}>Continuar al pago</button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">Elige al empleado que atiende esta venta. Queda registrado en el sistema; no sale en el ticket.</p>
        {error && <Banner kind="error">{error}</Banner>}
        {sellers === null && !error && <p className="muted">Cargando empleados...</p>}
        {sellers?.length === 0 && <Banner kind="warn">No hay empleados cargados en este equipo. Sincroniza con internet al menos una vez.</Banner>}
        <div className="sellers" role="radiogroup" aria-label="Empleados">
          {sellers?.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected === s.id}
              className={selected === s.id ? 'seller seller-on' : 'seller'}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => { setSelected(s.id); setLastSeller(s.id); onPick(s); }}
            >
              <span className="seller-name">{s.name}</span>
              <span className="muted small">
                {s.role === 'gerente' ? 'Gerente' : 'Vendedor'}
                {suggested === s.id ? ' - último que vendió' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
