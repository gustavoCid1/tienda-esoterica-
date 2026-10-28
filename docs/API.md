# Contrato de la API central (v1 + núcleo v2)

Contrato único para `apps/api` (servidor) y `apps/web`, `apps/desktop`, `apps/mobile` (clientes).
Todas las respuestas son JSON. Errores: `{ "error": "mensaje en español" }` con código HTTP 4xx/5xx.
Dinero = enteros en centavos MXN. Fechas = ISO-8601 UTC con `Z`. Zona del negocio: `America/Mexico_City`.
Los esquemas de entrada viven en `packages/shared/src/schemas.ts` (Zod) y el servidor los valida SIEMPRE.
Autorización: cabecera `Authorization: Bearer <token>`. El rol se lee de la base en cada petición.
Acciones sensibles exigen además la cabecera `x-reauth: <token de POST /auth/reauth>` (vigencia 5 min).

## Salud y autenticación
| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /health` | pública | `{ ok, time, version }` |
| `POST /auth/login` | pública (limitada por tasa) | Body `{username,password}` → `{token,expiresAt,user:{id,name,username,role,branchIds}}` |
| `POST /auth/reauth` | sesión | Body `{password}` → `{token}` (5 min) |
| `GET /auth/me` | sesión | Usuario actual y sucursales |
| `GET /auth/permissions` | sesión | `{ permissions: Permission[] }` del rol (solo para mostrar/ocultar UI) |

## Catálogo
| `GET /catalog/pull?branchId&since` | `productos.ver` | Catálogo incremental + existencias (mismo `PullPayload` que `/sync/pull`) |
| `GET /catalog/products?q&category&status` | `productos.ver` | Lista paginada `{items,total}` con variantes |
| `POST /catalog/products` | `productos.editar` | `productCreateSchema` (producto + variantes + existencia inicial por sucursal) |
| `PATCH /catalog/products/:id` | `productos.editar` | Edita datos del producto (audita) |
| `PATCH /catalog/variants/:id` | `productos.editar`; precios `precios.editar` + `x-reauth` | Edita variante; todo cambio de precio se audita con valor anterior y nuevo |
| `POST /catalog/products/:id/archive` / `restore` | `productos.editar` | Archiva sin borrar |
| `GET /catalog/lookup?code=` | `productos.ver` | Busca por código de barras, código interno o QR (`parseQrValue`) |
| `GET /catalog/codes/check?code=` | `productos.editar` | `{ duplicate: boolean }` |
| `POST /catalog/codes/next` | `productos.editar` | Reserva el siguiente código interno (contador atómico) |

## Inventario
| `GET /inventory?branchId&q&low&out` | `inventario.ver` | Tabla principal: producto, categoría, variante, sucursal, ubicación, cantidad, costo, precio, código, foto, estado |
| `POST /inventory/movements` | `inventario.mover`, o `inventario.entrada_temporal` con permiso vigente | `stockMovementSchema`; nunca modifica existencia sin crear movimiento |
| `POST /inventory/transfers` | `transferencias.crear` | `transferSchema`; genera salida + entrada, NO es venta |
| `GET /inventory/movements?variantId&branchId&from&to` | `inventario.ver` | Historial |
| `POST /inventory/reconcile` | `sync.conflictos` | Recalcula existencias desde movimientos |

## Ventas y tickets
| `GET /sales?date&from&to&branchId&folio&userId&terminalId&status` | `tickets.archivo` | Archivo de tickets |
| `GET /sales/mine?date` | `ventas.ver_propias` | Solo ventas del propio usuario (sin acumulados financieros) |
| `GET /sales/:id` | `tickets.archivo` o dueño | Venta con copia histórica de líneas |
| `GET /sales/today-summary?branchId` | `tickets.archivo` (gerente) | **v2.** Tickets de hoy (hora de México) solo con lo vendido: `{day, count, totalCents, items:[{saleId, folio, createdAt, status, type, sellerId, sellerName, totalCents, items:[{name, label, qty, unitPriceCents, netCents, kind, extraNote}]}]}`. Sin costos, pagos ni ticket impreso. `totalCents` no cuenta canceladas |
| `POST /sales/:id/cancel` | `ventas.cancelar` + `x-reauth` (gerente), o vendedor con `authorization` | Body `{reason, terminalId?, authorization?}`; crea ajuste, no borra la venta. Los extras devuelven dinero, no existencias. Ver "Autorización de acciones sensibles" |
| `POST /sales/:id/return` | `ventas.devolver` + `x-reauth` (gerente), o vendedor con `authorization` | Body `{reason, items:[{saleItemId,qty,restock}], payments, authorization?}`. Un extra siempre queda con `restock=false` |

## Caja
| `GET /cash/sessions?branchId&from&to` | `caja.corte` | Historial de cortes |
| `GET /cash/current?terminalId` | `caja.abrir` | Sesión abierta con desglose esperado en vivo (`computeCashBreakdown`) |
| `POST /cash/open` | `caja.abrir` | `{terminalId,branchId,openingCents}` |
| `POST /cash/movements` | `caja.movimientos` | `{sessionId,type,amountCents,concept}` |
| `POST /cash/close` | `caja.corte` + `x-reauth` (gerente), o vendedor con `authorization` | `cashCloseSchema` (+ `authorization?`); guarda esperado, contado, diferencia y marca `provisional` si hay pendientes de conciliar. Responde `{ok, sessionId, expectedCents, countedCents, differenceCents, provisional, breakdown, closedBy, authorization, authorizedBy}` |

## Estadísticas (solo gerente; el vendedor y el desarrollador reciben 403)
| `GET /stats/today?branchId` | `estadisticas.ver` | "Resumen de ventas de hoy" (00:00 → ahora en `America/Mexico_City`) |
| `GET /stats/summary?from&to&branchId` | `estadisticas.ver` | `SalesSummary` de `packages/shared/src/reports.ts` |
| `GET /stats/months?from&to&branchId` | `estadisticas.ver` | `monthlyTotals` + mes con mayor importe |
| `GET /stats/dashboard?from&to&branchId` | `estadisticas.ver` | Todo lo del dashboard + agotados + bajo mínimo |
| `GET /stats/low-stock?branchId` | `estadisticas.ver` | **v2.** `{items:[{variantId, productId, productName, label, category, branchId, qty, minStock}]}`. Variantes activas con `minStock > 0` y `qty <= minStock`, más cualquier existencia negativa heredada. Orden por urgencia: negativas primero, luego el menor `qty/minStock` |
| `GET /stats/top-products-series?from&to&granularity=day\|month&branchId&limit=5` | `estadisticas.ver` | **v2.** `{range, granularity, buckets:[{bucket, topProduct:{name,qty}\|null, products:[{productId,name,qty,netCents}]}], series:[{productId,name,points:[{bucket,qty,netCents}]}]}`. `bucket` = `AAAA-MM-DD` (día) o `AAAA-MM` (mes), todas las cubetas del rango incluso vacías. `series` = los `limit` productos más vendidos de TODO el rango. Neto de devoluciones (restan en SU fecha); un extra suma importe y no unidades. Por omisión 30 días / 12 meses. `limit` 1–20 |
| `GET /stats/product-series?productId\|variantId&from&to&granularity&branchId` | `estadisticas.ver` | **v2.** `{range, granularity, points:[{bucket,qty,netCents}], totalQty, totalNetCents, last:[{saleId,folio,createdAt,qty,netCents}]}`. `last` = hasta 20 ventas del mes del `to` donde apareció, más recientes primero. 400 si faltan ambos ids |
| `GET /stats/reports/daily` / `weekly` / `monthly` | `estadisticas.ver` | Informes agregados (distintos de un corte real) |
| `GET/PUT /prefs/dashboard` | sesión con `estadisticas.ver` | Preferencias de tablero por usuario (no otorgan permisos) |

## Seguridad: tokens y autorizaciones (v2)
| Método y ruta | Permiso | Descripción |
|---|---|---|
| `POST /security/tokens` | `config.editar` (gerente) + `x-reauth` | Body `{label, purposes[], durationMinutes, branchId?, forUserId?, maxUses?, length?}` → 201 `{id, code, expiresAt, note}`. **El código solo sale aquí**; en la base solo hay `salt` + `hash` (sha256 de `salt:CODIGO`). `purposes`: `cierre_caja`, `devolucion`, `cancelacion`, `limpias`. `durationMinutes` 1 a 10080; `length` 6 a 10 (8 por omisión) |
| `GET /security/tokens?status&limit` | `config.editar` | `{items:[{id, label, purposes, branchId, forUserId, createdBy, createdAt, expiresAt, revokedAt, revokedBy, maxUses, usedCount, lastUsedAt, status}]}` sin sal ni hash; `status` = `vigente`, `vencido`, `revocado`, `agotado` o `pendiente`. Del gerente: sus sucursales y los generales |
| `POST /security/tokens/:id/revoke` | `config.editar` | `{ok, token}`; idempotente |
| `POST /security/verify` | sesión de usuario **o token de terminal** | Body `{purpose, branchId, code}` **o** `{purpose, branchId, adminPassword, adminUserId?|adminUsername?}` (uno solo). Éxito: `{ok:true, tokenId, expiresAt, authorization, authorizedBy, authorizedByName, verifiedUntil}` (`tokenId`/`expiresAt` son null con contraseña de admin). Denegado: **200** `{ok:false, reason, message}` (`no_coincide`, `proposito`, `sucursal`, `usuario`, `vencido`, `revocado`, `agotado`, `pendiente`). Más de **5 fallos por minuto** por usuario/terminal → **429** `{ok:false, error, retryAfterSeconds}` con `Retry-After`. No consume el token. Deja una verificación de 10 minutos de un solo uso |
| `GET /settings/extra-categories` | cualquier sesión de usuario | `{categories:string[]}` (de fábrica: Veladoras, Pulseras, Imágenes, Lociones) |
| `PUT /settings/extra-categories` | `config.editar` (gerente) | Body `{categories:string[]}` → `{categories}` ya limpia (recorta, quita vacíos y repetidos sin distinguir acentos/mayúsculas). Se audita con antes y después |

### Autorización de acciones sensibles (cerrar caja, cancelar, devolver)
- **Gerente:** como siempre (`x-reauth`); no manda `authorization`. Su identidad queda como `authorizedBy`.
- **Vendedor:** SIEMPRE manda `authorization` = `{kind:'admin_password', adminUserId}` o `{kind:'token', tokenId}`, obtenida antes con `POST /security/verify` (mismo usuario, propósito y sucursal, dentro de 10 minutos, **un solo uso**). La ruta además revalida (token vigente y con usos, gerente activo de la sucursal). Sin `authorization` → 403; verificación ausente o ya usada → 403; autorización no válida → 403.
- **Desarrollador:** siempre 403.
- Propósitos: `cierre_caja` (`/cash/close`), `cancelacion`, `devolucion`, `limpias` (venta `type:'limpia'` por sync).

## Administración (gerente)
| `GET/POST/PATCH /admin/users` | `usuarios.gestionar` + `x-reauth` al crear/cambiar rol/contraseña | Un gerente no puede crear `desarrollador` desde el POS; nunca se devuelve el hash |
| `GET/POST/PATCH /admin/branches` | `sucursales.gestionar` | Sucursales y ubicaciones |
| `GET/POST/PATCH /admin/terminals` | `sucursales.gestionar` | Terminales. **v2:** `POST` acepta `{branchId, kind:'escritorio'\|'movil', assignedTo?, code?, name?}`; sin `code` el servidor toma el siguiente libre (`P1, P2…` escritorio, `M1, M2…` móvil) y sin `name` arma "PC de Ana" / "Móvil de Ana". Responde 201 con el terminal completo en la raíz `{id, code, name, kind, branchId, assignedTo, revoked, lastSyncAt, createdAt, updatedAt, terminal:{…igual}}` (el campo `terminal` es la forma v1). `PATCH` acepta `name`, `kind`, `assignedTo` |
| `POST /admin/terminals/:id/token` | `sucursales.gestionar` + `x-reauth` | **v2.** `{terminalId, code, name, kind, branchId, assignedTo, token, note}`. El token se muestra UNA vez; al emitir otro, el anterior deja de servir |
| `POST /admin/terminals/:id/revoke` | `sucursales.gestionar` + `x-reauth` | Anula el token de la terminal |
| `GET/POST /admin/grants`, `POST /admin/grants/:id/revoke` | `permisos_temporales.gestionar` | Permiso temporal para entradas (`grantCreateSchema`) |
| `GET /admin/conflicts`, `POST /admin/conflicts/:id/resolve` | `sync.conflictos` | Conflictos de sincronización |
| `GET /admin/audit?entity&action&from&to&limit&offset` | `auditoria.ver` | Auditoría. **v2 (corregida):** `{total, items:[{id, at, createdAt, userId, userName, action, entity, entityId, branchId, terminalId, detail, summary}]}`. `at` y `createdAt` son lo mismo; `detail` es un objeto (o null); `summary` es una línea de texto; `userName` es null si el usuario ya no existe. Los parámetros vacíos se ignoran, `entity` acepta nombres en español (`usuario`, `venta`, `caja`…), nunca salen contraseñas/hashes/sales |
| `GET /admin/backups` | `respaldos.ver` | Registro de respaldos |
| `GET /admin/sync/status` | `sync.estado` | Terminales, última sincronización, pendientes |
| `GET /admin/diagnostics` | `sistema.diagnostico` | Solo técnico: versión, conexión a base, latencia. SIN datos financieros |

## Sincronización (token de terminal o sesión)
| `POST /sync/push` | terminal o usuario con acceso a la sucursal | `syncPushSchema` → `{results: SyncResult[], serverTime}`; idempotente por `opId` |
| `GET /sync/pull?branchId&since` | idem | `PullPayload` (catálogo incremental + existencias completas de la sucursal). **v2:** agrega `securityTokens` (tokens de la sucursal y generales vigentes o vencidos hace menos de 24 h (incluye los revocados, con `revokedAt`); **solo `salt`+`hash`**, nunca el código), `settings:{extraCategories}` y, en `users`, el campo `verifier` (hash scrypt de la contraseña) **solo de los gerentes** para autorizar sin internet |


## Sincronización v2: lo que cambia en `POST /sync/push`
- `sale.create`: acepta `sellerId`, `sellerName`, `type: 'venta'|'limpia'` y líneas `kind:'extra'` (cantidad 1, costo 0, importe > 0; **sin movimiento de inventario**; suman al importe, no a unidades). Una venta V1 (sin esos campos) se aplica igual. Una línea extra mal formada (cantidad ≠ 1 o costo ≠ 0) → rechazo `importes_inconsistentes`.
- `type:'limpia'` hecha por un **vendedor** lleva `payload.authorization` con propósito `limpias`. El gerente no la necesita.
- `cash.close` y `sale.adjust` (cancelación/devolución) hechos por un **vendedor** llevan `payload.authorization`. Sin `authorization` → `rejected` (`sin_permiso`). Con `authorization` **inválida** a la hora local de la operación (`min(localTs, ahora)`: token vencido/revocado/agotado/de otra sucursal u otro propósito, gerente inactivo o de otra sucursal) → la operación YA OCURRIDA se **aplica** y queda el conflicto `autorizacion_invalida` (`rejected:false`) para el gerente. Nunca se borra nada.
- El uso de un token se cuenta una sola vez por operación (`security_token_uses`, `_id = <tokenId>:<opId>`); reenviar la misma operación no vuelve a contarlo. Si el máximo de usos se agotó en una carrera, también queda `autorizacion_invalida`.
- Auditoría: `autorizacion.<acción>` (`cierre_caja`, `cancelacion`, `devolucion`, `limpias`) con `{valid, authorization, authorizedBy}` o `{valid:false, reason}`, además de la auditoría de la propia operación (que ahora incluye `authorization`/`authorizedBy`).
- Excepción documentada de existencias: una venta que ya ocurrió sin conexión se aplica aunque deje la existencia en negativo, y genera el conflicto `stock_negativo`. Las ventas NUEVAS (`LocalStore.registerSale`) nunca dejan negativos (`sin_existencia`).
