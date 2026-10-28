import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, asList, listTotal } from '../lib/api.ts';
import { errorMessage, useAsync, useDebounced } from '../lib/hooks.ts';
import { formatMXN } from '../lib/format.ts';
import type { CatalogProduct, CatalogVariant, InventoryRow } from '../lib/types.ts';
import { Badge, Card, ConfirmDialog, Empty, ErrorBox, Modal, PageHeader, Spinner, TableWrap } from '../components/ui.tsx';
import { Thumb } from '../components/common.tsx';
import { ProductCreateModal, ProductEditModal, VariantEditModal } from '../components/ProductForms.tsx';
import { useAuth, useToast } from '../context.tsx';

const PAGE_SIZE = 50;

export function Catalog() {
  const { can } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'activo' | 'archivado' | ''>('activo');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q.trim(), 300);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [variantsOf, setVariantsOf] = useState<CatalogProduct | null>(null);
  const [editVariant, setEditVariant] = useState<{ p: CatalogProduct; v: CatalogVariant } | null>(null);
  const [toggling, setToggling] = useState<CatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);

  const res = useAsync(
    (signal) =>
      api.get<unknown>('/catalog/products', { q: dq, category, status, limit: PAGE_SIZE, offset }, signal).then((d) => ({
        items: asList<CatalogProduct>(d).map((p) => ({ ...p, specs: p.specs ?? {}, variants: p.variants ?? [] })),
        total: listTotal(d),
      })),
    [dq, category, status, offset],
  );
  const items = res.data?.items ?? [];
  const total = res.data?.total ?? 0;
  // Categorías conocidas: se acumulan para que el filtro no pierda opciones al filtrar.
  const knownCats = useRef(new Set<string>());
  items.forEach((p) => p.category && knownCats.current.add(p.category));
  const categories = [...knownCats.current].sort((a, b) => a.localeCompare(b, 'es'));
  const canEdit = can('productos.editar');

  const refresh = () => {
    setCreating(false);
    setEditing(null);
    setEditVariant(null);
    res.reload();
  };

  const toggleArchive = async () => {
    if (!toggling) return;
    setBusy(true);
    try {
      await api.post(`/catalog/products/${toggling.id}/${toggling.archived ? 'restore' : 'archive'}`, {});
      notify(toggling.archived ? 'Producto restaurado.' : 'Producto archivado (no se borra).');
      setToggling(null);
      res.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Para etiquetas se convierten las variantes del catálogo a la forma de una fila de inventario.
  const toLabelRows = (p: CatalogProduct): Partial<InventoryRow>[] =>
    p.variants.map((v) => ({
      variantId: v.id, productId: p.id, productName: p.name, category: p.category, variantLabel: v.label,
      sku: p.sku, barcode: v.barcode, code: v.code, priceCents: v.priceCents, costCents: v.costCents, qty: 0, minStock: v.minStock, branchId: '',
    }));

  return (
    <>
      <PageHeader
        title="Catálogo y variantes"
        subtitle="Productos, presentaciones, precios y códigos. Archivar no borra: el historial de ventas conserva la copia original."
        actions={
          canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Nuevo producto
            </button>
          )
        }
      />
      <div className="filters">
        <label className="inline-field grow">
          <span>Buscar</span>
          <input type="search" value={q} placeholder="Nombre, categoría, variante, SKU o código" onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </label>
        <label className="inline-field">
          <span>Categoría</span>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); }}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>Estado</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setOffset(0); }}>
            <option value="activo">Activos</option>
            <option value="archivado">Archivados</option>
            <option value="">Todos</option>
          </select>
        </label>
      </div>

      {res.loading && !res.data && <Spinner />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <Card>
          {items.length === 0 ? (
            <Empty>No hay productos con esos filtros.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Foto</th>
                    <th>Producto</th>
                    <th>Categoría / tipo</th>
                    <th>SKU</th>
                    <th>Variantes</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={p.archived ? 'row-archived' : ''}>
                      <td><Thumb src={p.photo} alt={p.name} /></td>
                      <td>
                        <strong>{p.name}</strong>
                        {p.brand && <div className="muted small">{p.brand}</div>}
                      </td>
                      <td>{p.category}<div className="muted small">{p.type}</div></td>
                      <td>{p.sku}</td>
                      <td>
                        {p.variants.length === 0 ? <span className="muted">Sin variantes</span> : p.variants.map((v) => (
                          <div key={v.id} className="small">{v.label}: {formatMXN(v.priceCents)}</div>
                        ))}
                      </td>
                      <td>{p.archived ? <Badge tone="muted">Archivado</Badge> : <Badge tone="ok">Activo</Badge>}</td>
                      <td className="row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => setVariantsOf(p)}>Variantes</button>
                        {canEdit && <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>Editar</button>}
                        <button type="button" className="btn btn-sm" onClick={() => navigate('/etiquetas', { state: { rows: toLabelRows(p) } })}>Etiquetas</button>
                        {canEdit && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setToggling(p)}>
                            {p.archived ? 'Restaurar' : 'Archivar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <div className="pager">
            <span className="muted small">{total === 0 ? '' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} de ${total}`}</span>
            <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
            <button type="button" className="btn btn-sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Siguiente</button>
          </div>
        </Card>
      )}

      {creating && <ProductCreateModal categories={categories} onClose={() => setCreating(false)} onSaved={refresh} />}
      {editing && <ProductEditModal product={editing} categories={categories} onClose={() => setEditing(null)} onSaved={refresh} />}
      {variantsOf && (
        <Modal title={`Variantes de ${variantsOf.name}`} size="lg" onClose={() => setVariantsOf(null)}>
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Presentación</th><th>Unidad</th><th>Códigos</th><th className="num">Costo</th><th className="num">Precio</th><th className="num">Mínimo</th><th /></tr>
              </thead>
              <tbody>
                {variantsOf.variants.map((v) => (
                  <tr key={v.id}>
                    <td>{v.label}</td>
                    <td>{v.unit}</td>
                    <td className="small">{v.barcode && <div>CB {v.barcode}</div>}{v.code && <div className="muted">{v.code}</div>}</td>
                    <td className="num">{formatMXN(v.costCents)}</td>
                    <td className="num">{formatMXN(v.priceCents)}</td>
                    <td className="num">{v.minStock}</td>
                    <td className="row-actions">
                      {canEdit && <button type="button" className="btn btn-sm" onClick={() => { setEditVariant({ p: variantsOf, v }); setVariantsOf(null); }}>Editar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="muted small">Para sumar una presentación nueva a un producto existente, créala como variante al dar de alta el producto (ver docs/PENDIENTES-web.md).</p>
        </Modal>
      )}
      {editVariant && <VariantEditModal product={editVariant.p} variant={editVariant.v} onClose={() => setEditVariant(null)} onSaved={refresh} />}
      {toggling && (
        <ConfirmDialog
          title={toggling.archived ? 'Restaurar producto' : 'Archivar producto'}
          message={toggling.archived ? `${toggling.name} volverá a estar disponible para venta.` : `${toggling.name} dejará de ofrecerse para venta. El historial y las existencias se conservan.`}
          confirmLabel={toggling.archived ? 'Restaurar' : 'Archivar'}
          busy={busy}
          onCancel={() => setToggling(null)}
          onConfirm={toggleArchive}
        />
      )}
    </>
  );
}
