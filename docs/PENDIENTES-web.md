# Pendientes y supuestos de `apps/web`

Estado: el código se escribió SIN poder ejecutar `npm install`, compilar ni probar contra la API. Nada de lo siguiente está verificado en ejecución.

## Cambios que se piden a otras partes del repo (no se tocaron)

1. **API / contrato (`docs/API.md`)**: fijar la forma exacta de las respuestas. El panel asume (y lee de forma tolerante):
   - Listas: arreglo o `{ items, total }`. Catálogo paginado con `limit` y `offset` (no documentados).
   - Fechas en filtros (`from`, `to`, `date`): día de México `AAAA-MM-DD` (como `dateRangeSchema`), no ISO UTC.
   - Booleanos de consulta: se envían como `1` (`low=1`, `out=1`); hoy el panel filtra agotados/bajo mínimo en el navegador.
   - `GET /inventory`: arreglo de filas `{ variantId, productId, productName, category, type?, variantLabel, sku, barcode, code, branchId, branchName, location, qty, minStock, costCents, priceCents, photo, archived }`. El panel pide por `branchId` y busca/filtra localmente (nombre, categoría, variante, SKU, códigos).
   - `GET /catalog/products`: `{ items: [{ id, name, type, category, description, brand, sku, photo, specs, notes, archived, variants: [{ id, label, unit, barcode, code, costCents, priceCents, minStock, location }] }], total }`; filtro `status` con valores `activo` / `archivado`.
   - `POST /catalog/codes/next` devuelve `{ code }` o `{ seq }`.
   - `GET /stats/today` y `GET /stats/summary` devuelven `SalesSummary` (directo o dentro de `{ summary }`). `GET /stats/months` devuelve `{ months, best }`. `GET /stats/dashboard` debe incluir `outOfStock` y `lowStock` (acepta `agotados` / `bajoMinimo`) con filas de inventario.
   - `GET/PUT /prefs/dashboard`: `{ order: string[], hidden: string[] }` con ids de indicador (ver `apps/web/src/lib/dashboard.ts`). Un 404 en el GET se trata como "sin preferencias".
   - `GET /cash/sessions`: filas con `status`, `openedAt`, `closedAt`, `openingCents`, `expectedCents`, `countedCents`, `differenceCents`, `provisional`, `pendingReconcile`, `breakdown` (`CashBreakdown`), `denominations`, nombres opcionales.
   - `GET /sales/:id`: `Sale` con `items`, `payments` y, opcional, `adjustments`.
   - `GET /admin/*`: usuarios `{ id, username, name, role, branchIds, active }`; sucursales `{ id, code, name, address, locations[], active }`; terminales `{ id, code, name, branchId, kind, revokedAt, lastSyncAt }`; grants con `sellerName`/`grantedByName` opcionales; conflictos `{ id, kind, status, detail, createdAt, resolvedAt, resolutionNote, payload }`; auditoría `{ id, entity, action, userName, before, after, detail, createdAt }`; respaldos `{ id, createdAt, kind, status, sizeBytes, location, detail }`; `sync/status` `{ terminals: [{ id|terminalId, name, branchId, lastSyncAt, pendingOps }], serverTime, openConflicts }`.
   - `POST /admin/terminals/:id/token` devuelve `{ token }`.
   - `POST /admin/conflicts/:id/resolve` recibe `{ note }` (el contrato no define el cuerpo).
2. **Endpoint faltante: alta de variante en un producto existente.** `API.md` solo permite crear variantes junto con el producto. El panel edita variantes existentes pero no puede agregar una nueva.
3. **Endpoint faltante: configuración del negocio** (`config.editar`). La pantalla Configuración solo muestra estado de conexión, sesión y preferencias personales.
4. **`GET /stats/reports/daily|weekly|monthly` no se usa**: los informes se arman con `GET /stats/summary` (+ `/stats/months`) por rango, porque la forma de esas rutas no está definida. Si se prefiere usarlas, hay que documentar parámetros y respuesta.
5. **Reimpresión de etiquetas**: el historial de lotes se guarda solo en el navegador (`localStorage`); no hay endpoint de bitácora de impresión. La validación de duplicados compara contra `GET /inventory` completo.
6. **Cuerpo de `GET /auth/me`**: se acepta usuario directo o `{ user }`.
7. **Entorno de ejecución**: `apps/web` usa `@vitejs/plugin-react`, `vite`, `vitest`, `recharts`, `jsbarcode`, `qrcode` y sus tipos con versiones fijas que no se pudieron instalar ni resolver aquí; revisar que existan y alinear con el resto del monorepo. `@types/jsbarcode@3.11.4` y `@types/qrcode@1.5.5` son versiones recordadas, no verificadas.
8. **CORS / proxy**: en desarrollo usar `VITE_API_PROXY_TARGET` (Vite reenvía `/api/*` quitando el prefijo). En producción, servir el panel y la API bajo el mismo origen o habilitar CORS para el origen del panel.
