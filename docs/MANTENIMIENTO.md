# Mantenimiento y cambios futuros

> Revisión: 22/10/2026. Guía para quien modifique el sistema. Está basada en la estructura real del repositorio; los pasos de comandos **no se han ejecutado** (ver [README](../README.md), sección 0).

## 0. Reglas de oro antes de cambiar algo

1. **Respaldo primero**: base local y MongoDB ([RESPALDOS.md](RESPALDOS.md)).
2. **Un cambio a la vez**, con `npm run typecheck` y las pruebas ([PRUEBAS.md](PRUEBAS.md)) después de cada uno.
3. **Las reglas de negocio se escriben UNA sola vez**, en `packages/shared` (dinero, ventas, caja, informes, permisos, fechas). No dupliques cálculos en una app.
4. **Nunca se edita una migración ya publicada.** Se agrega otra.
5. **Nunca se borra historial financiero**: se corrige con registros nuevos.
6. Si cambias algo que ya usan los dispositivos en la tienda, recuerda que habrá **versiones mezcladas** (PC actualizada, teléfono viejo) durante un tiempo: el cambio debe tolerarlo.
7. Actualiza la documentación (este directorio) en el **mismo** cambio.

## 1. Dónde cambiar cada configuración

| Qué quieres cambiar | Dónde | Notas |
|---|---|---|
| Cadena de MongoDB, secreto de sesiones, puerto, orígenes web | Variables de entorno de la API (`apps/api/.env` o panel de Render) | Reiniciar la API. Cambiar `JWT_SECRET` cierra todas las sesiones y anula los tokens de terminal |
| Dirección de la API en la PC | Ajuste `apiUrl` en `config.json` de la PC (carpeta `%APPDATA%\Esoterica Amara`) o pantalla de Configuración | Debe empezar con `http://` o `https://`; se normaliza sin `/` final |
| Dirección de la API en el teléfono | `apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL`) y generar APK nuevo; o escribirla en la pantalla de inicio de sesión | Si contiene `CAMBIAR` se ignora |
| Dirección de la API en la web | `VITE_API_URL` al compilar | Debe estar en `CORS_ORIGINS` de la API |
| Impresora, ancho de papel (58/80), impresión automática, pie del ticket, etiquetas | `config.json` de la PC (`ticketPrinter`, `paperMm`, `autoPrint`, `ticketFooter`, `labelPrinter`, `labelWidthMm`, `labelHeightMm`) | Ver [INSTALACION_WINDOWS.md](INSTALACION_WINDOWS.md) |
| Frecuencia y conservación de respaldos, destinos | `config.json` de la PC (`backupDir`, `backupSecondaryDir`, `backupIntervalMin`, `retention`) | Valores validados (`normalizeSettings`): un archivo editado a mano con basura no rompe el programa, se corrige a valores válidos |
| Sensibilidad del escáner USB | `scannerMaxGapMs`, `scannerMinLength` | |
| Vincular teléfono (LAN) | `lanEnabled`; puerto en `LAN_PORT` (`packages/shared/src/lan-auth.ts`) | Cambiar el puerto exige actualizar PC y teléfonos |
| Exigir caja abierta para vender | Clave `require_open_cash` de la tabla `meta` (`'0'` = no exigir) | Recomendado dejarla exigida |
| Intervalos de sincronización y avisos del teléfono | `apps/mobile/src/config.ts` (`SYNC_INTERVAL_MS`, `OFFLINE_LOGIN_MAX_DAYS`, …) y `src/lib/staleness.ts` | |
| Zona horaria | `MX_OFFSET_MIN` en `packages/shared/src/time.ts` | Hoy UTC−6 fijo. Solo cambiar si México vuelve al horario de verano |
| Formato del folio | `buildFolio` en `packages/shared/src/ids.ts` | **No lo cambies con ventas existentes** sin pensar en la unicidad |
| Formato de códigos internos / QR | `buildInternalCode`, `buildQrValue`/`parseQrValue` en `ids.ts` | Cambiarlos invalida etiquetas ya impresas |
| Denominaciones de billetes y monedas | `MXN_DENOMINATIONS` en `packages/shared/src/cash.ts` | |
| Duración mínima/máxima de permisos temporales | `grantCreateSchema` en `packages/shared/src/schemas.ts` | Hoy 5 min – 24 h |
| Nombre del negocio en el ticket | `registerSale` (`business: 'Esotérica Amara'`) en `packages/database/src/local-store.ts` | Hoy escrito en el código |

## 2. Agregar una migración de SQLite

El esquema local vive en `packages/database/src/schema.ts`.

1. **No toques `V1`.**
2. Agrega una constante nueva (`V2`) con el SQL y añádela al **final** de `MIGRATIONS`:

```ts
const V2 = `
ALTER TABLE products ADD COLUMN notes TEXT;
`;
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'esquema_inicial', sql: V1 },
  { version: 2, name: 'productos_notas', sql: V2 },
];
```

3. `LocalStore.migrate()` aplica las migraciones pendientes **al abrir**, cada una dentro de una transacción y registrándola en `schema_migrations`. Es idempotente (hay una prueba: *"migraciones son idempotentes e integridad ok"*).
4. Reglas de SQLite que debes respetar:
   - `ALTER TABLE … ADD COLUMN` es fácil (la columna nueva debe ser opcional o tener `DEFAULT`).
   - Cambiar o quitar una columna, o ampliar un `CHECK` (por ejemplo agregar un método de pago), obliga a **recrear la tabla**: crear la nueva, copiar datos, borrar la vieja, renombrar y **volver a crear índices y triggers**. Los triggers de protección del historial impiden `DELETE`/`UPDATE` en esas tablas: una migración de este tipo debe **eliminar los triggers, hacer la copia y volver a crearlos**, y probarse con una copia de una base real.
   - Cada nueva tabla de historial financiero necesita sus triggers de protección.
5. **Prueba** con una copia de la base de producción **antes** de publicar: abre con la versión nueva, verifica `integrityCheck()` y que los datos siguen.
6. Actualiza [DICCIONARIO_DATOS.md](DICCIONARIO_DATOS.md).
7. Teléfonos y PC comparten esta migración (mismo paquete), pero se actualizan por separado: la API debe seguir aceptando operaciones de clientes en la versión anterior durante la transición.
8. **No hay retroceso automático.** Para volver atrás, restaura el respaldo previo a la migración.

## 3. Cambios en MongoDB (índices y colecciones)

- No existe un sistema de migraciones: los **índices** se crean al arrancar la API con `ensureIndexes()` en `apps/api/src/db.ts` (`createIndex` es idempotente).
- Para **agregar** un índice: añade la línea a `ensureIndexes()` y reinicia.
- Para **cambiar** un índice existente (por ejemplo hacer único el de `sales.folio`): `createIndex` con otras opciones **falla**. Hay que borrar el índice anterior a mano (Atlas → Indexes, o `dropIndex`) y después reiniciar. **Antes de crear un índice único, comprueba que no hay duplicados** (si los hay, falla).
- Para **agregar una colección nueva**: añádela a `COLLECTIONS` y a este diccionario.
- Mantén las colecciones con `_id` = UUID de texto.

## 4. Agregar un permiso o cambiar los de un rol

Pasos (el archivo clave es `packages/shared/src/permissions.ts`):

1. Agrega el nombre al tipo `Permission`.
2. Inclúyelo en las listas de los roles que correspondan (`GERENTE`, `VENDEDOR`, `DESARROLLADOR`).
3. **En la API**, protege la ruta con `requirePerm('el.permiso')` (y `requireReauth` si es sensible). **Ocultar un botón NO es seguridad.**
4. En las apps, muestra/oculta la opción usando `can(role, 'el.permiso')`.
5. Si se evalúa sin conexión en el dispositivo (como cancelar o abrir caja), `LocalStore` ya llama a `can(...)`: agrégalo ahí también.
6. Actualiza [PERMISOS.md](PERMISOS.md) y las pruebas (*"permisos por rol…"*).
7. Recuerda: el **desarrollador nunca debe recibir permisos financieros**.

## 5. Agregar un nuevo tipo de operación sincronizada

Hoy: `sale.create`, `sale.adjust`, `stock.movement`, `cash.open`, `cash.movement`, `cash.close`. Para añadir uno (por ejemplo, altas de producto sin conexión) debes tocar **todos**:

1. `OpType` (`packages/shared/src/types.ts`) y el `z.enum` de `syncOpSchema` (`schemas.ts`).
2. El esquema Zod del `payload` en `apps/api/src/sync-payloads.ts`.
3. El manejador del servidor (`/sync/push`) con **idempotencia** por `opId`.
4. En `LocalStore`: crear la fila local + `enqueue(...)` **en la misma transacción**, y qué hacer en `markAck`.
5. Reglas de conflicto ([SINCRONIZACION.md](SINCRONIZACION.md)) y pruebas con el servidor simulado.

## 6. Actualizar dependencias

1. Respaldo y rama de Git nueva.
2. Revisa qué está desactualizado: `npm outdated`.
3. Actualiza **por grupos pequeños** y después `npm install`, `npm run typecheck` y las pruebas.
4. Casos delicados:
   - **Expo / React Native**: usa `npx expo install --fix` dentro de `apps/mobile` para que las versiones sean compatibles con el SDK (hoy SDK 54). Las actualizaciones de SDK pueden pedir un APK nuevo.
   - **Electron + `better-sqlite3`**: el módulo nativo debe reconstruirse para la versión de Electron (`npm run rebuild -w @amara/desktop`). Una versión nueva de Electron puede requerir otra de `better-sqlite3`.
   - **Node.js**: mantén una LTS. Las pruebas usan `node:sqlite` y ejecución directa de TypeScript (Node ≥ 22.18).
   - **`mongodb` (driver)**: lee las notas de versión y comprueba compatibilidad con Atlas.
   - **Zod**: el código usa Zod 3; saltar a otra versión mayor exige revisar esquemas.
5. **Fija versiones.** Después del primer `npm install` exitoso, **sube `package-lock.json` a Git** (hoy no existe) para que todos instalen exactamente lo mismo.
6. Revisa avisos de seguridad con `npm audit` (sin ejecutar `npm audit fix --force` a ciegas).

## 7. Publicar en GitHub sin secretos

El `.gitignore` ya excluye: `node_modules/`, `dist/`, `build/`, `out/`, `release/`, `.expo/`, `.env`, `.env.*` (salvo `.env.example`), `*.log`, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, `*.db`, `backups/`, `coverage/`. `apps/mobile` tiene además su propio `.gitignore`.

### Antes del primer `git push`

```powershell
git status                       # ¿aparece algún .env o .sqlite? NO debe aparecer
git ls-files | Select-String -Pattern "\.env$|\.sqlite|\.db$|backups"   # debe estar vacío
git grep -nIE "mongodb(\+srv)?://[^<\s]+:[^@\s]+@"                       # busca cadenas con contraseña
git grep -nIE "JWT_SECRET\s*=\s*\S{16,}"                                 # busca secretos
```

Los dos últimos solo deben encontrar **ejemplos** (como `USUARIO:CONTRASENA` en `.env.example`), nunca valores reales.

### Pasos

1. Crea el repositorio en GitHub como **Private**. **No** marques "Add README" si ya tienes uno local.
2. Desde la carpeta del proyecto:

```powershell
git add .
git status        # revisa la lista COMPLETA de archivos
git commit -m "Primera versión de Esotérica Amara"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/esoterica-amara.git
git push -u origin main
```

3. En GitHub, activa (en *Settings → Code security*) las alertas de secretos y de dependencias, si tu plan las ofrece.
4. **Los secretos de producción** (`MONGODB_URI`, `JWT_SECRET`) solo van en el panel de Render (variables de entorno), jamás en el repositorio.

### Si subiste un secreto por error

1. **Considéralo filtrado** aunque borres el archivo: el historial de Git lo conserva y puede haber sido copiado.
2. Cambia **de inmediato** la contraseña del usuario de Atlas y/o el `JWT_SECRET` ([SEGURIDAD.md](SEGURIDAD.md), sección 5).
3. Solo después, limpia el historial si quieres (requiere reescribirlo; consulta la guía de GitHub sobre eliminar datos sensibles).

## 8. Flujo recomendado de cambios

1. Rama nueva: `git switch -c arreglo-descripcion`.
2. Cambio pequeño + prueba + documentación.
3. `npm run typecheck` y pruebas.
4. Fusionar en `main`. Si afecta la API, Render redespliega al hacer push.
5. Si afecta la PC: generar instalador nuevo, **respaldo**, instalar, verificar ([INSTALACION_WINDOWS.md](INSTALACION_WINDOWS.md), sección 7).
6. Si afecta el teléfono: APK nuevo con `versionCode` mayor ([INSTALACION_ANDROID.md](INSTALACION_ANDROID.md), sección 3.4).
7. Sube el número de versión en los `package.json` involucrados.

## 9. Tareas periódicas

| Cada… | Tarea |
|---|---|
| Día | Revisar respaldos, pendientes de sincronización y conflictos |
| Semana | Copia externa (USB), `mongodump`, revisar uso de Atlas (512 MB) |
| Mes | Probar una restauración; ensayar una contingencia ([CONTINGENCIA.md](CONTINGENCIA.md)) |
| 6 meses | Revisar [SERVICIOS_GRATUITOS.md](SERVICIOS_GRATUITOS.md) contra las páginas oficiales; `npm outdated` y `npm audit` |
| Año | Revisar contraseñas, usuarios activos, terminales y dispositivos vinculados |
