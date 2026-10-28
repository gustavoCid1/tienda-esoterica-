/**
 * Armado y validación de formularios. Convierte lo capturado (texto) en los cuerpos que
 * exige la API y los valida con los MISMOS esquemas Zod de @amara/shared que usa el servidor.
 * Funciones puras (probadas en forms.test.ts).
 *
 * Los errores se devuelven como mapa "ruta" -> mensaje en español, con rutas iguales a las de
 * Zod (por ejemplo "product.name" o "variants.0.costCents") para que la interfaz los ubique.
 */
import type { ZodTypeAny } from 'zod';
import {
  branchSchema,
  grantCreateSchema,
  productCreateSchema,
  productSchema,
  stockMovementSchema,
  terminalSchema,
  transferSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@amara/shared/schemas';
import { parseIntInput, parseMoneyInput } from './format.ts';
import { mxLocalToIso } from './dates.ts';

export type FieldErrors = Record<string, string>;

export interface BuildResult<T = unknown> {
  payload: T | null;
  errors: FieldErrors;
}

interface IssueLike {
  code: string;
  path: (string | number)[];
  message: string;
  [k: string]: unknown;
}

/** Traduce una incidencia de Zod (en inglés por defecto) a un mensaje útil en español. */
export function spanishIssueMessage(issue: IssueLike): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null' ? 'Campo obligatorio' : 'Valor no válido';
    case 'too_small': {
      const min = String(issue.minimum);
      if (issue.type === 'string') return min === '1' ? 'Campo obligatorio' : `Mínimo ${min} caracteres`;
      if (issue.type === 'array') return `Agrega al menos ${min}`;
      return `Debe ser al menos ${min}`;
    }
    case 'too_big': {
      const max = String(issue.maximum);
      if (issue.type === 'string') return `Máximo ${max} caracteres`;
      if (issue.type === 'array') return `Máximo ${max} elementos`;
      return `No puede ser mayor a ${max}`;
    }
    case 'invalid_string':
      if (issue.validation === 'uuid') return 'Selecciona una opción';
      if (issue.validation === 'datetime') return 'Fecha y hora no válidas';
      // El mensaje por defecto de Zod para regex es "Invalid"; si no, es el que definió el esquema.
      return issue.message && issue.message !== 'Invalid' ? issue.message : 'Formato no válido';
    case 'invalid_enum_value':
      return 'Opción no válida';
    default:
      return 'Valor no válido';
  }
}

/** Mapa ruta -> mensaje (solo el primer error de cada ruta). */
export function issuesToErrors(issues: IssueLike[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const key = i.path.join('.') || '_';
    if (!(key in out)) out[key] = spanishIssueMessage(i);
  }
  return out;
}

/** Ejecuta un esquema sobre el cuerpo armado y junta sus errores con los previos. */
export function runSchema<S extends ZodTypeAny>(schema: S, raw: unknown, pre: FieldErrors = {}): BuildResult<S['_output']> {
  const r = schema.safeParse(raw);
  const errors: FieldErrors = { ...(r.success ? {} : issuesToErrors(r.error.issues as IssueLike[])), ...pre };
  if (r.success && Object.keys(errors).length === 0) return { payload: r.data, errors };
  return { payload: null, errors };
}

const opt = (s: string): string | undefined => {
  const t = s.trim();
  return t ? t : undefined;
};

/* ------------------------------------------------------------------ Producto */

export interface SpecRow {
  key: string;
  value: string;
}
export interface VariantStockForm {
  branchId: string;
  qty: string;
  location: string;
}
export interface VariantForm {
  label: string;
  unit: string;
  barcode: string;
  cost: string;
  price: string;
  minStock: string;
  location: string;
  stock: VariantStockForm[];
}
export interface ProductForm {
  name: string;
  type: string;
  category: string;
  sku: string;
  brand: string;
  description: string;
  notes: string;
  photo: string;
  specs: SpecRow[];
  variants: VariantForm[];
}

export function emptyVariantForm(defaultBranchId = ''): VariantForm {
  return {
    label: '',
    unit: 'pieza',
    barcode: '',
    cost: '',
    price: '',
    minStock: '0',
    location: '',
    stock: [{ branchId: defaultBranchId, qty: '0', location: '' }],
  };
}

export function emptyProductForm(defaultBranchId = ''): ProductForm {
  return {
    name: '',
    type: '',
    category: '',
    sku: '',
    brand: '',
    description: '',
    notes: '',
    photo: '',
    specs: [],
    variants: [emptyVariantForm(defaultBranchId)],
  };
}

/** Especificaciones clave-valor -> objeto; detecta claves repetidas y valores sin clave. */
export function buildSpecs(rows: SpecRow[]): { specs: Record<string, string>; error?: string } {
  const specs: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    const v = r.value.trim();
    if (!k && !v) continue;
    if (!k) return { specs, error: 'Hay una especificación con valor pero sin nombre' };
    if (Object.prototype.hasOwnProperty.call(specs, k)) return { specs, error: `La especificación "${k}" está repetida` };
    specs[k] = v;
  }
  return { specs };
}

export function buildProductPayload(form: ProductForm): BuildResult {
  const pre: FieldErrors = {};
  const { specs, error: specError } = buildSpecs(form.specs);
  if (specError) pre['product.specs'] = specError;

  const variants = form.variants.map((v, i) => {
    const cost = parseMoneyInput(v.cost);
    const price = parseMoneyInput(v.price);
    const min = parseIntInput(v.minStock === '' ? '0' : v.minStock);
    if (cost === null) pre[`variants.${i}.costCents`] = 'Importe no válido (ejemplo: 125.50)';
    if (price === null) pre[`variants.${i}.priceCents`] = 'Importe no válido (ejemplo: 250.00)';
    if (min === null || min < 0) pre[`variants.${i}.minStock`] = 'Debe ser un entero de 0 o más';
    return {
      label: v.label,
      unit: v.unit || 'pieza',
      barcode: opt(v.barcode),
      costCents: cost ?? 0,
      priceCents: price ?? 0,
      minStock: min !== null && min >= 0 ? min : 0,
      location: opt(v.location),
    };
  });

  // Códigos de barras repetidos entre variantes del mismo producto.
  const seenCodes = new Map<string, number>();
  form.variants.forEach((v, i) => {
    const code = v.barcode.trim().toUpperCase();
    if (!code) return;
    if (seenCodes.has(code)) pre[`variants.${i}.barcode`] = 'Código repetido en otra variante de este producto';
    else seenCodes.set(code, i);
  });

  // Existencia inicial plana (como la espera la API) con mapa para ubicar errores en el formulario.
  const initialStock: { variantIndex: number; branchId: string; qty: number; location?: string }[] = [];
  const stockMap: { vi: number; si: number }[] = [];
  form.variants.forEach((v, vi) => {
    v.stock.forEach((s, si) => {
      const hasData = s.branchId || (s.qty.trim() !== '' && s.qty.trim() !== '0') || s.location.trim();
      if (!hasData) return;
      const qty = parseIntInput(s.qty === '' ? '0' : s.qty);
      if (qty === null || qty < 0) pre[`variants.${vi}.stock.${si}.qty`] = 'Debe ser un entero de 0 o más';
      initialStock.push({ variantIndex: vi, branchId: s.branchId, qty: qty !== null && qty >= 0 ? qty : 0, location: opt(s.location) });
      stockMap.push({ vi, si });
    });
  });

  const raw = {
    product: {
      name: form.name,
      type: form.type,
      category: form.category,
      sku: form.sku,
      brand: opt(form.brand),
      description: opt(form.description),
      notes: opt(form.notes),
      photo: opt(form.photo),
      specs,
    },
    variants,
    initialStock,
  };

  const res = runSchema(productCreateSchema, raw, pre);
  // Reubica errores "initialStock.k.campo" en "variants.i.stock.j.campo".
  const errors: FieldErrors = {};
  for (const [k, msg] of Object.entries(res.errors)) {
    const m = /^initialStock\.(\d+)\.(.+)$/.exec(k);
    if (m) {
      const map = stockMap[Number(m[1])];
      errors[map ? `variants.${map.vi}.stock.${map.si}.${m[2]}` : k] = msg;
    } else errors[k] = msg;
  }
  return { payload: res.payload, errors };
}

/**
 * Edición de datos del producto (PATCH). A diferencia del alta, los textos vacíos se envían
 * como "" para que el servidor pueda borrar marca, descripción, notas o foto.
 */
export function buildProductEditPayload(form: ProductForm): BuildResult {
  const pre: FieldErrors = {};
  const { specs, error } = buildSpecs(form.specs);
  if (error) pre.specs = error;
  return runSchema(
    productSchema,
    {
      name: form.name,
      type: form.type,
      category: form.category,
      sku: form.sku,
      brand: form.brand,
      description: form.description,
      notes: form.notes,
      photo: form.photo,
      specs,
    },
    pre,
  );
}

export interface VariantEditForm {
  label: string;
  unit: string;
  barcode: string;
  cost: string;
  price: string;
  minStock: string;
  location: string;
}

/**
 * Edición de una variante. Devuelve solo los campos que cambiaron respecto de `original` y si
 * el cambio toca precios o costos (acción sensible que exige reautenticación).
 */
export function buildVariantEditPayload(
  form: VariantEditForm,
  original: { label: string; unit: string; barcode?: string | null; costCents: number; priceCents: number; minStock: number; location?: string | null },
): { payload: Record<string, unknown> | null; errors: FieldErrors; sensitive: boolean; changed: boolean } {
  const errors: FieldErrors = {};
  const out: Record<string, unknown> = {};
  let sensitive = false;
  const label = form.label.trim();
  if (!label) errors.label = 'Campo obligatorio';
  else if (label.length > 60) errors.label = 'Máximo 60 caracteres';
  else if (label !== original.label) out.label = label;
  const unit = form.unit.trim();
  if (!unit) errors.unit = 'Campo obligatorio';
  else if (unit.length > 20) errors.unit = 'Máximo 20 caracteres';
  else if (unit !== original.unit) out.unit = unit;
  const barcode = form.barcode.trim();
  if (barcode.length > 40) errors.barcode = 'Máximo 40 caracteres';
  else if (barcode !== (original.barcode ?? '')) out.barcode = barcode;
  const location = form.location.trim();
  if (location.length > 60) errors.location = 'Máximo 60 caracteres';
  else if (location !== (original.location ?? '')) out.location = location;
  const min = parseIntInput(form.minStock === '' ? '0' : form.minStock);
  if (min === null || min < 0) errors.minStock = 'Debe ser un entero de 0 o más';
  else if (min !== original.minStock) out.minStock = min;
  const cost = parseMoneyInput(form.cost);
  if (cost === null) errors.costCents = 'Importe no válido';
  else if (cost !== original.costCents) {
    out.costCents = cost;
    sensitive = true;
  }
  const price = parseMoneyInput(form.price);
  if (price === null) errors.priceCents = 'Importe no válido';
  else if (price !== original.priceCents) {
    out.priceCents = price;
    sensitive = true;
  }
  const changed = Object.keys(out).length > 0;
  return { payload: Object.keys(errors).length ? null : out, errors, sensitive, changed };
}

/** Texto de la primera incidencia, útil para el aviso general del formulario. */
export function firstError(errors: FieldErrors): string | null {
  const k = Object.keys(errors)[0];
  return k ? errors[k]! : null;
}

/* ---------------------------------------------------------------- Movimientos */

export type MovementKind = 'entrada' | 'salida' | 'ajuste' | 'conteo';

export interface MovementForm {
  type: MovementKind;
  variantId: string;
  branchId: string;
  qty: string;
  reason: string;
  location: string;
}

export const MOVEMENT_HELP: Record<MovementKind, string> = {
  entrada: 'Suma piezas a la existencia (compra, reposición). Cantidad positiva.',
  salida: 'Resta piezas que salen sin ser venta (merma, muestra, consumo). Cantidad positiva.',
  ajuste: 'Corrige la existencia con signo: positivo suma, negativo resta. Exige un motivo.',
  conteo: 'Registra la cantidad contada físicamente; el sistema calcula la diferencia contra la existencia.',
};

/** `currentQty` (opcional) permite avisar de salidas mayores a la existencia antes de enviar. */
export function buildMovementPayload(form: MovementForm, id: string, currentQty?: number): BuildResult {
  const pre: FieldErrors = {};
  const qty = parseIntInput(form.qty);
  if (qty === null) pre.qty = 'Escribe un número entero';
  else if ((form.type === 'entrada' || form.type === 'salida') && qty <= 0) pre.qty = 'Debe ser mayor a 0';
  else if (form.type === 'ajuste' && qty === 0) pre.qty = 'El ajuste no puede ser 0';
  else if (form.type === 'conteo' && qty < 0) pre.qty = 'La cantidad contada no puede ser negativa';
  else if (form.type === 'salida' && currentQty !== undefined && qty > currentQty) {
    pre.qty = `La salida (${qty}) excede la existencia (${currentQty})`;
  }
  const raw = {
    id,
    variantId: form.variantId,
    branchId: form.branchId,
    type: form.type,
    qty: qty ?? 0,
    reason: form.reason,
    location: opt(form.location),
  };
  return runSchema(stockMovementSchema, raw, pre);
}

/* -------------------------------------------------------------- Transferencias */

export interface TransferLineForm {
  variantId: string;
  qty: string;
  /** Existencia en la sucursal de origen (para validar). */
  available: number;
}
export interface TransferForm {
  fromBranchId: string;
  toBranchId: string;
  items: TransferLineForm[];
  note: string;
}

export function buildTransferPayload(form: TransferForm, id: string): BuildResult {
  const pre: FieldErrors = {};
  if (form.fromBranchId && form.fromBranchId === form.toBranchId) pre.toBranchId = 'El destino debe ser distinto al origen';
  const seen = new Set<string>();
  const items = form.items.map((l, i) => {
    const qty = parseIntInput(l.qty);
    if (qty === null || qty <= 0) pre[`items.${i}.qty`] = 'Debe ser un entero mayor a 0';
    else if (qty > l.available) pre[`items.${i}.qty`] = `Solo hay ${l.available} en el origen`;
    if (seen.has(l.variantId)) pre[`items.${i}.variantId`] = 'Producto repetido';
    seen.add(l.variantId);
    return { variantId: l.variantId, qty: qty ?? 0 };
  });
  return runSchema(
    transferSchema,
    { id, fromBranchId: form.fromBranchId, toBranchId: form.toBranchId, items, note: opt(form.note) },
    pre,
  );
}

/* --------------------------------------------------------- Permisos temporales */

export interface GrantForm {
  sellerId: string;
  branchId: string;
  functions: string[];
  /** Valor de <input type="datetime-local"> en hora de México. */
  startsLocal: string;
  durationMinutes: string;
}

export function buildGrantPayload(form: GrantForm): BuildResult {
  const pre: FieldErrors = {};
  const startsAt = mxLocalToIso(form.startsLocal);
  if (!startsAt) pre.startsAt = 'Elige fecha y hora de inicio';
  const dur = parseIntInput(form.durationMinutes);
  if (dur === null) pre.durationMinutes = 'Escribe la duración en minutos';
  return runSchema(
    grantCreateSchema,
    { sellerId: form.sellerId, branchId: form.branchId, functions: form.functions, startsAt: startsAt ?? '', durationMinutes: dur ?? 0 },
    pre,
  );
}

/* ----------------------------------------------------- Usuarios, sucursales... */

export interface UserForm {
  username: string;
  name: string;
  role: 'gerente' | 'vendedor' | 'desarrollador';
  password: string;
  password2: string;
  branchIds: string[];
  active: boolean;
}

export function buildUserCreatePayload(form: UserForm): BuildResult {
  const pre: FieldErrors = {};
  if (form.password !== form.password2) pre.password2 = 'Las contraseñas no coinciden';
  return runSchema(
    userCreateSchema,
    { username: form.username, name: form.name, role: form.role, password: form.password, branchIds: form.branchIds },
    pre,
  );
}

/** Solo envía lo que cambió respecto del usuario original. `sensitive` indica si exige reautenticación. */
export function buildUserUpdatePayload(
  form: UserForm,
  original: { name: string; role: string; branchIds: string[]; active: boolean },
): BuildResult<Record<string, unknown>> & { sensitive: boolean; changed: boolean } {
  const pre: FieldErrors = {};
  const raw: Record<string, unknown> = {};
  let sensitive = false;
  if (form.name.trim() !== original.name) raw.name = form.name;
  if (form.role !== original.role) {
    raw.role = form.role;
    sensitive = true;
  }
  if (form.password) {
    if (form.password !== form.password2) pre.password2 = 'Las contraseñas no coinciden';
    raw.password = form.password;
    sensitive = true;
  }
  const a = [...form.branchIds].sort().join(',');
  const b = [...original.branchIds].sort().join(',');
  if (a !== b) raw.branchIds = form.branchIds;
  if (form.active !== original.active) raw.active = form.active;
  const res = runSchema(userUpdateSchema, raw, pre);
  return { ...res, payload: res.payload as Record<string, unknown> | null, sensitive, changed: Object.keys(raw).length > 0 };
}

export interface BranchForm {
  code: string;
  name: string;
  address: string;
  locations: string[];
}

export function buildBranchPayload(form: BranchForm): BuildResult {
  return runSchema(branchSchema, {
    code: form.code.trim().toUpperCase(),
    name: form.name,
    address: opt(form.address),
    locations: form.locations.map((l) => l.trim()).filter(Boolean),
  });
}

export interface TerminalForm {
  code: string;
  name: string;
  branchId: string;
  kind: 'escritorio' | 'movil';
}

export function buildTerminalPayload(form: TerminalForm): BuildResult {
  return runSchema(terminalSchema, {
    code: form.code.trim().toUpperCase(),
    name: form.name,
    branchId: form.branchId,
    kind: form.kind,
  });
}
