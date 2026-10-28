# Cambios v2: contrato técnico común

Este documento es la FUENTE DE VERDAD de la versión 2. API, web, escritorio y móvil deben respetarlo al pie de la letra.
Reglas generales para todos los que lo implementen:

- **Cambios aditivos.** La dueña ya tiene datos reales en MongoDB y en su SQLite. Todo campo nuevo es opcional o tiene valor por defecto. Nunca se edita la migración V1 de SQLite: se agrega la migración **versión 2** (y siguientes). Nada se borra ni se renombra.
- **No tocar los archivos de estilo/tema existentes** (`apps/web/src/styles.css`, `apps/desktop/src/renderer/styles.css`, `apps/mobile/src/theme.ts`): la dueña los personalizó con sus colores. Los estilos nuevos van en archivos nuevos (`styles-v2.css`) y usan las variables CSS ya existentes (`var(--gold)`, `var(--ink)`, etc.) sin redefinirlas. En móvil, estilos nuevos locales que lean los colores de `theme.ts`.
- **Español** en toda la interfaz y comentarios. Dinero en centavos enteros. Fechas ISO UTC.
- **Seguridad:** el servidor valida todo; ocultar un botón nunca basta. El vendedor jamás ve totales, gráficas ni notificaciones.
- **No afirmar que compila ni que funciona** si no se pudo ejecutar. Este entorno no puede instalar dependencias; la dueña ejecutará `npm install`, `npm run typecheck` y `npm test`. Se pueden agregar dependencias a `package.json` (se instalarán en su PC), pero hay que anotarlas en el informe final.
- Cada área escribe pruebas para la lógica pura nueva.

## 1. Modelo compartido (`packages/shared`)

```ts
// Venta
Sale.sellerId?: string | null      // empleado que vendió (elegido en la ventana de cobro)
Sale.sellerName?: string | null    // SOLO en sistema: NO se imprime en el ticket
Sale.type?: 'venta' | 'limpia'     // por omisión 'venta'

// Línea de venta
SaleItem.kind?: 'producto' | 'extra'   // por omisión 'producto'
SaleItem.extraNote?: string | null
// Línea 'extra': variantId = variante del producto padre; qty = 1; unitPriceCents = cargo extra;
// unitCostCents = 0; NO genera movimiento de inventario. Cuenta como ingreso, no como unidad vendida.
```

Reglas de cálculo: `computeSale` acepta líneas `extra` (precio ≥ 0, qty fija 1) y conserva descuentos y pagos exactos.

### Tokens de seguridad

```ts
type TokenPurpose = 'cierre_caja' | 'devolucion' | 'cancelacion' | 'limpias';
interface SecurityToken {
  id: string; label: string;
  purposes: TokenPurpose[];        // para qué sirve
  branchId: string | null;          // null = cualquier sucursal del admin
  forUserId: string | null;         // opcional: solo para ese usuario
  createdBy: string; createdAt: string;
  expiresAt: string;                // lo elige el admin (minutos u horas)
  revokedAt: string | null;
  maxUses: number | null;           // null = ilimitado dentro de su vigencia
  usedCount: number;
}
```

- El código tiene **máximo 10 caracteres** (por omisión 8), alfabeto sin ambiguos (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`). El servidor lo muestra **una sola vez** al crearlo. Solo se guarda `salt` + `hash` (sha256 de `salt:CODIGO`).
- Duración mínima 1 minuto, máxima 7 días. El admin la elige en minutos u horas.
- Funciones puras en shared: `generateTokenCode(len=8)`, `hashTokenCode(code, salt)`, `isTokenActive(token, purpose, branchId, atIso, userId?)`, `verifyTokenCodeLocal(code, cachedTokens, purpose, branchId, atIso, userId?)`.
- **Autorización de acciones sensibles** (cerrar caja, cancelar, devolver, entrar a Limpias siendo vendedor). Estructura que viaja en la operación:

```ts
type ActionAuthorization =
  | { kind: 'admin_password'; adminUserId: string }   // contraseña de un gerente activo
  | { kind: 'token'; tokenId: string };                // token vigente con ese propósito
```

  Nunca se guarda ni se envía la contraseña ni el código del token dentro de la operación; solo quién autorizó. Quedan en auditoría.
- **Verificación en línea:** `POST /security/verify` (ver §3). **Sin conexión:** el dispositivo valida contra la caché de tokens (hashes) y los verificadores de contraseña de gerentes que ya descargó en el último `pull`. Si no puede comprobarlo, **deniega**. Al sincronizar, el servidor revisa que el token existiera y estuviera vigente a la hora local de la operación; si no, registra un conflicto `autorizacion_invalida` (la operación ya ocurrida NO se borra).
- El gerente que inicia sesión NO necesita autorización para cerrar caja, devolver o cancelar (su propia contraseña ya es de admin); aun así su identidad queda como `authorizedBy`. El **vendedor siempre** necesita contraseña de admin o token.

### Configuración de extras

`extraCategories: string[]`, por omisión `['Veladoras','Pulseras','Imágenes','Lociones']` (se compara por `category` del producto, sin distinguir mayúsculas/acentos). Solo gerente la modifica. Viaja en el `pull` dentro de `settings.extraCategories`.

### Caja

`CashSession` agrega: `closedAt?`, `closedBy?`, `closeAuthorization?: ActionAuthorization`, `countedCents?`, `expectedCents?`, `differenceCents?`. Al abrir se guardan siempre hora de apertura y monto inicial. **No se puede cerrar sin `authorization` válida** (servidor, `LocalStore` y UI).

### Existencias

La venta **local u online** (`LocalStore.registerSale`) rechaza con `StoreError('sin_existencia', ...)` si alguna línea supera la existencia disponible conocida. **Nunca** se muestran ni se generan existencias negativas por ventas nuevas. Excepción deliberada y documentada: al **sincronizar en el servidor** una venta que ya ocurrió físicamente sin conexión se aplica de todos modos y deja un conflicto `stock_negativo` (la mercancía ya salió; no se puede rechazar). La UI debe mostrar las existencias negativas heredadas (como -2) con aviso y no permitir venderlas.

## 2. SQLite (`packages/database`), migración versión 2

Aditiva: `sales` (+`seller_id`, `seller_name`, `sale_type`), `sale_items` (+`kind`, `extra_note`), `cash_sessions` (+columnas de cierre que falten), tablas nuevas `security_tokens_cache` (id, hash, salt, purposes JSON, branch_id, for_user_id, expires_at, revoked_at, max_uses, used_count) y `app_settings` si no hay una equivalente. `applyPull` guarda tokens y `settings`. Métodos nuevos de `LocalStore`: `verifyActionAuthorization({code?, adminUserId?, adminPassword?, purpose, branchId})`, `registerSale({... sellerId, sellerName, type, items con kind extra})`, `closeCash({... authorization})`, `cancelSale/refundSale({... authorization})`, `listTodaySalesSummary()`.

## 3. API (`apps/api`), endpoints nuevos y cambios

| Ruta | Permiso | Notas |
|---|---|---|
| `POST /security/tokens` | gerente + `x-reauth` | `{label, purposes[], durationMinutes, branchId?, forUserId?, maxUses?, length?}` → `{id, code, expiresAt}` (código solo aquí) |
| `GET /security/tokens` | gerente | lista sin códigos, con estado vigente/vencido/revocado |
| `POST /security/tokens/:id/revoke` | gerente | |
| `POST /security/verify` | usuario o terminal | `{code, purpose, branchId}` → `{ok, tokenId, expiresAt}`; limitada por tasa (5 fallos/min por usuario/terminal) |
| `GET/PUT /settings/extra-categories` | GET: cualquier sesión; PUT: gerente | `{categories: string[]}` |
| `GET /stats/low-stock?branchId` | gerente | `{items:[{variantId, productId, productName, label, category, branchId, qty, minStock}]}` ordenado por urgencia |
| `GET /stats/top-products-series?from&to&granularity=day\|month&branchId&limit=5` | gerente | `{buckets:[{bucket, topProduct:{name,qty}\|null, products:[{productId,name,qty,netCents}]}], series:[{productId,name,points:[{bucket,qty,netCents}]}]}` |
| `GET /stats/product-series?productId\|variantId&from&to&granularity&branchId` | gerente | `{points:[{bucket,qty,netCents}], totalQty, totalNetCents, last:[{saleId,folio,createdAt,qty,netCents}]}` (últimas ventas del mes) |
| `GET /sales/today-summary?branchId` | gerente | lista de tickets de hoy SOLO con productos vendidos, cantidades y precios, sin el ticket impreso |
| `POST /admin/terminals` | `sucursales.gestionar` | agrega `kind: 'escritorio'\|'movil'`, `assignedTo` (para quién es); responde el terminal completo `{id, code, name, kind, branchId, assignedTo}` |
| `POST /admin/terminals/:id/token` | idem | responde `{terminalId, code, name, kind, branchId, assignedTo, token}`; el token se muestra una vez |
| `GET /admin/audit` | `auditoria.ver` | revisar y corregir la forma de respuesta (la página Auditoría de la web no carga) |
| `POST /cash/close`, `POST /sales/:id/cancel`, `POST /sales/:id/return` | como antes | aceptan `authorization` (vendedor: obligatorio). Siguen requiriendo permiso de rol, salvo que el vendedor traiga autorización válida con propósito correcto |
| `POST /limpias` (opcional, solo si no pasa por sync) | gerente, o vendedor con token `limpias` | las Limpias normalmente viajan como venta `type:'limpia'` por `sync/push` |

Cambios en `sync-apply`: aceptar `sellerId/sellerName/type`, líneas `extra` (sin movimiento de inventario), `authorization` en `cash.close`, `sale.adjust` (cancelación/devolución) y venta `limpia` realizada por un vendedor (`authorization` con propósito `limpias`). Auditar todo. El `pull` incluye `securityTokens` (solo hashes) y `settings.extraCategories`, y la lista de empleados (`users` con rol vendedor/gerente activos de la sucursal) ya existente.

Estadísticas existentes (`/stats/summary`, `/stats/today`): las ventas `limpia` cuentan como ventas; las líneas `extra` suman al importe pero no a unidades.

## 4. Interfaz por aplicación

### Web
1. **Auditoría:** arreglar para que cargue (ver ruta y forma de respuesta).
2. **Dashboard:** gráfica de **líneas** de productos más vendidos por **día o mes** (selector). Al tocar un día/mes se muestra qué producto fue el más vendido ese periodo y el ranking. **Selector de tipo de gráfica**: líneas, barras o pastel, recordado por usuario.
3. **Terminales:** al crear una terminal (PC o móvil) se abre un **modal "¿Para quién es esta terminal?"** (tipo escritorio/móvil, nombre de la persona, sucursal), se genera todo automáticamente y se muestra un **segundo modal con los datos** (ID, código, token) con botones de copiar, **sin F5**. La lista se actualiza sola.
4. **Etiquetas:** "Imprimir" abre un **modal con vista previa PDF** de la hoja de etiquetas (no el diálogo de imprimir del navegador), con botones **Imprimir** y **Guardar PDF**, y opciones para mostrar/ocultar nombre, precio y QR.
5. **Notificaciones** (solo gerente): sección con productos en o bajo su mínimo, contador en el menú, actualización periódica.
6. **Tokens de seguridad** (gerente): crear con duración en minutos u horas y propósitos, ver estado, revocar, e imprimir/mostrar el **"ticket de permiso"** (color distinto) con código, duración y quién lo autorizó.
7. **Extras:** el gerente elige las categorías a las que aplica el botón Extra.
8. **Limpias:** historial de Limpias (las crean escritorio/móvil).
9. Ventas: mostrar quién vendió (`sellerName`) en el detalle de venta, solo para gerente.

### Escritorio
1. **Cobro:** antes de cobrar, ventana con la lista de empleados para elegir quién vende; se guarda `sellerId/sellerName` (no se imprime).
2. **Botón "Extra"** en líneas de las categorías configuradas: pide el monto y una nota y agrega la línea `extra`.
3. **Ticket:** tras cobrar, **modal con vista previa del ticket** (equivalente al PDF) con un solo botón **Imprimir** que manda **las 2 copias seguidas** (cliente y tienda) sin guardar PDF; botón Guardar PDF opcional.
4. **Sin existencias:** no se puede agregar más de lo disponible; en 0 no se vende; nunca se muestran negativos en venta.
5. **Caja:** registra hora y monto de apertura; **cerrar exige** contraseña de admin o token; **botón "Generar ticket de cierre"**.
6. **Devolución/cancelación:** exige contraseña de admin o token (vendedor) con el propósito correspondiente.
7. **Etiquetas:** igual que la web: opciones para quitar QR/precio/nombre, **modal de vista previa** con botones Imprimir y **Guardar PDF**.
8. **Limpias** (solo admin; el vendedor entra solo con contraseña de admin o token `limpias`).
9. **Generar token** (admin): duración, propósitos, e imprimir **ticket de permiso** (color distinto).
10. **Extras:** ajustes (solo admin) para elegir categorías. Notificaciones de mínimos: NO en escritorio.

### Móvil
1. **Entrada del administrador:** pantalla **"Panel administrativo"** con *mis ventas* de hoy y gráficas de ventas generales, con **selector de tipo de gráfica** (pastel, líneas, barras).
2. **Producto:** al abrirlo, gráfica de ventas del producto y últimas ventas del mes.
3. **Notificaciones** (solo admin): sección de productos en mínimo; notificación local del teléfono al sincronizar o al abrir la app (y tarea en segundo plano si el sistema la permite).
4. **Consultar tickets de hoy:** lista con lo vendido y el precio, no el ticket impreso. Botón **"Generar ticket de cierre"** y **"Generar ticket de permiso"** (otro color).
5. **Caja en móvil:** apertura (hora y monto) y cierre con contraseña de admin o token; **devoluciones y cancelaciones** con contraseña de admin o token.
6. **Cobro:** selección de empleado, botón **Extra**, sin ventas con existencia 0, ticket con vista previa e impresión de 2 copias seguidas.
7. **Etiquetas:** vista previa del PDF con opciones de nombre/precio/QR y botones Imprimir y Compartir/Guardar.
8. **Limpias** y **Extras (categorías)** solo para admin; vendedor solo con contraseña de admin o token.
9. **Tokens** (admin): crear con duración y propósito, ver y revocar, y generar el ticket de permiso.
