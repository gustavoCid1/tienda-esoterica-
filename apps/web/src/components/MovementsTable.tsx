import { formatMxDateTime } from '@amara/shared';
import { MOVEMENT_LABEL, formatDelta } from '../lib/inventory.ts';
import type { StockMovementRow } from '../lib/types.ts';
import { useBranches } from '../context.tsx';
import { Badge, Empty, TableWrap } from './ui.tsx';

/** Tabla de movimientos de inventario (historial). Los ajustes y conteos se resaltan. */
export function MovementsTable({ rows, showProduct = true }: { rows: StockMovementRow[]; showProduct?: boolean }) {
  const { branchName } = useBranches();
  if (rows.length === 0) return <Empty>No hay movimientos con esos filtros.</Empty>;
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th>
            {showProduct && <th>Producto</th>}
            <th>Sucursal</th>
            <th>Tipo</th>
            <th className="num">Cambio</th>
            <th>Motivo</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{formatMxDateTime(m.createdAt)}</td>
              {showProduct && (
                <td>
                  {m.productName ?? m.variantId.slice(0, 8)} <span className="muted">{m.variantLabel}</span>
                </td>
              )}
              <td>{branchName(m.branchId)}</td>
              <td>
                <Badge tone={m.type.startsWith('transferencia') ? 'gold' : m.type === 'venta' ? 'info' : 'muted'}>{MOVEMENT_LABEL[m.type] ?? m.type}</Badge>
              </td>
              <td className={`num strong ${m.delta < 0 ? 'neg' : m.delta > 0 ? 'pos' : ''}`}>{formatDelta(m.delta)}</td>
              <td>{m.reason}</td>
              <td>{m.userName ?? m.userId.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
