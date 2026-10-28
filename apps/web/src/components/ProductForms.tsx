/**
 * Modales de catálogo: alta de producto (con variantes y existencia inicial), edición de datos
 * del producto y edición de variantes. Validan con los esquemas Zod de @amara/shared antes de
 * enviar (el servidor vuelve a validar) y piden confirmación al cerrar con cambios sin guardar.
 */
import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { buildInternalCode } from '@amara/shared';
import { api, ApiError } from '../lib/api.ts';
import { errorMessage, useDirty } from '../lib/hooks.ts';
import {
  buildProductEditPayload, buildProductPayload, buildVariantEditPayload, emptyProductForm, emptyVariantForm,
  firstError, type FieldErrors, type ProductForm, type VariantEditForm,
} from '../lib/forms.ts';
import { centsToInput } from '../lib/format.ts';
import type { CatalogProduct, CatalogVariant } from '../lib/types.ts';
import { useBranches, useToast } from '../context.tsx';
import { Alert, Badge, Field, Modal, CloseButton } from './ui.tsx';
import { PhotoInput } from './common.tsx';

const SPEC_SUGGESTIONS = ['Material', 'Color', 'Peso', 'Dimensiones', 'Aroma', 'Origen', 'Duración', 'Uso recomendado'];

/* ------------------------------------------------- Campos generales del producto */

function ProductFields(props: {
  form: ProductForm;
  setForm: Dispatch<SetStateAction<ProductForm>>;
  errors: FieldErrors;
  categories: string[];
}) {
  const { form, setForm, errors } = props;
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <>
      <div className="grid-2">
        <Field label="Nombre del producto" required error={errors['product.name'] ?? errors.name}>
          <input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Tipo" required hint="Ejemplo: vela, incienso, mineral, libro" error={errors['product.type'] ?? errors.type}>
          <input value={form.type} maxLength={60} onChange={(e) => set('type', e.target.value)} />
        </Field>
        <Field label="Categoría" required error={errors['product.category'] ?? errors.category}>
          <input value={form.category} maxLength={60} list="dl-categories" onChange={(e) => set('category', e.target.value)} />
          <datalist id="dl-categories">
            {props.categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="SKU" required hint="Clave interna única del producto" error={errors['product.sku'] ?? errors.sku}>
          <input value={form.sku} maxLength={40} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Marca" error={errors['product.brand'] ?? errors.brand}>
          <input value={form.brand} maxLength={80} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label="Descripción" error={errors['product.description'] ?? errors.description}>
          <input value={form.description} maxLength={1000} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>

      <fieldset className="fieldset">
        <legend>Foto (opcional)</legend>
        <PhotoInput value={form.photo} onChange={(v) => set('photo', v)} />
        {(errors['product.photo'] ?? errors.photo) && <span className="field-error">{errors['product.photo'] ?? errors.photo}</span>}
      </fieldset>

      <fieldset className="fieldset">
        <legend>Especificaciones</legend>
        <p className="muted small">Datos configurables en pares nombre-valor (por ejemplo, Material: cera de soya).</p>
        <datalist id="dl-specs">
          {SPEC_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {form.specs.map((s, i) => (
          <div className="spec-row" key={i}>
            <input
              aria-label="Nombre de la especificación"
              placeholder="Nombre"
              list="dl-specs"
              maxLength={60}
              value={s.key}
              onChange={(e) => set('specs', form.specs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
            />
            <input
              aria-label="Valor de la especificación"
              placeholder="Valor"
              maxLength={300}
              value={s.value}
              onChange={(e) => set('specs', form.specs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('specs', form.specs.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
        {(errors['product.specs'] ?? errors.specs) && <span className="field-error">{errors['product.specs'] ?? errors.specs}</span>}
        <button type="button" className="btn btn-sm" onClick={() => set('specs', [...form.specs, { key: '', value: '' }])}>
          Agregar especificación
        </button>
      </fieldset>

      <Field label="Observaciones" error={errors['product.notes'] ?? errors.notes}>
        <textarea rows={2} value={form.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </>
  );
}

/* --------------------------------------------------------------- Alta de producto */

export function ProductCreateModal(props: { categories: string[]; onClose: () => void; onSaved: () => void }) {
  const { branches } = useBranches();
  const { notify } = useToast();
  const [form, setForm] = useState<ProductForm>(() => emptyProductForm(branches.length === 1 ? branches[0]!.id : ''));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dupCodes, setDupCodes] = useState<Record<number, boolean>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useDirty(form);

  const setVariant = (i: number, patch: Partial<ProductForm['variants'][number]>) =>
    setForm((f) => ({ ...f, variants: f.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));

  // Pregunta al servidor si el código ya existe (el servidor sigue siendo quien decide al guardar).
  const checkCode = async (i: number, code: string) => {
    const c = code.trim();
    if (!c) {
      setDupCodes((d) => ({ ...d, [i]: false }));
      return;
    }
    try {
      const r = await api.get<{ duplicate: boolean }>('/catalog/codes/check', { code: c });
      setDupCodes((d) => ({ ...d, [i]: !!r.duplicate }));
    } catch {
      /* si falla la verificación, el servidor lo validará al guardar */
    }
  };

  const generateCode = async (i: number) => {
    try {
      const r = await api.post<{ code?: string; seq?: number }>('/catalog/codes/next', {});
      const code = r.code ?? (typeof r.seq === 'number' ? buildInternalCode(r.seq) : '');
      if (!code) throw new Error('El servidor no devolvió un código.');
      setVariant(i, { barcode: code });
      setDupCodes((d) => ({ ...d, [i]: false }));
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = buildProductPayload(form);
    const errs = { ...r.errors };
    Object.entries(dupCodes).forEach(([i, dup]) => {
      if (dup) errs[`variants.${i}.barcode`] = 'Este código ya está registrado en otro producto';
    });
    setErrors(errs);
    if (!r.payload || Object.keys(errs).length > 0) {
      setServerError(`Revisa el formulario: ${firstError(errs) ?? 'hay datos por corregir'}`);
      return;
    }
    setBusy(true);
    try {
      await api.post('/catalog/products', r.payload);
      notify('Producto creado.');
      props.onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nuevo producto"
      size="xl"
      dirty={dirty}
      onClose={props.onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="product-create" className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando...' : 'Guardar producto'}
          </button>
        </>
      }
    >
      <form id="product-create" className="form" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <ProductFields form={form} setForm={setForm} errors={errors} categories={props.categories} />

        <h3 className="section-title">Variantes (tamaño o presentación)</h3>
        <Alert tone="info">
          El código QR de cada variante se genera automáticamente al guardar (contiene solo su identificador). El código de barras puede ser
          el del fabricante o uno interno; luego podrás imprimir ambas etiquetas en la sección Etiquetas.
        </Alert>
        {form.variants.map((v, i) => (
          <fieldset className="fieldset variant-box" key={i}>
            <legend>
              Variante {i + 1}
              {form.variants.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((_, j) => j !== i) }))}
                >
                  Quitar variante
                </button>
              )}
            </legend>
            <div className="grid-3">
              <Field label="Tamaño / presentación" required hint="Ejemplo: 100 ml, caja de 20, mediana" error={errors[`variants.${i}.label`]}>
                <input value={v.label} maxLength={60} onChange={(e) => setVariant(i, { label: e.target.value })} />
              </Field>
              <Field label="Unidad" error={errors[`variants.${i}.unit`]}>
                <input value={v.unit} maxLength={20} onChange={(e) => setVariant(i, { unit: e.target.value })} />
              </Field>
              <Field label="Código de barras" hint="Déjalo vacío para usar un código interno" error={errors[`variants.${i}.barcode`]}>
                <div className="input-action">
                  <input
                    value={v.barcode}
                    maxLength={40}
                    onChange={(e) => {
                      setVariant(i, { barcode: e.target.value });
                      setDupCodes((d) => ({ ...d, [i]: false }));
                    }}
                    onBlur={(e) => checkCode(i, e.target.value)}
                  />
                  <button type="button" className="btn btn-sm" onClick={() => generateCode(i)}>
                    Generar interno
                  </button>
                </div>
              </Field>
              <Field label="Costo (MXN)" required error={errors[`variants.${i}.costCents`]}>
                <input inputMode="decimal" placeholder="0.00" value={v.cost} onChange={(e) => setVariant(i, { cost: e.target.value })} />
              </Field>
              <Field label="Precio de venta (MXN)" required error={errors[`variants.${i}.priceCents`]}>
                <input inputMode="decimal" placeholder="0.00" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} />
              </Field>
              <Field label="Existencia mínima" hint="Aviso de bajo mínimo" error={errors[`variants.${i}.minStock`]}>
                <input inputMode="numeric" value={v.minStock} onChange={(e) => setVariant(i, { minStock: e.target.value })} />
              </Field>
            </div>
            <Field label="Lugar habitual" hint="Vitrina, estante, bodega..." error={errors[`variants.${i}.location`]}>
              <input value={v.location} maxLength={60} onChange={(e) => setVariant(i, { location: e.target.value })} />
            </Field>

            <div className="sub-title">Cantidad inicial por sucursal</div>
            {v.stock.map((s, j) => {
              const locs = branches.find((b) => b.id === s.branchId)?.locations ?? [];
              const upd = (patch: Partial<typeof s>) =>
                setVariant(i, { stock: v.stock.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
              return (
                <div className="stock-row" key={j}>
                  <Field label="Sucursal" error={errors[`variants.${i}.stock.${j}.branchId`]}>
                    <select value={s.branchId} onChange={(e) => upd({ branchId: e.target.value })}>
                      <option value="">Elige una sucursal</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Cantidad" error={errors[`variants.${i}.stock.${j}.qty`]}>
                    <input inputMode="numeric" value={s.qty} onChange={(e) => upd({ qty: e.target.value })} />
                  </Field>
                  <Field label="Lugar" error={errors[`variants.${i}.stock.${j}.location`]}>
                    <input value={s.location} list={`dl-loc-${i}-${j}`} maxLength={60} onChange={(e) => upd({ location: e.target.value })} />
                    <datalist id={`dl-loc-${i}-${j}`}>
                      {locs.map((l) => (
                        <option key={l} value={l} />
                      ))}
                    </datalist>
                  </Field>
                  {v.stock.length > 1 && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVariant(i, { stock: v.stock.filter((_, k) => k !== j) })}>
                      Quitar
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setVariant(i, { stock: [...v.stock, { branchId: '', qty: '0', location: '' }] })}
            >
              Agregar otra sucursal
            </button>
          </fieldset>
        ))}
        <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, emptyVariantForm(branches.length === 1 ? branches[0]!.id : '')] }))}>
          Agregar otra variante
        </button>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------- Edición de producto */

export function productToForm(p: CatalogProduct): ProductForm {
  return {
    name: p.name,
    type: p.type,
    category: p.category,
    sku: p.sku,
    brand: p.brand ?? '',
    description: p.description ?? '',
    notes: p.notes ?? '',
    photo: p.photo ?? '',
    specs: Object.entries(p.specs ?? {}).map(([key, value]) => ({ key, value })),
    variants: [],
  };
}

export function ProductEditModal(props: { product: CatalogProduct; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState<ProductForm>(() => productToForm(props.product));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useDirty(form);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = buildProductEditPayload(form);
    setErrors(r.errors);
    if (!r.payload) {
      setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/catalog/products/${props.product.id}`, r.payload);
      notify('Producto actualizado.');
      props.onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Editar producto: ${props.product.name}`}
      size="lg"
      dirty={dirty}
      onClose={props.onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="product-edit" className="btn btn-primary" disabled={busy || !dirty}>
            {busy ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <form id="product-edit" className="form" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <ProductFields form={form} setForm={setForm} errors={errors} categories={props.categories} />
        <p className="muted small">Los cambios quedan en la auditoría. Para modificar precios, costos o mínimos edita la variante.</p>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------- Edición de variante */

export function VariantEditModal(props: { product: CatalogProduct; variant: CatalogVariant; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const v = props.variant;
  const [form, setForm] = useState<VariantEditForm>({
    label: v.label,
    unit: v.unit,
    barcode: v.barcode ?? '',
    cost: centsToInput(v.costCents),
    price: centsToInput(v.priceCents),
    minStock: String(v.minStock),
    location: v.location ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useDirty(form);
  const set = (patch: Partial<VariantEditForm>) => setForm((f) => ({ ...f, ...patch }));
  const preview = buildVariantEditPayload(form, v);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = buildVariantEditPayload(form, v);
    setErrors(r.errors);
    if (!r.payload) {
      setServerError(`Revisa el formulario: ${firstError(r.errors) ?? 'hay datos por corregir'}`);
      return;
    }
    if (!r.changed) {
      props.onClose();
      return;
    }
    setBusy(true);
    try {
      // Los cambios de precio o costo exigen confirmar la contraseña (x-reauth).
      await api.patch(`/catalog/variants/${v.id}`, r.payload, { reauth: r.sensitive });
      notify('Variante actualizada.');
      props.onSaved();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Variante: ${props.product.name} / ${v.label}`}
      dirty={dirty}
      onClose={props.onClose}
      footer={
        <>
          <CloseButton label="Cancelar" disabled={busy} />
          <button type="submit" form="variant-edit" className="btn btn-primary" disabled={busy || !dirty}>
            {busy ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <form id="variant-edit" className="form" onSubmit={submit} noValidate>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <div className="grid-2">
          <Field label="Tamaño / presentación" required error={errors.label}>
            <input value={form.label} maxLength={60} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <Field label="Unidad" error={errors.unit}>
            <input value={form.unit} maxLength={20} onChange={(e) => set({ unit: e.target.value })} />
          </Field>
          <Field label="Código de barras" error={errors.barcode}>
            <input value={form.barcode} maxLength={40} onChange={(e) => set({ barcode: e.target.value })} />
          </Field>
          <Field label="Lugar habitual" error={errors.location}>
            <input value={form.location} maxLength={60} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label="Costo (MXN)" error={errors.costCents}>
            <input inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
          </Field>
          <Field label="Precio de venta (MXN)" error={errors.priceCents}>
            <input inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} />
          </Field>
          <Field label="Existencia mínima" error={errors.minStock}>
            <input inputMode="numeric" value={form.minStock} onChange={(e) => set({ minStock: e.target.value })} />
          </Field>
        </div>
        {preview.sensitive && (
          <Alert tone="warn">
            Cambiar precio o costo se audita (valor anterior y nuevo) y pedirá tu contraseña al guardar.
          </Alert>
        )}
        <p className="muted small">
          La existencia no se edita aquí: usa entradas, salidas, ajustes o conteos. {v.archived && <Badge tone="muted">Variante archivada</Badge>}
        </p>
      </form>
    </Modal>
  );
}
