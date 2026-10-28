/**
 * Tabla de rutas y menú. Cada ruta declara el permiso que la muestra; ocultar una opción es solo
 * comodidad: el servidor autoriza SIEMPRE cada petición (un 403 se muestra como aviso).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Permission } from '@amara/shared';

export interface RouteDef {
  path: string;
  label: string;
  group: string;
  /** null = cualquier usuario con sesión. */
  perm: Permission | null;
  component: LazyExoticComponent<ComponentType>;
  /** Contador que se dibuja junto a la opción del menú (v2). */
  badge?: 'notificaciones';
}

export const ROUTES: RouteDef[] = [
  { path: '/', label: 'Resumen', group: 'Resumen', perm: 'estadisticas.ver', component: lazy(() => import('./pages/Dashboard.tsx').then((m) => ({ default: m.Dashboard }))) },
  { path: '/notificaciones', label: 'Notificaciones', group: 'Resumen', perm: 'estadisticas.ver', badge: 'notificaciones', component: lazy(() => import('./pages/Notifications.tsx').then((m) => ({ default: m.NotificationsPage }))) },
  { path: '/inventario', label: 'Inventario', group: 'Inventario', perm: 'inventario.ver', component: lazy(() => import('./pages/Inventory.tsx').then((m) => ({ default: m.Inventory }))) },
  { path: '/catalogo', label: 'Catálogo y variantes', group: 'Inventario', perm: 'productos.ver', component: lazy(() => import('./pages/Catalog.tsx').then((m) => ({ default: m.Catalog }))) },
  { path: '/movimientos', label: 'Entradas, salidas y conteos', group: 'Inventario', perm: 'inventario.mover', component: lazy(() => import('./pages/Movements.tsx').then((m) => ({ default: m.Movements }))) },
  { path: '/transferencias', label: 'Transferencias', group: 'Inventario', perm: 'transferencias.crear', component: lazy(() => import('./pages/Transfers.tsx').then((m) => ({ default: m.Transfers }))) },
  { path: '/etiquetas', label: 'Etiquetas', group: 'Inventario', perm: 'productos.ver', component: lazy(() => import('./pages/Labels.tsx').then((m) => ({ default: m.Labels }))) },
  { path: '/ventas', label: 'Ventas y tickets', group: 'Ventas y caja', perm: 'tickets.archivo', component: lazy(() => import('./pages/Sales.tsx').then((m) => ({ default: m.Sales }))) },
  { path: '/limpias', label: 'Historial de Limpias', group: 'Ventas y caja', perm: 'tickets.archivo', component: lazy(() => import('./pages/Sales.tsx').then((m) => ({ default: m.LimpiasHistory }))) },
  { path: '/caja', label: 'Cortes de caja', group: 'Ventas y caja', perm: 'caja.corte', component: lazy(() => import('./pages/CashSessions.tsx').then((m) => ({ default: m.CashSessions }))) },
  { path: '/informes', label: 'Informes', group: 'Ventas y caja', perm: 'estadisticas.ver', component: lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.Reports }))) },
  { path: '/sucursales', label: 'Sucursales y ubicaciones', group: 'Administración', perm: 'sucursales.gestionar', component: lazy(() => import('./pages/Branches.tsx').then((m) => ({ default: m.Branches }))) },
  { path: '/usuarios', label: 'Usuarios y permisos', group: 'Administración', perm: 'usuarios.gestionar', component: lazy(() => import('./pages/Users.tsx').then((m) => ({ default: m.Users }))) },
  { path: '/tokens', label: 'Tokens de seguridad', group: 'Administración', perm: 'config.editar', component: lazy(() => import('./pages/SecurityTokens.tsx').then((m) => ({ default: m.SecurityTokens }))) },
  { path: '/permisos-temporales', label: 'Permisos temporales', group: 'Administración', perm: 'permisos_temporales.gestionar', component: lazy(() => import('./pages/Grants.tsx').then((m) => ({ default: m.Grants }))) },
  { path: '/sincronizacion', label: 'Sincronización', group: 'Sistema', perm: 'sync.estado', component: lazy(() => import('./pages/System.tsx').then((m) => ({ default: m.SyncStatusPage }))) },
  { path: '/conflictos', label: 'Conflictos', group: 'Sistema', perm: 'sync.conflictos', component: lazy(() => import('./pages/Conflicts.tsx').then((m) => ({ default: m.Conflicts }))) },
  { path: '/respaldos', label: 'Respaldos', group: 'Sistema', perm: 'respaldos.ver', component: lazy(() => import('./pages/System.tsx').then((m) => ({ default: m.BackupsPage }))) },
  { path: '/auditoria', label: 'Auditoría', group: 'Sistema', perm: 'auditoria.ver', component: lazy(() => import('./pages/System.tsx').then((m) => ({ default: m.AuditPage }))) },
  { path: '/diagnostico', label: 'Diagnóstico técnico', group: 'Sistema', perm: 'sistema.diagnostico', component: lazy(() => import('./pages/System.tsx').then((m) => ({ default: m.DiagnosticsPage }))) },
  { path: '/configuracion', label: 'Configuración', group: 'Sistema', perm: null, component: lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings }))) },
];

/** Primera ruta a la que el usuario tiene acceso (para redirigir desde "/"). */
export function firstAllowedPath(can: (p: Permission) => boolean): string {
  const r = ROUTES.find((x) => x.perm === null || can(x.perm));
  return r?.path ?? '/configuracion';
}
