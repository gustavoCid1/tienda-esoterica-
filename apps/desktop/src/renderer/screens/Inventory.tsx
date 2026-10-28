/**
 * Inventario: consulta de existencias por sucursal (todos), movimientos y alta de productos según
 * permisos. La existencia mostrada es la del servidor + movimientos locales aún no enviados.
 * El costo solo lo recibe el gerente.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CatalogHit } from '@amara/database';
import { can } from '@amara/shared';
import type { BranchRow } from '../../shared/ipc.ts';
import { Banner, Field } from '../components/Field.tsx';
import { MovementModal, NewProductModal } from '../components/InventoryModals.tsx';
import type { InvPerms } from '../components/InventoryModals.tsx';
import { call, errorText } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { useApp } from '../state/AppState.tsx';
import { useFeedback } from '../state/Feedback.tsx';
import { usePos } from '../state/PosState.tsx';
import { useScanHandler } from '../state/Scanner.tsx';

export function InventoryScreen({ goLabels }: { goLabels: () => void }) {
  const { user } = useApp();
  const { toast } = useFeedback();
  const { setLabelQueue } = usePos();
  const isManager = !!user && can(user.role, 'productos.editar');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState('');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'todos' | 'agotados' | 'bajos'>('todos');
  const [rows, setRows] = useState<CatalogHit[]>([]);
  const [perms, setPerms] = useState<InvPerms | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movement, setMovement] = useState<CatalogHit | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([call('catalog:branches'), call('device:get'), call('inventory:permissions')])
      .then(([b, d, p]) => {
        setBranches(b);
        setBranchId(d.branch?.id ?? b[0]?.id ?? '');
        setPerms(p);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  // Escanear aquí busca el producto (para entradas se usa el modo INVENTARIO de la pantalla Vender).
  useScanHandler((code) => setText(code));

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      setRows(await call('catalog:inventory', { text, filter, branchId }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [branchId, text, filter]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const toLabels = (h: CatalogHit) => {
    setLabelQueue([h]);
    toast('info', 'Producto enviado a Etiquetas.');
    goLabels();
  };

  return (
    <div className="page">
      <div className="row-between">
        <h1>Inventario</h1>
        {perms?.canCreateProduct && <button className="btn btn-gold" onClick={() => setCreating(true)}>Nuevo producto</button>}
      </div>
      <div className="filters">
        <Field label="Sucursal">
          <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Buscar"><input className="inp" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nombre, categoría, SKU o código" /></Field>
        <Field label="Mostrar">
          <select className="inp" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="todos">Todo</option>
            <option value="bajos">Poca existencia</option>
            <option value="agotados">Agotados</option>
          </select>
        </Field>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <table className="table">
        <thead>
          <tr>
            <th>Producto</th><th>Variante</th><th>Código</th><th>Lugar</th><th className="num">Existencia</th><th className="num">Precio</th>
            {isManager && <th className="num">Costo</th>}<th />
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.variantId}>
              <td><div className="cell-main">{h.productName}</div><div className="muted small">{h.category}</div></td>
              <td>{h.label}</td>
              <td className="mono small">{h.barcode ?? h.internalCode}</td>
              <td>{h.location ?? '-'}</td>
              <td className={`num strong ${h.qty <= 0 ? 'neg' : h.qty <= h.minStock ? 'warn-text' : ''}`}>{h.qty}{h.qty <= 0 ? ' (agotado)' : h.qty <= h.minStock ? ' (poca)' : ''}</td>
              <td className="num">{money(h.priceCents)}</td>
              {isManager && <td className="num">{money(h.costCents)}</td>}
              <td className="num">
                <div className="row-gap row-end">
                  <button className="btn btn-sm" onClick={() => setMovement(h)}>{perms?.canEnter || perms?.canMove ? 'Movimiento' : 'Ver'}</button>
                  <button className="btn btn-sm" onClick={() => toLabels(h)}>Etiqueta</button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading && <tr><td colSpan={isManager ? 8 : 7} className="center muted">No hay productos con ese filtro.</td></tr>}
        </tbody>
      </table>
      {rows.length >= 300 && <div className="muted small">Se muestran los primeros 300 resultados. Afina la búsqueda para ver otros.</div>}
      {movement && perms && (
        <MovementModal initial={movement} perms={perms} branches={branches} defaultBranchId={branchId} onClose={() => setMovement(null)} onDone={() => { setMovement(null); void load(); }} />
      )}
      {creating && (
        <NewProductModal initialCode="" branches={branches} defaultBranchId={branchId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); window.setTimeout(() => void load(), 1500); }} />
      )}
    </div>
  );
}
