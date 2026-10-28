/** Descripciones en español de cada permiso (para la matriz de permisos por rol). */
import { ROLE_PERMISSIONS, type Permission, type Role } from '@amara/shared';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'productos.ver': 'Ver catálogo de productos',
  'productos.editar': 'Crear y editar productos y variantes',
  'precios.editar': 'Cambiar precios y costos (con confirmación de contraseña)',
  'inventario.ver': 'Ver inventario',
  'inventario.mover': 'Entradas, salidas, ajustes y conteos',
  'inventario.entrada_temporal': 'Registrar entradas con permiso temporal vigente',
  'transferencias.crear': 'Transferir entre sucursales',
  'ventas.crear': 'Vender',
  'ventas.descuento': 'Aplicar descuentos',
  'ventas.ver_propias': 'Ver sus propias ventas',
  'ventas.ver_todas': 'Ver todas las ventas',
  'ventas.cancelar': 'Cancelar ventas (con contraseña)',
  'ventas.devolver': 'Registrar devoluciones (con contraseña)',
  'tickets.imprimir_propios': 'Imprimir sus tickets',
  'tickets.archivo': 'Archivo de tickets',
  'caja.abrir': 'Abrir caja',
  'caja.movimientos': 'Movimientos de caja',
  'caja.corte': 'Cortes de caja',
  'estadisticas.ver': 'Estadísticas, informes y gráficas',
  'usuarios.gestionar': 'Gestionar usuarios',
  'sucursales.gestionar': 'Gestionar sucursales y terminales',
  'permisos_temporales.gestionar': 'Otorgar permisos temporales',
  'sync.conflictos': 'Resolver conflictos de sincronización',
  'respaldos.ver': 'Ver respaldos',
  'auditoria.ver': 'Ver auditoría',
  'config.editar': 'Editar configuración',
  'sistema.diagnostico': 'Diagnóstico técnico (sin datos financieros)',
  'sync.estado': 'Ver estado de sincronización',
};

export const ROLE_NAME: Record<Role, string> = { gerente: 'Gerente', vendedor: 'Vendedor', desarrollador: 'Desarrollador' };

/** Todos los permisos conocidos, ordenados como están definidos arriba. */
export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABEL) as Permission[];

export function roleHas(role: Role, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}
