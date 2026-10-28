import { describe, expect, it } from 'vitest';
import {
  buildBranchPayload, buildGrantPayload, buildMovementPayload, buildProductEditPayload, buildProductPayload, buildSpecs,
  buildTransferPayload, buildVariantEditPayload, buildUserCreatePayload, buildUserUpdatePayload, emptyProductForm, issuesToErrors,
  type ProductForm, type UserForm,
} from './forms.ts';

const BRANCH = '123e4567-e89b-42d3-a456-426614174000';
const BRANCH2 = '123e4567-e89b-42d3-a456-426614174001';
const VARIANT = '123e4567-e89b-42d3-a456-426614174002';
const OP = '123e4567-e89b-42d3-a456-426614174003';

function validProduct(): ProductForm {
  const f = emptyProductForm(BRANCH);
  f.name = 'Vela aromática';
  f.type = 'Vela';
  f.category = 'Velas';
  f.sku = 'VEL-001';
  f.variants[0] = {
    label: 'Chica', unit: 'pieza', barcode: '', cost: '25.50', price: '60', minStock: '2', location: '',
    stock: [{ branchId: BRANCH, qty: '10', location: 'Estante A' }],
  };
  return f;
}

describe('formulario de producto', () => {
  it('arma el cuerpo con importes en centavos y existencia inicial', () => {
    const r = buildProductPayload(validProduct());
    expect(r.errors).toEqual({});
    const p = r.payload as any;
    expect(p.variants[0].costCents).toBe(2550);
    expect(p.variants[0].priceCents).toBe(6000);
    expect(p.variants[0].minStock).toBe(2);
    expect(p.initialStock[0]).toMatchObject({ variantIndex: 0, branchId: BRANCH, qty: 10, location: 'Estante A' });
  });
  it('reporta nombre vacío y costo inválido con rutas de Zod', () => {
    const f = validProduct();
    f.name = '';
    f.variants[0]!.cost = 'abc';
    const r = buildProductPayload(f);
    expect(r.payload).toBeNull();
    expect(r.errors['product.name']).toBeDefined();
    expect(r.errors['variants.0.costCents']).toContain('Importe');
  });
  it('ubica el error de existencia inicial dentro de la variante', () => {
    const f = validProduct();
    f.variants[0]!.stock[0]!.qty = '-4';
    const r = buildProductPayload(f);
    expect(r.errors['variants.0.stock.0.qty']).toBeDefined();
  });
  it('detecta especificaciones repetidas o sin nombre', () => {
    expect(buildSpecs([{ key: 'Color', value: 'Rojo' }, { key: 'Color', value: 'Azul' }]).error).toContain('repetida');
    expect(buildSpecs([{ key: '', value: 'x' }]).error).toContain('sin nombre');
    expect(buildSpecs([{ key: ' Peso ', value: '100 g' }, { key: '', value: '' }]).specs).toEqual({ Peso: '100 g' });
  });
});

describe('movimientos', () => {
  const base = { type: 'entrada' as const, variantId: VARIANT, branchId: BRANCH, qty: '5', reason: 'Compra', location: '' };
  it('acepta una entrada válida', () => {
    const r = buildMovementPayload(base, OP);
    expect(r.errors).toEqual({});
    expect((r.payload as any).qty).toBe(5);
  });
  it('rechaza salidas mayores a la existencia, ajustes en 0 y motivos cortos', () => {
    expect(buildMovementPayload({ ...base, type: 'salida', qty: '9' }, OP, 4).errors.qty).toContain('excede');
    expect(buildMovementPayload({ ...base, type: 'ajuste', qty: '0' }, OP).errors.qty).toBeDefined();
    expect(buildMovementPayload({ ...base, reason: 'ab' }, OP).errors.reason).toBeDefined();
  });
  it('permite ajustes negativos y conteo en 0', () => {
    expect(buildMovementPayload({ ...base, type: 'ajuste', qty: '-2' }, OP).errors).toEqual({});
    expect(buildMovementPayload({ ...base, type: 'conteo', qty: '0' }, OP).errors).toEqual({});
  });
});

describe('transferencias', () => {
  it('exige origen distinto del destino y cantidades dentro de la existencia', () => {
    const r1 = buildTransferPayload({ fromBranchId: BRANCH, toBranchId: BRANCH, items: [{ variantId: VARIANT, qty: '1', available: 5 }], note: '' }, OP);
    expect(r1.errors.toBranchId).toBeDefined();
    const r2 = buildTransferPayload({ fromBranchId: BRANCH, toBranchId: BRANCH2, items: [{ variantId: VARIANT, qty: '9', available: 5 }], note: '' }, OP);
    expect(r2.errors['items.0.qty']).toContain('Solo hay 5');
    const r3 = buildTransferPayload({ fromBranchId: BRANCH, toBranchId: BRANCH2, items: [{ variantId: VARIANT, qty: '3', available: 5 }], note: '' }, OP);
    expect(r3.errors).toEqual({});
  });
});

describe('permisos temporales', () => {
  it('convierte el inicio de hora de México a UTC', () => {
    const r = buildGrantPayload({
      sellerId: VARIANT, branchId: BRANCH, functions: ['inventario.entrada'], startsLocal: '2026-10-22T14:30', durationMinutes: '60',
    });
    expect(r.errors).toEqual({});
    expect((r.payload as any).startsAt).toBe('2026-10-22T20:30:00.000Z');
  });
  it('rechaza duraciones fuera de rango y fechas vacías', () => {
    const r = buildGrantPayload({ sellerId: VARIANT, branchId: BRANCH, functions: ['inventario.entrada'], startsLocal: '', durationMinutes: '2' });
    expect(r.errors.startsAt).toBeDefined();
    expect(r.errors.durationMinutes).toBeDefined();
  });
});

describe('usuarios y sucursales', () => {
  const user: UserForm = {
    username: 'maria', name: 'María López', role: 'vendedor', password: 'clave-larga-1', password2: 'clave-larga-1', branchIds: [BRANCH], active: true,
  };
  it('valida alta de usuario y confirmación de contraseña', () => {
    expect(buildUserCreatePayload(user).errors).toEqual({});
    expect(buildUserCreatePayload({ ...user, password2: 'otra' }).errors.password2).toBeDefined();
    expect(buildUserCreatePayload({ ...user, password: 'corta', password2: 'corta' }).errors.password).toBeDefined();
  });
  it('en edición solo envía cambios y marca los sensibles', () => {
    const orig = { name: 'María López', role: 'vendedor', branchIds: [BRANCH], active: true };
    const same = buildUserUpdatePayload({ ...user, password: '', password2: '' }, orig);
    expect(same.changed).toBe(false);
    const role = buildUserUpdatePayload({ ...user, role: 'gerente', password: '', password2: '' }, orig);
    expect(role.sensitive).toBe(true);
    expect(role.payload).toEqual({ role: 'gerente' });
  });
  it('sucursal: código en mayúsculas y ubicaciones sin vacíos', () => {
    const r = buildBranchPayload({ code: 'mx1', name: 'Centro', address: '', locations: [' Vitrina ', ''] });
    expect(r.errors).toEqual({});
    expect((r.payload as any).code).toBe('MX1');
    expect((r.payload as any).locations).toEqual(['Vitrina']);
  });
});

describe('issuesToErrors', () => {
  it('traduce códigos de Zod', () => {
    const e = issuesToErrors([
      { code: 'too_small', path: ['product', 'name'], message: 'x', type: 'string', minimum: 2 },
      { code: 'invalid_type', path: ['sku'], message: 'Required', received: 'undefined' },
    ]);
    expect(e['product.name']).toBe('Mínimo 2 caracteres');
    expect(e.sku).toBe('Campo obligatorio');
  });
});

describe('edición de producto y variante', () => {
  it('detecta códigos de barras repetidos dentro del mismo producto', () => {
    const f = validProduct();
    f.variants[0]!.barcode = 'ABC-1';
    f.variants.push({ ...f.variants[0]!, label: 'Grande', barcode: 'abc-1' });
    const r = buildProductPayload(f);
    expect(r.errors['variants.1.barcode']).toContain('repetido');
  });
  it('la edición de producto conserva cadenas vacías para poder borrar campos', () => {
    const f = validProduct();
    f.brand = '';
    const r = buildProductEditPayload(f);
    expect(r.errors).toEqual({});
    expect((r.payload as any).brand).toBe('');
  });
  it('la variante solo envía lo que cambió y marca precios como sensibles', () => {
    const orig = { label: 'Chica', unit: 'pieza', barcode: null, costCents: 2550, priceCents: 6000, minStock: 2, location: null };
    const form = { label: 'Chica', unit: 'pieza', barcode: '', cost: '25.50', price: '60.00', minStock: '2', location: '' };
    expect(buildVariantEditPayload(form, orig).changed).toBe(false);
    const a = buildVariantEditPayload({ ...form, minStock: '5' }, orig);
    expect(a.payload).toEqual({ minStock: 5 });
    expect(a.sensitive).toBe(false);
    const b = buildVariantEditPayload({ ...form, price: '75' }, orig);
    expect(b.payload).toEqual({ priceCents: 7500 });
    expect(b.sensitive).toBe(true);
    expect(buildVariantEditPayload({ ...form, cost: 'x' }, orig).errors.costCents).toBeDefined();
  });
});
