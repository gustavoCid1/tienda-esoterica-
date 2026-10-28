# Roles y permisos

> Revisión: 22/10/2026. La matriz de abajo se **generó leyendo `packages/shared/src/permissions.ts`** (`ROLE_PERMISSIONS`), no se escribió de memoria. Si cambias ese archivo, actualiza este documento (ver [MANTENIMIENTO.md](MANTENIMIENTO.md)).

## 1. Principios

1. **La fuente única es `permissions.ts`.** La API la usa para **autorizar**; las apps solo para **mostrar u ocultar** opciones. Ocultar un botón nunca es suficiente: la API vuelve a comprobar.
2. **El rol se lee de la base de datos en cada petición** (no del token). Cambiar el rol de alguien o desactivarlo surte efecto de inmediato.
3. **No hay contraseña universal** de administrador o desarrollador.
4. El rol **desarrollador** es solo técnico: **ningún permiso financiero**.
5. El **vendedor** vende, pero no ve acumulados, gráficas, cortes ni informes.
6. El **gerente** puede todo lo operativo y financiero.
7. La app de escritorio solo admite **gerente** y **vendedor** (`DESKTOP_ROLES`); el desarrollador no entra al punto de venta.

## 2. Matriz rol × permiso

"Sí" = el rol tiene el permiso. "—" = no lo tiene.

| Permiso | Gerente | Vendedor | Desarrollador | Qué permite |
|---|---|---|---|---|
| `productos.ver` | Sí | Sí | — | Ver el catálogo |
| `productos.editar` | Sí | — | — | Crear, editar, archivar y restaurar productos y variantes |
| `precios.editar` | Sí | — | — | Cambiar precios y costos (además exige reautenticación en la API) |
| `inventario.ver` | Sí | Sí | — | Consultar existencias |
| `inventario.mover` | Sí | — | — | Entradas, salidas, ajustes y conteos físicos |
| `inventario.entrada_temporal` | — | — | — | Etiqueta para "entrada con permiso temporal vigente" (ver nota 1) |
| `transferencias.crear` | Sí | — | — | Transferir mercancía entre sucursales |
| `ventas.crear` | Sí | Sí | — | Registrar ventas |
| `ventas.descuento` | Sí | — | — | Aplicar descuentos |
| `ventas.ver_propias` | Sí | Sí | — | Ver sus propias ventas (sin acumulados financieros) |
| `ventas.ver_todas` | Sí | — | — | Ver las ventas de todos |
| `ventas.cancelar` | Sí | — | — | Cancelar una venta (con motivo; reautenticación en la API) |
| `ventas.devolver` | Sí | — | — | Registrar devoluciones (con motivo; reautenticación en la API) |
| `tickets.imprimir_propios` | Sí | Sí | — | Imprimir/reimprimir los tickets de sus propias ventas |
| `tickets.archivo` | Sí | — | — | Archivo de tickets completo |
| `caja.abrir` | Sí | — | — | Abrir la caja |
| `caja.movimientos` | Sí | — | — | Entradas, retiros y gastos de efectivo |
| `caja.corte` | Sí | — | — | Corte de caja e historial de cortes |
| `estadisticas.ver` | Sí | — | — | Dashboard, "Resumen de ventas de hoy", informes |
| `usuarios.gestionar` | Sí | — | — | Crear y editar usuarios |
| `sucursales.gestionar` | Sí | — | — | Sucursales, ubicaciones y terminales |
| `permisos_temporales.gestionar` | Sí | — | — | Conceder y revocar permisos temporales |
| `sync.conflictos` | Sí | — | — | Ver y resolver conflictos; recalcular existencias |
| `respaldos.ver` | Sí | — | Sí | Ver el registro de respaldos |
| `auditoria.ver` | Sí | — | — | Ver el historial de auditoría |
| `config.editar` | Sí | — | — | Cambiar configuraciones permitidas |
| `sistema.diagnostico` | — | — | Sí | Diagnóstico técnico (versión, conexión a la base, latencia). **Sin datos financieros** |
| `sync.estado` | Sí | — | Sí | Estado de sincronización (terminales, pendientes) |

Totales: gerente 26 permisos, vendedor 5, desarrollador 3.

### Notas

1. **`inventario.entrada_temporal` no pertenece a ningún rol.** Existe como etiqueta que la API usa en `POST /inventory/movements` ("`inventario.mover`, o `inventario.entrada_temporal` con permiso vigente"). En la práctica, la regla real es la función `canRegisterEntry` + permiso temporal (sección 3), no que el rol tenga esa etiqueta.
2. **El gerente no tiene `sistema.diagnostico`** (es solo técnico) y el **desarrollador no tiene `config.editar`, `estadisticas.ver`, `ventas.*` ni `caja.*`**.
3. El vendedor **sí puede ver el importe de la venta actual** para cobrar, pero no totales acumulados: esa pantalla es `estadisticas.ver`.
4. El desarrollador puede ver el **registro** de respaldos (`respaldos.ver`) y el estado de sincronización, pero no ventas ni importes.

## 3. Permiso temporal para ingresar mercancía

El vendedor no puede dar entradas de inventario por defecto. El gerente puede concederle un permiso temporal.

| Característica | Valor (según código) |
|---|---|
| Función concedible | Solo `inventario.entrada` (`GRANTABLE_FUNCTIONS`). **Nunca** cortes de caja, roles ni otras funciones administrativas |
| Quién lo concede | Quien tiene `permisos_temporales.gestionar` (gerente) |
| Datos | Vendedor, sucursal, función, hora de inicio, duración, estado |
| Duración | De **5 minutos a 24 horas** (`grantCreateSchema`) |
| Vigencia | `inicio ≤ ahora < expiración`, misma sucursal, función incluida y no revocado |
| Revocación | Antes de que expire, por el gerente |
| Qué registra cada entrada | Vendedor (`user_id`), gerente que autorizó (`authorized_by`), permiso (`grant_id`) |
| Sin conexión | El teléfono usa la copia descargada y la hora del teléfono |

### Reglas más estrictas en el teléfono (`apps/mobile/src/lib/entry-guard.ts`)

Sin conexión, ante la duda **se bloquea**. La entrada con permiso temporal se niega si:

- el teléfono **nunca ha sincronizado** (no hay referencia de hora del servidor);
- la hora del teléfono está **atrasada** respecto a la última hora del servidor (o a la última que la app vio) — evita "alargar" un permiso retrasando el reloj;
- los permisos se descargaron hace **más de 24 horas** (no se puede comprobar que no hayan sido revocados);
- no hay permiso vigente, o ya venció.

Si los permisos tienen más de 1 hora sin actualizarse se muestra un aviso (aún se permite). El servidor **vuelve a validar** el permiso al sincronizar y **ignora** el `grantId`/`authorizedBy` que mande el dispositivo (los determina él).

La escritura de datos en el almacén local (`registerMovement`) aplica la regla simple (permiso vigente según hora local); la protección adicional contra reloj atrasado y permisos viejos vive en la pantalla del teléfono.

## 4. Reautenticación

Acciones que, además del permiso, exigen la contraseña de nuevo (token `x-reauth` válido 5 minutos): cancelar y devolver ventas, cerrar caja, cambiar precios, crear usuarios o cambiar rol/contraseña (ver [API.md](API.md)).

## 5. Qué ve cada rol (resumen para la dueña)

| Quiero que… | Rol |
|---|---|
| Venda en el mostrador | Vendedor |
| Cobre, escanee, imprima tickets | Vendedor |
| Abra la caja y haga el corte | **Solo gerente** |
| Cancele ventas, haga devoluciones, aplique descuentos | **Solo gerente** |
| Cambie precios o dé de alta productos | **Solo gerente** |
| Vea cuánto se vendió hoy en el celular | **Solo gerente** |
| Revise problemas técnicos sin ver dinero | Desarrollador |
| Dé entradas de mercancía por un rato | Vendedor con **permiso temporal** del gerente |

## 6. Cómo comprobar que la matriz se cumple

Hay pruebas escritas (todas **sin ejecutar** aún):

- `packages/shared/test/cash-reports.test.ts` → "permisos por rol: vendedor sin finanzas, desarrollador sin finanzas" y "permiso temporal: vigencia, sucursal, función y revocación".
- `packages/database/test/local-store.test.ts` → "permisos: vendedor no cancela ni da descuentos; desarrollador no vende" y "permiso temporal…".
- `apps/mobile/test/lib-misc.test.ts` → casos de `entry-guard`.
- Pruebas de endpoints de la API (escenario 10 y 22): **todavía no existen**; procedimiento manual en [PRUEBAS.md](PRUEBAS.md).
