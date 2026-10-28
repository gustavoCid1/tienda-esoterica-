# Pendientes y supuestos de `apps/web` (versión 2)

Estado: el código se escribió SIN poder ejecutar `npm install`, compilar el proyecto ni probarlo en un navegador. No se afirma que compile ni que funcione. Antes de usarlo, ejecutar `npm install`, `npm run typecheck` y `npm test`.

Lo único que se pudo comprobar en este entorno, y solo de forma parcial:

- La lógica pura nueva (carpeta `src/lib`) se ejecutó con un ejecutor mínimo de pruebas propio (no con vitest) y las 94 pruebas pasaron.
- Un `tsc` con declaraciones simuladas de React, recharts y zod no mostró errores de tipos fuera de los parámetros sin tipo que esas simulaciones provocan. No sustituye al `npm run typecheck` real.

## Dependencias nuevas

- `jspdf` `2.5.2` en `apps/web/package.json` (PDF de etiquetas y ticket de permiso). Se carga con `import()` dinámico solo al generar un PDF. `jsbarcode` y `qrcode` ya existían.

## Archivos nuevos y modificados

Nuevos: `src/styles-v2.css`, `src/notifications.tsx`, `src/lib/{types-v2,audit,series,terminals,labelPdf,pdf,permitTicket,tokens,extras,notifications,salesV2}.ts` (con sus `*.test.ts`, salvo `pdf.ts` y `types-v2.ts`), `src/components/{ErrorBoundary,CopyButton,PdfPreviewModal,TopSeriesCard,ExtraCategoriesCard}.tsx`, `src/pages/{Notifications,SecurityTokens,TerminalsPanel}.tsx`.

Modificados: `main.tsx` (importa `styles-v2.css`), `App.tsx` (campana, contador, límite de errores), `routes.tsx`, `lib/types.ts`, `lib/dashboard.ts`, `pages/{System,Dashboard,Branches,Labels,Sales,Settings}.tsx`. `styles.css` NO se tocó.

## Auditoría: causa real

Leyendo `apps/api/src/audit.ts` y `routes/admin.ts`, el servidor devuelve `{ total, items }` con filas `{ id, at, userId, action, entity, entityId, branchId, terminalId, detail }`, donde `detail` es un OBJETO. La pantalla esperaba `createdAt`, `userName` y un `detail` de texto, y pintaba `{r.detail}` en JSX: React no puede renderizar un objeto y, al no existir límite de errores, se desmontaba toda la aplicación. Solución: `lib/audit.ts` normaliza (acepta ambas formas) y `ErrorBoundary` evita que una pantalla rota tumbe el panel. Hay estados visibles de carga, error y vacío. Esto es un diagnóstico por lectura de código, no una reproducción en ejecución.

Se corrigieron de paso desajustes del mismo tipo: Sincronización (`pendingEvents` en lugar de `pendingOps`), Respaldos (`at`/`ok`/`dir` en lugar de `createdAt`/`status`/`location`), Tablero (`GET /prefs/dashboard` responde `{ prefs }`, el cliente leía la raíz y descartaba el orden guardado), terminal revocada (la API manda `revoked` booleano) y las acciones de terminal (`/token` y `/revoke` exigen `x-reauth` en el servidor y el cliente no lo enviaba).

## Supuestos sobre la API (formas de respuesta)

El contrato fija rutas y permisos, no todas las formas. La web las lee de forma tolerante:

- `POST /admin/terminals`: terminal directo `{ id, code, name, kind, branchId, assignedTo }` o envuelto en `{ terminal }` (la API v1 actual lo envuelve). Se envía `assignedTo` además de `code, name, branchId, kind`.
- `POST /admin/terminals/:id/token`: `{ terminalId, token, ... }`; los campos omitidos se completan con lo que ya se conoce de la terminal. Exige `x-reauth`.
- `GET /security/tokens`: arreglo o `{ items }` de `SecurityToken` (con `status`, `createdByName`, `forUserName` opcionales). El estado vigente/vencido/revocado/agotado se calcula en el cliente con las fechas y los usos.
- `POST /security/tokens` (con `x-reauth`): `{ id, code, expiresAt }`; si falta `code` se muestra un error y no se abre el modal. Cuerpo enviado: `{ label, purposes, durationMinutes, length, branchId?, forUserId?, maxUses? }`. `POST /security/tokens/:id/revoke` sin `x-reauth`.
- `GET /stats/low-stock`: `{ items: [...] }` o arreglo, sin `branchId` para el contador del menú; la página filtra por sucursal en el navegador.
- `GET /stats/top-products-series`: `{ buckets, series }` según el contrato. Si falta `series` se arma desde `buckets[].products`. Se pide `limit=5`. Día: el rango del tablero (máx. 92 días); mes: los 12 meses que terminan en la fecha "hasta".
- `GET/PUT /settings/extra-categories`: `{ categories: string[] }`. Si el GET falla se muestra el error y no se permite guardar.
- `GET/PUT /prefs/dashboard`: se agrega la clave `chartKind` (`line | bar | pie`) junto a `order` y `hidden`; la API la admite porque su esquema es `passthrough`. Respaldo local por usuario en `localStorage` (`amara.web.chartKind.<id>`).
- `GET /sales`: se envía `type=venta|limpia`. La API actual ignora parámetros desconocidos, así que el filtro también se aplica en el navegador. Ver riesgos.
- `GET /sales/:id`: puede traer `sellerId`, `sellerName`, `type` y líneas con `kind`/`extraNote`.
- Permisos de menú: Tokens y la sección de Extras usan `config.editar` (solo gerente); Notificaciones `estadisticas.ver`; Historial de Limpias `tickets.archivo`. Si el paquete compartido define permisos nuevos para tokens, cambiar `routes.tsx` y `Settings.tsx`.
- "Solo gerente" para "Vendió" en Ventas se decide por `user.role === 'gerente'`.

## Riesgos y cosas por verificar

1. **Nada se ejecutó en navegador.** Revisar a mano: modal de terminal en dos pasos (la ventana de contraseña aparece entre ambos), vista previa PDF en iframe, impresión del PDF desde el iframe (si el navegador la bloquea se abre el PDF en una pestaña nueva) y el clic en la gráfica de líneas/barras (usa `activeLabel` del gráfico de recharts).
2. **Código de barras en el PDF.** Se dibuja como rectángulos vectoriales a partir de `JsBarcode` en modo objeto (`encodings[].data`), llamado con un `cast` porque los tipos de `@types/jsbarcode` podrían no admitir un objeto como destino. Si falla, la etiqueta imprime "Codigo no valido". Con QR en etiquetas de 50 mm el ancho de barra por módulo queda cercano a 0.15 mm: puede ser difícil para impresoras de 203 dpi; quitar el QR o usar 60x40/70x40 mm mejora la lectura. Probar con el lector real.
3. **Texto del PDF.** Las fuentes estándar de jsPDF solo dibujan Latin-1: acentos y ñ salen bien; emojis y símbolos fuera de ese rango se eliminan.
4. **Registro de reimpresión.** Ahora se guarda al pulsar Imprimir o Guardar PDF en la vista previa (antes, al abrir el diálogo del navegador). Sigue siendo local al navegador.
5. **Filtro de Limpias.** Mientras la API no filtre por `type`, `GET /sales` devuelve como máximo 100 tickets (límite por omisión); si hay muchos tickets en el rango, algunas Limpias pueden no aparecer. Acotar fechas o agregar `type` y `limit` en la API.
6. **`recharts`.** El tipo de `onClick` del gráfico se declaró con un parámetro propio; si `npm run typecheck` lo rechaza, ajustar la firma a `CategoricalChartState`.
7. **Versión de `jspdf`.** `2.5.2` es la versión recordada, no verificada en este entorno.
8. **Ticket de permiso.** El violeta (`#5B3A8C`) es distinto al ticket de venta del escritorio, pero en impresoras térmicas monocromas se verá negro: el rótulo "TICKET DE PERMISO" y el marco lo distinguen. Un ticket reimpreso requiere el código, que el servidor no guarda: solo se puede generar mientras el modal del código está abierto.
9. **Extras en devoluciones.** Las líneas `extra` se muestran en el detalle, pero el modal de devolución las trata como cualquier línea; falta definir en el contrato si una línea extra puede devolverse.
