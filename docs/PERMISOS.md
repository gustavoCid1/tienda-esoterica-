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
| `ventas.cancelar` | Sí | — | — | Cancelar una venta (con motivo; reautenticación en la API). **v2:** el vendedor puede hacerlo SOLO con autorización (sección 4b) |
| `ventas.devolver` | Sí | — | — | Registrar devoluciones (con motivo; reautenticación en la API). **v2:** el vendedor puede hacerlo SOLO con autorización (sección 4b) |
| `tickets.imprimir_propios` | Sí | Sí | — | Imprimir/reimprimir los tickets de sus propias ventas |
| `tickets.archivo` | Sí | — | — | Archivo de tickets completo |
| `caja.abrir` | Sí | — | — | Abrir la caja |
| `caja.movimientos` | Sí | — | — | Entradas, retiros y gastos de efectivo |
| `caja.corte` | Sí | — | — | Corte de caja e historial de cortes. **v2:** el vendedor puede cerrar la caja SOLO con autorización (sección 4b); el historial de cortes sigue siendo del gerente |
| `estadisticas.ver` | Sí | — | — | Dashboard, "Resumen de ventas de hoy", informes |
| `usuarios.gestionar` | Sí | — | — | Crear y editar usuarios |
| `sucursales.gestionar` | Sí | — | — | Sucursales, ubicaciones y terminales |
| `permisos_temporales.gestionar` | Sí | — | — | Conceder y revocar permisos temporales |
| `sync.conflictos` | Sí | — | — | Ver y resolver conflictos; recalcular existencias |
| `respaldos.ver` | Sí | — | Sí | Ver el registro de respaldos |
| `auditoria.ver` | Sí | — | — | Ver el historial de auditoría |
| `config.editar` | Sí | — | — | Cambiar configuraciones permitidas. **v2:** crear/ver/revocar **tokens de seguridad** (`/security/tokens`) y editar las categorías que admiten "Extra" (`PUT /settings/extra-categories`) |
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

Acciones que, además del permiso, exigen la contraseña de nuevo (token `x-reauth` válido 5 minutos): cancelar y devolver ventas, cerrar caja, cambiar precios, crear usuarios o cambiar rol/contraseña, y (v2) crear tokens de seguridad (ver [API.md](API.md)).

## 4b. Autorización de acciones sensibles (v2)

Los permisos de la matriz **no cambian** (no se agregó ninguno). Lo nuevo es que el vendedor puede *ejecutar* tres acciones que normalmente son del gerente, pero solo si un administrador lo autoriza **en ese momento**:

| Acción | Propósito de la autorización | Gerente | Vendedor | Desarrollador |
|---|---|---|---|---|
| Cerrar caja | `cierre_caja` | Directo (su contraseña, `x-reauth`) | Con contraseña de un gerente **o** token | Nunca |
| Cancelar una venta | `cancelacion` | Directo | Con contraseña de un gerente **o** token | Nunca |
| Devolver mercancía | `devolucion` | Directo | Con contraseña de un gerente **o** token | Nunca |
| Hacer una **Limpia** (venta `type:'limpia'`) | `limpias` | Directo | Con contraseña de un gerente **o** token | Nunca |

- **Contraseña de administrador:** la de un gerente **activo** de esa sucursal. La contraseña solo viaja a `POST /security/verify` (o se compara contra el verificador descargado si no hay internet); nunca se guarda en la operación, solo el id del gerente.
- **Token:** código de 6 a 10 caracteres que crea el gerente (`POST /security/tokens`, con `x-reauth`) con propósitos, vigencia (1 min a 7 días), sucursal, usuario destino y máximo de usos opcionales. El código se muestra **una sola vez**; la base solo guarda sal + hash. El gerente puede revocarlo cuando quiera.
- **Quién queda registrado:** siempre `authorizedBy` (el gerente que autorizó; con token, quien lo creó). Un gerente que hace la acción él mismo queda como su propio autorizador.
- **Sin conexión:** el punto de venta valida contra los tokens y verificadores descargados en el último `pull`. Si no puede comprobar la autorización, **deniega**.
- **Al sincronizar:** el servidor revisa la autorización con la **hora local de la operación** (nunca una hora futura). Si no era válida (token vencido o revocado en ese momento, otro propósito, otra sucursal, gerente inactivo, sin usos), la operación **ya ocurrida se conserva** y se abre el conflicto `autorizacion_invalida` para el gerente. Una operación del vendedor **sin** autorización se rechaza (`sin_permiso`).
- **Límite de intentos:** `POST /security/verify` admite 5 fallos por minuto por usuario o terminal (después, HTTP 429).
- **Sigue prohibido para vendedor y desarrollador:** `/stats/*`, `/security/tokens*`, `/settings/extra-categories` (PUT), `GET /sales/today-summary`, `GET /admin/audit` y los reportes. El vendedor solo **lee** `GET /settings/extra-categories` (para saber qué productos admiten "Extra").
- **Existencias:** ninguna venta nueva puede dejar la existencia en negativo (`sin_existencia`). Única excepción: una venta que ya ocurrió sin conexión y se sincroniza después se aplica y deja el conflicto `stock_negativo`.

## 5. Qué ve cada rol (resumen para la dueña)

| Quiero que… | Rol |
|---|---|
| Venda en el mostrador | Vendedor |
| Cobre, escanee, imprima tickets | Vendedor |
| Abra la caja y haga el corte | **Solo gerente** (el vendedor cierra únicamente con contraseña de admin o un token que tú le des) |
| Cancele ventas, haga devoluciones | **Gerente**; el vendedor solo con contraseña de admin o token |
| Aplique descuentos | **Solo gerente** |
| Cambie precios o dé de alta productos | **Solo gerente** |
| Vea cuánto se vendió hoy en el celular | **Solo gerente** |
| Revise problemas técnicos sin ver dinero | Desarrollador |
| Dé entradas de mercancía por un rato | Vendedor con **permiso temporal** del gerente |

## 6. Cómo comprobar que la matriz se cumple

Hay pruebas escritas (todas **sin ejecutar** aún):

- `packages/shared/test/cash-reports.test.ts` → "permisos por rol: vendedor sin finanzas, desarrollador sin finanzas" y "permiso temporal: vigencia, sucursal, función y revocación".
- `packages/database/test/local-store.test.ts` → "permisos: vendedor no cancela ni da descuentos; desarrollador no vende" y "permiso temporal…".
- `apps/mobile/test/lib-misc.test.ts` → casos de `entry-guard`.
- Pruebas de endpoints de la API (escenario 10 y 22): `apps/api/test/route-permissions.test.ts` (supertest, **no ejecutadas** en este entorno: faltan dependencias) cubre estadísticas, tokens, configuración de extras, resumen de hoy y las acciones con autorización; procedimiento manual en [PRUEBAS.md](PRUEBAS.md).
- **v2:** `packages/shared/test/tokens.test.ts`, `packages/database/test/v2.test.ts`, `apps/api/test/sync-apply-v2.test.ts` y `apps/api/test/security.test.ts` cubren tokens y autorizaciones.
