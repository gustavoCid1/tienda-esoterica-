# Pendientes y decisiones de `apps/api`

Estado: código escrito **sin poder instalar dependencias** (registro de npm bloqueado). Nada de lo de abajo se ha
ejecutado contra MongoDB ni contra Express real. Primer paso al tener red: `npm install`, `npm run typecheck -w @amara/api`,
`npm test -w @amara/api`.

## 1. Cambios sugeridos en `packages/*` (NO realizados)

1. **`permissions.ts`**: el permiso `inventario.entrada_temporal` no está en la lista de ningún rol. La API no lo usa:
   decide con `canRegisterEntry` (vendedor + permiso temporal vigente). Conviene quitarlo del tipo o documentarlo como "informativo".
2. **Costos hacia el vendedor**: `PullPayload.variants[].costCents` (y `SaleItem.unitCostCents`) viajan al dispositivo del vendedor porque
   `LocalStore.registerSale` los copia a la venta. La API oculta costos en `/inventory`, `/catalog/products`, `/catalog/lookup` y `/sales/mine`,
   pero **`/sync/pull` y `/catalog/pull` los incluyen** (el contrato actual lo exige). Opciones: (a) que el servidor tome el costo al sincronizar la
   venta (y el dispositivo del vendedor reciba `costCents: 0`), o (b) aceptar la exposición local. Decisión de negocio pendiente.
3. **`schemas.ts` → `cashCloseSchema`**: no trae `sessionId`/`terminalId`; la API los acepta como campos opcionales extra
   (`POST /cash/close` necesita saber qué sesión cerrar). Sería mejor moverlos al esquema compartido.
4. **`schemas.ts` → usuarios**: `userCreateSchema.username` permite mayúsculas; la API guarda y compara **en minúsculas** (`login` también).
   Los clientes deberían normalizar a minúsculas al iniciar sesión.
5. **`sync/protocol.ts` / `LocalStore.markAck`**: un reintento de una operación que originalmente fue `conflict` recibe `duplicate` (según contrato)
   y el dispositivo la marca como "sincronizada" aunque el servidor tenga un conflicto abierto. Alternativa: que la API devuelva el estado original.
6. **`types.ts` → `CashSession`**: faltan `closedAt`, `countedCents`, `expectedCents`, `differenceCents`, `provisional`, `reconciliation`
   (la API los guarda en `cash_sessions`; el tipo compartido solo describe la apertura).
7. **`SyncOp.terminalId`**: es el `_id` de la terminal (no su código). Debe documentarse; el token de terminal se valida contra ese id.

## 2. Diferencias / ampliaciones respecto a `docs/API.md`

- `POST /cash/close` acepta además `sessionId` **o** `terminalId` (uno es obligatorio).
- `POST /sales/:id/cancel` y `/return` aceptan `terminalId` opcional (caja de la que sale el efectivo) e `id` opcional (idempotencia).
  Sin `terminalId` se usa la única caja abierta de la sucursal; si hay varias → 409 pidiendo `terminalId`.
- `POST /inventory/reconcile` además reprocesa eventos de sincronización abandonados (`error` / `procesando` > 2 min) antes de reconciliar.
  Acepta `dryRun` (query o body).
- `POST /admin/branches` agrega la sucursal nueva a `branchIds` del gerente que la crea.
- `POST /admin/terminals/:id/token` y `/revoke` exigen además `x-reauth`. Emitir un token nuevo invalida los anteriores (`tokenVersion`).
- `PATCH /admin/users/:id` exige `x-reauth` al cambiar rol, contraseña, estado activo o sucursales; no permite asignar `desarrollador`, tocar
  cuentas `desarrollador`, cambiarse el propio rol/estado ni dejar el sistema sin gerente activo.
- Las cuentas `desarrollador` solo se pueden crear fuera del POS (directo en la base o con un script aparte); `seed.ts` solo crea el gerente.
- `GET /admin/sync/status`: el desarrollador ve todas las terminales (solo datos técnicos); el gerente, las de sus sucursales.
- Usuarios: 5 contraseñas incorrectas bloquean la cuenta 15 min; además hay límite de 20 intentos/15 min por IP en login y reauth.

## 3. Operación

- **Respaldos**: MongoDB Atlas **M0 no incluye respaldos administrados**. `npm run backup:mongo` exporta cada colección a NDJSON
  (`BACKUP_DIR`, por omisión `apps/api/backups`, ignorada por git), verifica releyendo y registra en `backups_log`. Alternativa estándar:
  `mongodump --uri="$MONGODB_URI" --db=amara --gzip --out=...`. Hay que **copiar la carpeta fuera del servidor** y cifrarla (contiene hashes de
  contraseñas). No hay rotación automática de respaldos viejos. Programar (cron / tarea del host) al menos diario.
- **Reconciliación de existencias**: sin transacciones, una caída entre "insertar movimiento" y "$inc" deja la existencia sin descontar.
  Programar `POST /inventory/reconcile` (p. ej. de madrugada, con poca actividad) o ejecutarla tras cualquier caída del servidor.
- **`TRUST_PROXY`**: si la API está detrás de un proxy (Render/Railway/Fly) poner `TRUST_PROXY=1`; si no, el límite por IP verá la IP del proxy.
- **scrypt** (`hashPassword`/`verifyPassword`) es síncrono (~64 MB y ~100 ms): bloquea el hilo mientras corre; el límite de tasa lo acota.
  Para mucha concurrencia habría que moverlo a un worker.
- **Seed**: `SEED_MANAGER_PASSWORD` ≥ 10 caracteres; no se imprime. Los tokens de terminal se emiten después desde `/admin/terminals/:id/token`.

## 4. Riesgos conocidos sin verificar

- No se compiló con el `mongodb`/`express`/`vitest` reales. Se comprobaron tipos contra `zod` y `@amara/shared` reales con stubs de Express/Mongo,
  y la lógica pura (sync-apply, stats, ajustes, existencias, seed, respaldo) se ejecutó con un sustituto mínimo de `vitest`; **no** se corrió con vitest ni supertest.
- `reconcileStock` usa compare-and-set sobre el valor observado; una venta que llegue exactamente durante la conciliación puede hacer que se omita
  esa corrección (queda en `skipped`) o, en una ventana de milisegundos, se cuente dos veces. Ejecutar con poca actividad.
- Un evento que falla a medias (`error`) se reprocesa al reintentar, pero el `$inc` perdido no se reaplica (evita doble conteo): lo repara `reconcile`.
- Un reintento mientras la operación original sigue "procesando" (< 2 min) recibe `duplicate` sin esperar su resultado.
- Los movimientos manuales **en línea** validan existencia suficiente con una lectura previa (no atómica); dos salidas simultáneas podrían dejar negativo
  (se detecta y avisa como conflicto `stock_negativo`).
- `sync_conflicts` guarda la operación completa en `sync_events.op` (incluye costos); solo la ve quien tiene `sync.conflictos` (gerente).
- Claves de `specs` del producto y de las preferencias se guardan tal cual en Mongo; las de preferencias se restringen a `[A-Za-z0-9_-]`, las de `specs` no.
- Bloqueo de cuenta por intentos fallidos permite a un atacante bloquear a un usuario conocido durante 15 min (compromiso aceptado frente a fuerza bruta).
