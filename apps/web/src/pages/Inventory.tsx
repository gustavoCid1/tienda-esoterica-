import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, asList } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { formatMXN, formatQty } from '../lib/format.ts';
import {
  DEFAULT_INVENTORY_FILTERS, countByStatus, filterInventory, uniqueCategories, type InventoryFilters, type StockStatus,
} from '../lib/inventory.ts';
import type { InventoryRow, StockMovementRow } from '../lib/types.ts';
import { Card, ErrorBox, Empty, Modal, PageHeader, Spinner, TableWrap } from '../components/ui.tsx';
import { BranchSelect, StockBadge, Thumb } from '../components/common.tsx';
import { MovementsTable } from '../components/MovementsTable.tsx';
import { useAuth } from '../context.tsx';

const PAGE = 200;

export function Inventory() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialStatus = params.get('estado');
  const [f, setF] = useState<InventoryFilters>({
    ...DEFAULT_INVENTORY_FILTERS,
    status: initialStatus === 'agotado' || initialStatus === 'bajo' ? (initialStatus as StockStatus) : 'todos',
  });
  const [limit, setLimit] = useState(PAGE);
  const [history, setHistory] = useState<InventoryRow | null>(null);
  const dq = useDebounced(f.q, 200);

  // Se pide por sucursal y se busca/filtra en el navegador con la misma lógica probada.
  const res = useAsync(
    (signal) => api.get<unknown>('/inventory', { branchId: f.branchId }, signal).then((d) => asList<InventoryRow>(d)),
    [f.branchId],
  );
  const rows = res.data ?? [];
  const filtered = useMemo(() => filterInventory(rows, { ...f, q: dq }), [rows, f, dq]);
  const counts = useMemo(() => countByStatus(rows.filter((r) => !r.archived)), [rows]);
  const categories = useMemo(() => uniqueCategories(rows), [rows]);
  const totalUnits = filtered.reduce((a, r) => a + Math.max(0, r.qty), 0);
  const shown = filtered.slice(0, limit);
  const set = <K extends keyof InventoryFilters>(k: K, v: InventoryFilters[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setLimit(PAGE);
  };

  return (
    <>
      <PageHeader title="Inventario" subtitle="Existencias por producto, variante y sucursal. Los cambios de existencia solo se hacen con movimientos registrados." />
      <div className="chips status-chips">
        {(
          [
            ['todos', `Todos (${rows.filter((r) => !r.archived).length})`],
            ['agotado', `Agotados (${counts.agotado})`],
            ['bajo', `Bajo mínimo (${counts.bajo})`],
            ['ok', `Disponibles (${counts.ok})`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={`chip ${f.status === id ? 'chip-active' : ''}`} onClick={() => set('status', id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="filters">
        <label className="inline-field grow">
          <span>Buscar</span>
          <input
            type="search"
            value={f.q}
            placeholder="Nombre, categoría, variante, SKU o código"
            onChange={(e) => set('q', e.target.value)}
          />
        </label>
        <label className="inline-field">
          <span>Sucursal</span>
          <BranchSelect value={f.branchId} onChange={(v) => set('branchId', v)} allLabel="Todas" />
        </label>
        <label className="inline-field">
          <span>Categoría</span>
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.showArchived} onChange={(e) => set('showArchived', e.target.checked)} />
          <span>Mostrar archivados</span>
        </label>
      </div>

      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          <p className="muted small">
            {formatQty(filtered.length)} renglón(es) &middot; {formatQty(totalUnits)} pieza(s) en existencia
          </p>
          {filtered.length === 0 ? (
            <Empty>No hay productos con esos filtros.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Foto</th>
                    <th>Producto</th>
                    <th>Variante</th>
                    <th>Categoría</th>
                    <th>Sucursal / lugar</th>
                    <th className="num">Existencia</th>
                    <th className="num">Mínimo</th>
                    <th className="num">Costo</th>
                    <th className="num">Precio</th>
                    <th>Códigos</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={`${r.variantId}-${r.branchId}`} className={r.archived ? 'row-archived' : ''}>
                      <td>
                        <Thumb src={r.photo} alt={r.productName} />
                      </td>
                      <td>
                        <strong>{r.productName}</strong>
                        {r.archived && <span className="muted"> (archivado)</span>}
                      </td>
                      <td>{r.variantLabel}</td>
                      <td>{r.category}</td>
                      <td>
                        {r.branchName ?? ''}
                        {r.location ? <div className="muted small">{r.location}</div> : null}
                      </td>
                      <td className="num strong">{formatQty(r.qty)}</td>
                      <td className="num">{formatQty(r.minStock)}</td>
                      <td className="num">{formatMXN(r.costCents)}</td>
                      <td className="num">{formatMXN(r.priceCents)}</td>
                      <td className="small">
                        {r.sku && <div>SKU {r.sku}</div>}
                        {r.barcode && <div>CB {r.barcode}</div>}
                        {r.code && <div className="muted">{r.code}</div>}
                      </td>
                      <td>
                        <StockBadge qty={r.qty} minStock={r.minStock} />
                      </td>
                      <td className="row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => setHistory(r)}>
                          Historial
                        </button>
                        {can('productos.ver') && (
                          <button type="button" className="btn btn-sm" onClick={() => navigate('/etiquetas', { state: { rows: [r] } })}>
                            Etiqueta
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {filtered.length > shown.length && (
            <div className="center">
              <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar más ({filtered.length - shown.length} restantes)
              </button>
            </div>
          )}
        </Card>
      )}
      {history && <HistoryModal row={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function HistoryModal({ row, onClose }: { row: InventoryRow; onClose: () => void }) {
  const res = useAsync(
    (signal) =>
      api
        .get<unknown>('/inventory/movements', { variantId: row.variantId, branchId: row.branchId }, signal)
        .then((d) => asList<StockMovementRow>(d)),
    [row.variantId, row.branchId],
  );
  return (
    <Modal title={`Historial: ${row.productName} ${row.variantLabel}`} size="xl" onClose={onClose}>
      {res.loading && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && <MovementsTable rows={res.data} showProduct={false} />}
    </Modal>
  );
}
