/**
 * Roles y permisos. Es la fuente única: la API la usa para AUTORIZAR y los
 * clientes solo para mostrar u ocultar opciones. Nunca basta con ocultar un botón.
 *
 * Reglas del negocio:
 *  - desarrollador: solo diagnóstico técnico; NINGÚN permiso financiero.
 *  - vendedor: opera ventas; no ve acumulados, ni gráficas, ni corte de caja.
 *  - gerente: todo lo operativo y financiero.
 */
import type { Grant, Role } from './types.ts';

export type Permission =
  | 'productos.ver'
  | 'productos.editar'
  | 'precios.editar'
  | 'inventario.ver'
  | 'inventario.mover' // entradas, salidas, ajustes, conteos
  | 'inventario.entrada_temporal' // solo con permiso temporal vigente
  | 'transferencias.crear'
  | 'ventas.crear'
  | 'ventas.descuento'
  | 'ventas.ver_propias'
  | 'ventas.ver_todas'
  | 'ventas.cancelar'
  | 'ventas.devolver'
  | 'tickets.imprimir_propios'
  | 'tickets.archivo'
  | 'caja.abrir'
  | 'caja.movimientos'
  | 'caja.corte'
  | 'estadisticas.ver'
  | 'usuarios.gestionar'
  | 'sucursales.gestionar'
  | 'permisos_temporales.gestionar'
  | 'sync.conflictos'
  | 'respaldos.ver'
  | 'auditoria.ver'
  | 'config.editar'
  | 'sistema.diagnostico'
  | 'sync.estado';

const GERENTE: Permission[] = [
  'productos.ver', 'productos.editar', 'precios.editar',
  'inventario.ver', 'inventario.mover', 'transferencias.crear',
  'ventas.crear', 'ventas.descuento', 'ventas.ver_propias', 'ventas.ver_todas', 'ventas.cancelar', 'ventas.devolver',
  'tickets.imprimir_propios', 'tickets.archivo',
  'caja.abrir', 'caja.movimientos', 'caja.corte',
  'estadisticas.ver', 'usuarios.gestionar', 'sucursales.gestionar', 'permisos_temporales.gestionar',
  'sync.conflictos', 'respaldos.ver', 'auditoria.ver', 'config.editar', 'sync.estado',
];

const VENDEDOR: Permission[] = [
  'productos.ver', 'inventario.ver', 'ventas.crear', 'ventas.ver_propias', 'tickets.imprimir_propios',
];

const DESARROLLADOR: Permission[] = ['sistema.diagnostico', 'sync.estado', 'respaldos.ver'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  gerente: GERENTE,
  vendedor: VENDEDOR,
  desarrollador: DESARROLLADOR,
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Roles que pueden iniciar sesión en el punto de venta de escritorio. */
export const DESKTOP_ROLES: readonly Role[] = ['gerente', 'vendedor'];

/** Funciones que un permiso temporal puede conceder (nunca cortes ni roles). */
export const GRANTABLE_FUNCTIONS = ['inventario.entrada'] as const;

/**
 * ¿Está vigente un permiso temporal para esta función, sucursal y momento?
 * `atIso` es la hora de la operación (en un dispositivo sin conexión, la hora local).
 */
export function isGrantActive(
  grant: Pick<Grant, 'branchId' | 'functions' | 'startsAt' | 'expiresAt' | 'revokedAt'>,
  fn: string,
  branchId: string,
  atIso: string,
): boolean {
  if (grant.revokedAt && grant.revokedAt <= atIso) return false;
  if (grant.branchId !== branchId) return false;
  if (!grant.functions.includes(fn)) return false;
  return grant.startsAt <= atIso && atIso < grant.expiresAt;
}

export function findActiveGrant<G extends Pick<Grant, 'sellerId' | 'branchId' | 'functions' | 'startsAt' | 'expiresAt' | 'revokedAt'>>(
  grants: G[],
  sellerId: string,
  fn: string,
  branchId: string,
  atIso: string,
): G | undefined {
  return grants.find((g) => g.sellerId === sellerId && isGrantActive(g, fn, branchId, atIso));
}

/** Vendedor puede registrar una entrada solo con permiso temporal; gerente siempre. */
export function canRegisterEntry(
  role: Role,
  userId: string,
  branchId: string,
  grants: Grant[],
  atIso: string,
): { allowed: boolean; grant?: Grant } {
  if (can(role, 'inventario.mover')) return { allowed: true };
  if (role !== 'vendedor') return { allowed: false };
  const grant = findActiveGrant(grants, userId, 'inventario.entrada', branchId, atIso);
  return grant ? { allowed: true, grant } : { allowed: false };
}
