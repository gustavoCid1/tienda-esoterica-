# Contrato de la API central (v1)

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
| `POST /sales/:id/cancel` | `ventas.cancelar` + `x-reauth` | Body `{reason}`; crea ajuste, no borra la venta |
| `POST /sales/:id/return` | `ventas.devolver` + `x-reauth` | Body `{reason, items:[{saleItemId,qty,restock}], payments}` |

## Caja
| `GET /cash/sessions?branchId&from&to` | `caja.corte` | Historial de cortes |
| `GET /cash/current?terminalId` | `caja.abrir` | Sesión abierta con desglose esperado en vivo (`computeCashBreakdown`) |
| `POST /cash/open` | `caja.abrir` | `{terminalId,branchId,openingCents}` |
| `POST /cash/movements` | `caja.movimientos` | `{sessionId,type,amountCents,concept}` |
| `POST /cash/close` | `caja.corte` + `x-reauth` | `cashCloseSchema`; guarda esperado, contado, diferencia y marca `provisional` si hay pendientes de conciliar |

## Estadísticas (solo gerente; el vendedor y el desarrollador reciben 403)
| `GET /stats/today?branchId` | `estadisticas.ver` | "Resumen de ventas de hoy" (00:00 → ahora en `America/Mexico_City`) |
| `GET /stats/summary?from&to&branchId` | `estadisticas.ver` | `SalesSummary` de `packages/shared/src/reports.ts` |
| `GET /stats/months?from&to&branchId` | `estadisticas.ver` | `monthlyTotals` + mes con mayor importe |
| `GET /stats/dashboard?from&to&branchId` | `estadisticas.ver` | Todo lo del dashboard + agotados + bajo mínimo |
| `GET /stats/reports/daily` / `weekly` / `monthly` | `estadisticas.ver` | Informes agregados (distintos de un corte real) |
| `GET/PUT /prefs/dashboard` | sesión con `estadisticas.ver` | Preferencias de tablero por usuario (no otorgan permisos) |

## Administración (gerente)
| `GET/POST/PATCH /admin/users` | `usuarios.gestionar` + `x-reauth` al crear/cambiar rol/contraseña | Un gerente no puede crear `desarrollador` desde el POS; nunca se devuelve el hash |
| `GET/POST/PATCH /admin/branches` | `sucursales.gestionar` | Sucursales y ubicaciones |
| `GET/POST/PATCH /admin/terminals` | `sucursales.gestionar` | Terminales; `POST /admin/terminals/:id/token` emite token de terminal, `.../revoke` lo anula |
| `GET/POST /admin/grants`, `POST /admin/grants/:id/revoke` | `permisos_temporales.gestionar` | Permiso temporal para entradas (`grantCreateSchema`) |
| `GET /admin/conflicts`, `POST /admin/conflicts/:id/resolve` | `sync.conflictos` | Conflictos de sincronización |
| `GET /admin/audit?entity&from&to` | `auditoria.ver` | Auditoría |
| `GET /admin/backups` | `respaldos.ver` | Registro de respaldos |
| `GET /admin/sync/status` | `sync.estado` | Terminales, última sincronización, pendientes |
| `GET /admin/diagnostics` | `sistema.diagnostico` | Solo técnico: versión, conexión a base, latencia. SIN datos financieros |

## Sincronización (token de terminal o sesión)
| `POST /sync/push` | terminal o usuario con acceso a la sucursal | `syncPushSchema` → `{results: SyncResult[], serverTime}`; idempotente por `opId` |
| `GET /sync/pull?branchId&since` | idem | `PullPayload` (catálogo incremental + existencias completas de la sucursal) |
