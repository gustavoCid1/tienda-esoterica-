/**
 * Ventanas de inventario: entrada/salida/ajuste/conteo de una variante y alta de producto nuevo.
 * Se usan desde la pantalla de Inventario y desde el modo INVENTARIO del punto de venta
 * (al escanear: pregunta cantidad, sucursal, lugar, variante y motivo).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CatalogHit } from '@amara/database';
import { newId } from '@amara/shared';
import type { BranchRow, VariantRow } from '../../shared/ipc.ts';
import { call, errorText } from '../lib/api.ts';
import { MOVEMENT_LABEL, money, parsePesos } from '../lib/format.ts';
import { stockView } from '../lib/cart.ts';
import { useFeedback } from '../state/Feedback.tsx';
import { Banner, Field } from './Field.tsx';
import { Modal } from './Modal.tsx';

export interface InvPerms {
  canEnter: boolean;
  canMove: boolean;
  canCreateProduct: boolean;
  grantExpiresAt: string | null;
}

type MoveType = 'entrada' | 'salida' | 'ajuste' | 'conteo';

const REASONS: Record<MoveType, string[]> = {
  entrada: ['Compra a proveedor', 'Devolución de cliente', 'Traspaso recibido', 'Producto encontrado', 'Otro'],
  salida: ['Merma o daño', 'Consumo interno', 'Regalo o muestra', 'Traspaso enviado', 'Otro'],
  ajuste: ['Corrección de captura', 'Otro'],
  conteo: ['Conteo físico'],
};

export function MovementModal({
  initial, perms, branches, defaultBranchId, onClose, onDone,
}: {
  initial: CatalogHit; perms: InvPerms; branches: BranchRow[]; defaultBranchId: string; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useFeedback();
  const movementId = useRef(newId()); // mismo id al reintentar: nunca se duplica el movimiento
  const allowed: MoveType[] = perms.canMove ? ['entrada', 'salida', 'ajuste', 'conteo'] : perms.canEnter ? ['entrada'] : [];
  const readOnly = allowed.length === 0;

  const [branchId, setBranchId] = useState(defaultBranchId);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [variantId, setVariantId] = useState(initial.variantId);
  const [type, setType] = useState<MoveType>(allowed[0] ?? 'entrada');
  const [qtyText, setQtyText] = useState('1');
  const [preset, setPreset] = useState(REASONS[allowed[0] ?? 'entrada'][0]!);
  const [reasonText, setReasonText] = useState('');
  const [location, setLocation] = useState(initial.location ?? '');
  const [locationTouched, setLocationTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    call('catalog:variants', { productId: initial.productId, branchId })
      .then((v) => alive && setVariants(v))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [initial.productId, branchId]);

  const current = variants.find((v) => v.variantId === variantId);
  const branch = branches.find((b) => b.id === branchId);
  const locations = useMemo(() => Array.from(new Set([...(branch?.locations ?? []), ...(current?.location ? [current.location] : [])])), [branch, current]);

  // Al cambiar de variante se sugiere su lugar (si la persona no escribió uno distinto).
  useEffect(() => {
    if (!locationTouched && current) setLocation(current.location ?? '');
  }, [current, locationTouched]);

  const q = Number(qtyText);
  const qtyOk = Number.isInteger(q) && (type === 'ajuste' ? q !== 0 : type === 'conteo' ? q >= 0 : q > 0);
  const currentQty = current?.qty ?? 0;
  const resulting = type === 'entrada' ? currentQty + q : type === 'salida' ? currentQty - q : type === 'ajuste' ? currentQty + q : q;
  const reason = preset === 'Otro' ? reasonText.trim() : preset;
  const dirty = !readOnly && (qtyText !== '1' || reasonText !== '' || variantId !== initial.variantId || branchId !== defaultBranchId || type !== allowed[0] || locationTouched);

  const changeType = (t: MoveType) => {
    setType(t);
    setPreset(REASONS[t][0]!);
    setReasonText('');
    setQtyText(t === 'conteo' ? String(currentQty) : '1');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!qtyOk) return setError('Escribe una cantidad válida.');
    if (reason.length < 3) return setError('Escribe el motivo del movimiento.');
    setBusy(true);
    setError(null);
    try {
      const r = await call('inventory:move', { id: movementId.current, branchId, variantId, type, qty: q, reason, location: location.trim() || undefined });
      toast('ok', `${MOVEMENT_LABEL[type]} registrada. Existencia ahora: ${r.newQty}.`);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={readOnly ? 'Consulta de producto' : 'Movimiento de inventario'}
      onClose={onClose}
      dirty={dirty}
      busy={busy}
      footer={
        readOnly ? (
          <button className="btn btn-gold" onClick={onClose}>Cerrar</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn btn-gold" form="mov-form" type="submit" disabled={busy || !qtyOk || reason.length < 3}>
              {busy ? 'Guardando...' : 'Registrar'}
            </button>
          </>
        )
      }
    >
      <div className="prodhead">
        <div className="prodhead-name">{initial.productName}</div>
        <div className="muted">{initial.category} - {initial.type}</div>
      </div>
      {readOnly && !perms.canEnter && (
        <Banner kind="info">Tu usuario solo puede consultar. Para dar entrada de mercancía el gerente debe darte un permiso temporal.</Banner>
      )}
      {!perms.canMove && perms.canEnter && perms.grantExpiresAt && (
        <Banner kind="info">Permiso temporal de entradas vigente hasta las {new Date(perms.grantExpiresAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}.</Banner>
      )}
      <form id="mov-form" onSubmit={submit} className="stack">
        <div className="grid2">
          <Field label="Sucursal">
            <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={readOnly || branches.length < 2}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Variante">
            <select className="inp" value={variantId} onChange={(e) => { setVariantId(e.target.value); setLocationTouched(false); }} disabled={readOnly && variants.length < 2}>
              {variants.length === 0 && <option value={initial.variantId}>{initial.label}</option>}
              {variants.map((v) => <option key={v.variantId} value={v.variantId}>{v.label} ({stockView(v.qty).soldOut ? 'sin existencia' : `${stockView(v.qty).shown} en existencia`})</option>)}
            </select>
          </Field>
        </div>
        <div className="stat-row">
          <div>
            <span className="muted">Existencia actual</span>
            <div className="stat-big">{stockView(currentQty).shown}</div>
            {stockView(currentQty).inherited && <div className="warn-text small">Existencia por corregir (el sistema tenía un saldo negativo). Haz un conteo físico.</div>}
          </div>
          <div><span className="muted">Precio</span><div className="stat-big">{money(current?.priceCents ?? initial.priceCents)}</div></div>
          <div><span className="muted">Código</span><div className="mono">{current?.internalCode ?? initial.internalCode}</div></div>
        </div>
        {!readOnly && (
          <>
            <div className="grid2">
              <Field label="Tipo de movimiento">
                <select className="inp" value={type} onChange={(e) => changeType(e.target.value as MoveType)} disabled={allowed.length === 1}>
                  {allowed.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field
                label={type === 'conteo' ? 'Cantidad contada' : type === 'ajuste' ? 'Cantidad (con signo, ej. -2)' : 'Cantidad'}
                error={qtyText !== '' && !qtyOk ? 'Cantidad no válida' : null}
              >
                <input className="inp inp-lg" inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
              </Field>
            </div>
            {qtyOk && (
              <div className="preview">
                {type === 'conteo' ? `Diferencia contra el sistema: ${q - currentQty >= 0 ? '+' : ''}${q - currentQty}. ` : ''}
                Existencia resultante: <strong>{Math.max(0, resulting)}</strong>
                {resulting < 0 && <span className="neg"> (no puede quedar por debajo de cero: revisa la cantidad)</span>}
              </div>
            )}
            <div className="grid2">
              <Field label="Lugar (ubicación)">
                <input className="inp" list="mov-locations" value={location} onChange={(e) => { setLocation(e.target.value); setLocationTouched(true); }} />
                <datalist id="mov-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
              </Field>
              <Field label="Motivo">
                <select className="inp" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {REASONS[type].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            </div>
            {preset === 'Otro' && (
              <Field label="Escribe el motivo" hint="Mínimo 3 letras">
                <input className="inp" value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
              </Field>
            )}
          </>
        )}
        {error && <Banner kind="error">{error}</Banner>}
      </form>
    </Modal>
  );
}

export function NewProductModal({
  initialCode, branches, defaultBranchId, onClose, onCreated,
}: {
  initialCode: string; branches: BranchRow[]; defaultBranchId: string; onClose: () => void; onCreated: () => void;
}) {
  const { toast } = useFeedback();
  const [f, setF] = useState({
    name: '', type: '', category: '', sku: '', brand: '', description: '', variantLabel: 'Única',
    barcode: initialCode, cost: '', price: '', minStock: '0', branchId: defaultBranchId, location: '', initialQty: '0',
  });
  const baseline = useRef(JSON.stringify(f)); // valores iniciales: sirve para saber si hay cambios sin guardar
  const [codeWarn, setCodeWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const cost = parsePesos(f.cost);
  const price = parsePesos(f.price);
  const minStock = Number(f.minStock);
  const initialQty = Number(f.initialQty);
  const problems = [
    f.name.trim().length < 2 && 'el nombre',
    !f.type.trim() && 'el tipo',
    !f.category.trim() && 'la categoría',
    !f.sku.trim() && 'el SKU',
    (cost === null || Number.isNaN(cost)) && 'el costo',
    (price === null || Number.isNaN(price)) && 'el precio',
    (!Number.isInteger(minStock) || minStock < 0) && 'el mínimo',
    (!Number.isInteger(initialQty) || initialQty < 0) && 'la existencia inicial',
  ].filter(Boolean) as string[];

  const checkCode = async (code: string) => {
    const c = code.trim();
    if (!c) return setCodeWarn(null);
    try {
      const r = await call('catalog:checkCode', { code: c });
      setCodeWarn(r.existsLocal || r.existsRemote ? 'Ese código ya existe en el catálogo.' : null);
    } catch {
      setCodeWarn(null);
    }
  };
  useEffect(() => {
    if (initialCode) void checkCode(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || problems.length > 0 || codeWarn) return;
    setBusy(true);
    setError(null);
    try {
      await call('catalog:createProduct', {
        name: f.name.trim(), type: f.type.trim(), category: f.category.trim(), sku: f.sku.trim(), brand: f.brand.trim() || undefined,
        description: f.description.trim() || undefined, variantLabel: f.variantLabel.trim() || 'Única', barcode: f.barcode.trim() || undefined,
        costCents: cost as number, priceCents: price as number, minStock, branchId: f.branchId, location: f.location.trim() || undefined, initialQty,
      });
      toast('ok', 'Producto creado. Se está actualizando el catálogo.');
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const dirty = JSON.stringify(f) !== baseline.current;

  return (
    <Modal
      title="Nuevo producto"
      size="lg"
      onClose={onClose}
      dirty={dirty}
      busy={busy}
      onScan={(code) => { setF((p) => ({ ...p, barcode: code })); void checkCode(code); }}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-gold" type="submit" form="new-product-form" disabled={busy || problems.length > 0 || !!codeWarn}>
            {busy ? 'Guardando...' : 'Crear producto'}
          </button>
        </>
      }
    >
      <form id="new-product-form" onSubmit={submit} className="stack">
        {initialCode && <Banner kind="info">El código <strong className="mono">{initialCode}</strong> no existía. Completa los datos para darlo de alta.</Banner>}
        <div className="grid2">
          <Field label="Nombre del producto"><input className="inp" value={f.name} onChange={set('name')} autoFocus /></Field>
          <Field label="SKU (clave interna)"><input className="inp" value={f.sku} onChange={set('sku')} /></Field>
          <Field label="Tipo" hint="Ej. Velas, Inciensos, Amuletos"><input className="inp" value={f.type} onChange={set('type')} /></Field>
          <Field label="Categoría" hint="Ej. Rituales, Protección"><input className="inp" value={f.category} onChange={set('category')} /></Field>
          <Field label="Marca (opcional)"><input className="inp" value={f.brand} onChange={set('brand')} /></Field>
          <Field label="Variante" hint="Ej. Chica, Grande, Única"><input className="inp" value={f.variantLabel} onChange={set('variantLabel')} /></Field>
        </div>
        <Field label="Descripción (opcional)"><input className="inp" value={f.description} onChange={set('description')} /></Field>
        <div className="grid3">
          <Field label="Código de barras" error={codeWarn} hint="Escanéalo o déjalo vacío para usar el código interno">
            <input className="inp mono" value={f.barcode} onChange={(e) => { set('barcode')(e); setCodeWarn(null); }} onBlur={(e) => void checkCode(e.target.value)} />
          </Field>
          <Field label="Costo ($)" error={f.cost !== '' && Number.isNaN(cost) ? 'Importe no válido' : null}>
            <input className="inp" inputMode="decimal" value={f.cost} onChange={set('cost')} />
          </Field>
          <Field label="Precio de venta ($)" error={f.price !== '' && Number.isNaN(price) ? 'Importe no válido' : null}>
            <input className="inp" inputMode="decimal" value={f.price} onChange={set('price')} />
          </Field>
        </div>
        <div className="grid3">
          <Field label="Sucursal de la existencia inicial">
            <select className="inp" value={f.branchId} onChange={set('branchId')}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
          <Field label="Existencia inicial"><input className="inp" inputMode="numeric" value={f.initialQty} onChange={set('initialQty')} onFocus={(e) => e.target.select()} /></Field>
          <Field label="Mínimo antes de avisar"><input className="inp" inputMode="numeric" value={f.minStock} onChange={set('minStock')} onFocus={(e) => e.target.select()} /></Field>
        </div>
        <Field label="Lugar (ubicación)"><input className="inp" value={f.location} onChange={set('location')} /></Field>
        {problems.length > 0 && f.name !== '' && <div className="muted small">Falta revisar: {problems.join(', ')}.</div>}
        {error && <Banner kind="error">{error}</Banner>}
      </form>
    </Modal>
  );
}
