# Respaldos y restauración

> Revisión: 22/10/2026.
> Verificado **leyendo el código** (sin ejecutarlo): `packages/database/src/local-store.ts` (`backupInto`, `logBackup`), `apps/desktop/src/main/backup.ts`, `database.ts`, `recovery.ts`, `paths.ts`, `src/shared/settings.ts` y `backup-rotation.ts`, `apps/desktop/build/installer.nsh`, y `apps/api/src/backup-mongo.ts`. **Ningún respaldo se ha creado ni restaurado todavía.** Los scripts de `scripts/windows/*.ps1` (tarea diaria) aún no existían al escribir esto: lo que dependa de ellos está **[por confirmar]**. Marcas: **[hardware]**, **[servicio externo]**, **[por confirmar]**.

## 1. Tres cosas distintas (no las confundas)

| Qué | Cuándo | Para qué sirve | Para qué NO sirve |
|---|---|---|---|
| **1. Guardado inmediato** | En cada venta/movimiento, antes de decir "guardado" | Que no se pierda nada si se va la luz o se cierra el programa | No protege si el disco o la PC se dañan |
| **2. Respaldo cada 2 horas** | Mientras el programa está abierto (por omisión cada **120 min**) | Volver a un punto reciente si la base se daña o se borra algo por error | Si la copia queda en el mismo disco, no protege de pérdida del equipo |
| **3. Respaldo diario verificado** | 1 vez al día, aunque el programa esté cerrado (tarea de Windows) | Tener un punto por día, verificado | Igual: depende de **dónde** se guarde |

Y además: la **copia en la nube** (MongoDB Atlas) de todo lo que ya se sincronizó, más un **respaldo propio de MongoDB** (sección 5).

> **Regla de oro:** un respaldo en el mismo disco que la base **no** protege contra daño del disco, robo, incendio o PC averiada. Siempre debe haber una copia **fuera** de la PC (USB, otra computadora, nube personal).

## 2. Guardado inmediato

Cada venta guarda en **una sola transacción** SQLite: venta, partidas, pagos, ticket, movimientos de inventario, operación de sincronización y auditoría. Se usa `PRAGMA journal_mode = WAL` y `synchronous = FULL`, así cada confirmación queda en disco. Si algo falla a medias, no se guarda nada (todo o nada). El operador solo ve "guardada" **después** del `COMMIT`.

## 3. Respaldos locales (SQLite)

### 3.1 Cómo se hacen (`apps/desktop/src/main/backup.ts`)

- **Cuándo:** cada `backupIntervalMin` (por omisión **120 min**) mientras el programa está abierto; **al abrir el programa si ya pasó ese tiempo** desde el último respaldo correcto (cubre respaldos omitidos con la PC apagada); **al hacer el corte de caja**; y **a pedido** (manual). La primera revisión ocurre unos 30 segundos después de abrir, y luego cada minuto.
- **Cómo:** copia consistente con `VACUUM INTO` (aunque la base esté abierta) a un archivo temporal `.partial`; se **abre y verifica** (`integrity_check` y tablas clave) y **solo entonces** se renombra al nombre final. Un respaldo que no pasa la verificación se descarta y se registra como fallido. **Nunca se sobrescribe un respaldo anterior** (si el nombre existe, se avanza un segundo).
- **Antes de copiar** comprueba que la carpeta se pueda escribir y que haya espacio libre (**2 × el tamaño de la base + 20 MB**); si no, falla con un mensaje claro.
- **Si falla**, reintenta como máximo cada 10 minutos, deja un **aviso persistente** en pantalla (y una notificación de Windows) y registra el error.
- **Segundo destino** (USB / carpeta externa): se copia el **mismo archivo ya verificado**, se verifica otra vez y se rota allí también. Si el USB no está, **se avisa** ("el respaldo principal está bien, pero la copia al segundo destino falló… ¿Está conectado el USB?").
- **Registro:** cada intento queda en la tabla `backups_log` (fecha, tipo, ruta, éxito, tamaño, verificado, error) y en un archivo de texto en `%APPDATA%\Esoterica Amara\logs\`.
- Tipos de respaldo registrados: `auto`, `manual`, `cierre` (al cortar caja), `cli` (tarea programada) y `segundo_destino`.
- *(Prueba escrita sin ejecutar: `local-store.test.ts` → "respaldo: VACUUM INTO crea copia consistente, restaurable y verificable". La clase `BackupService` y la rotación no tienen pruebas propias todavía.)*

### 3.2 Nombre, carpeta y conservación (valores por omisión de `settings.ts`)

| Ajuste | Por omisión | Significado |
|---|---|---|
| `backupDir` | `Documentos\Esoterica Amara\Respaldos` | Destino principal (**mismo disco** que la base: cámbialo o agrega el segundo destino) |
| `backupSecondaryDir` | vacío | **Segundo destino**: USB o carpeta externa/sincronizada. Recomendado siempre |
| `backupIntervalMin` | `120` (mín. 15, máx. 1440) | Cada cuántos minutos |
| `retention.keepRecent` | `24` | Siempre se conservan las 24 copias más recientes (≈ 2 días a razón de 1 cada 2 h) |
| `retention.keepDaily` | `14` | Además, la última copia de cada uno de los 14 días más recientes |
| `retention.keepMonthly` | `6` | Además, la última copia de cada uno de los 6 meses más recientes |

Nombre de archivo: **`amara_AAAA-MM-DD_HH-MM-SS.sqlite`**, con hora de México. Ejemplo: `amara_2026-10-22_13-45-10.sqlite`.

La **rotación** borra solo copias que **no** cumplan ninguna regla de conservación; **siempre sobrevive la copia más reciente**, y los archivos con otro nombre **nunca se tocan**. Además, antes de **migrar** la base a una versión nueva del programa se hace una copia en `%APPDATA%\Esoterica Amara\respaldos-internos\` (`pre-migracion-v<N>-<fecha>.sqlite`); esa carpeta **no se rota automáticamente**, así que puede crecer: límpiala a mano de vez en cuando.

### 3.3 Respaldo diario (tarea de Windows) **[por confirmar]**

El instalador registra una **tarea programada** que ejecuta `resources\scripts\instalar-respaldo-diario.ps1` y la quita al desinstalar. Según el diseño, la tarea invoca el programa con la opción de línea de comandos **`"Esoterica Amara.exe" --backup-now`**: si el programa ya está abierto, le pasa la orden y termina; si no, se abre **sin ventana**, respalda y sale con código 0 (correcto) o 1 (falló). Se usa *StartWhenAvailable*: si la PC estaba apagada a la hora programada, **intenta el respaldo en cuanto vuelva a estar disponible**. El propio instalador avisa: **"NO verificado en una instalación real: probar en Windows antes de entregar."** Los scripts `scripts\windows\*.ps1` los prepara otro proceso; revísalos cuando existan. Para comprobar la tarea:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "*Amara*" } | Format-List TaskName, State
Get-ScheduledTaskInfo -TaskName "<nombre que aparezca arriba>"
```

`LastRunTime`/`LastTaskResult` indican la última ejecución y su resultado (0 = correcto).

### 3.4 Verificar un respaldo

Un respaldo "creado" no es un respaldo "bueno" hasta abrirlo. Con el programa **cerrado**, abre PowerShell y ejecuta (requiere Node 22.13 o superior):

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('PRAGMA integrity_check').get());console.log(d.prepare('SELECT COUNT(*) AS ventas FROM sales').get())" "D:\Respaldos\amara_2026-10-22_13-45-10.sqlite"
```

Debe imprimir `integrity_check: 'ok'` y el número de ventas. *(No ejecutado aún.)*

## 4. Restaurar SIN borrar lo actual

**Principio:** nunca borres ni sobrescribas la base actual. Se **aparta**, no se elimina.

### 4.1 Restaurar en una base de PRUEBA (recomendado primero)

1. Copia el respaldo a una carpeta de trabajo, por ejemplo `C:\Temp\prueba`.
2. Verifícalo con el comando de la sección 3.4.
3. Con el programa **de desarrollo** (`npm run dev:desktop`) o con una instalación de prueba en otra cuenta de Windows, coloca esa copia como base y revisa ventas, inventario y el último corte. **Así comprobaste que el respaldo sirve sin tocar la base real.**

### 4.2 Restaurar de verdad (la base actual está dañada o perdida)

1. **Cierra** el programa por completo.
2. Abre `%APPDATA%\Esoterica Amara` (ver [INSTALACION_WINDOWS.md](INSTALACION_WINDOWS.md), sección 3).
3. **Aparta** la base actual (y sus archivos `-wal` y `-shm`) a una carpeta con fecha, sin borrarlos:

```powershell
$d = "$env:APPDATA\Esoterica Amara"
$aparte = "$d\_apartada_$(Get-Date -Format 'yyyy-MM-dd_HH-mm')"
New-Item -ItemType Directory $aparte | Out-Null
Get-ChildItem $d -File | Where-Object { $_.Name -like "amara.sqlite*" } | Move-Item -Destination $aparte
```

> Los archivos `-wal`/`-shm` viejos **deben apartarse también**: si se quedan junto a una base restaurada, SQLite puede intentar aplicarlos y corromper el resultado.

4. Copia el respaldo elegido a esa carpeta **con el nombre que usa la base**: `Copy-Item "D:\Respaldos\amara_2026-10-22_13-45-10.sqlite" "$d\amara.sqlite"` (ajusta la ruta del respaldo).
5. Abre el programa. Revisa ventas del día, inventario, último corte y cola de sincronización.
6. Conserva la carpeta `_apartada_…` hasta estar seguro de que todo está bien.

### 4.3 ⚠ Riesgo importante al restaurar un respaldo VIEJO en la misma terminal

El folio de venta usa un contador por terminal y por día (`folio:<terminal>:<día>`) que **vive dentro de la base**. Si restauras un respaldo de las 10:00 y entre las 10:00 y la avería se hicieron ventas con folios hasta, digamos, `…-0035`, la base restaurada **volverá a asignar los folios `0021`, `0022`…** que ya existen en el servidor y en tickets impresos.

- En la base local no hay aviso, porque esas ventas viejas **no están** en la base restaurada.
- Al sincronizar, el servidor **sí lo detecta**: acepta la venta pero genera el conflicto `folio_duplicado` para el gerente (el índice de `folio` en MongoDB no es único, así que no la bloquea). El resultado son **dos ventas distintas con el mismo folio**, que habrá que aclarar a mano con los tickets impresos.

**Qué hacer:** después de restaurar un respaldo que no incluye todas las ventas hasta la avería, **no reutilices la identidad de esa terminal**: pide al gerente que registre/active una **terminal nueva** (código distinto) y úsala; o bien recupera primero las ventas faltantes. Es un riesgo conocido del diseño.

### 4.4 Qué se pierde al restaurar

Todo lo ocurrido **después** de la hora del respaldo y que no se haya sincronizado ni replicado. Ver la tabla de qué se puede y qué no se puede recuperar en [SINCRONIZACION.md](SINCRONIZACION.md), sección 7.

### 4.5 Recuperación automática si la base se daña (la hace el programa solo)

Al abrir, el programa comprueba la integridad de la base (`PRAGMA integrity_check`). **Solo si detecta corrupción** (no por otros problemas como un disco bloqueado):

1. Busca, del más reciente al más antiguo, un respaldo que **pase la verificación** en la carpeta principal, el segundo destino y `respaldos-internos`.
2. **No borra** la base dañada: la renombra a `amara.sqlite.danada-<fecha>` (junto con sus archivos `-wal` y `-shm`).
3. Copia el respaldo elegido, lo verifica de nuevo, y muestra un aviso: *"La base de datos estaba dañada y se restauró automáticamente desde el respaldo del <fecha>… pueden faltar operaciones…"*. Deja constancia en la auditoría (`sistema.restauracion_automatica`).
4. Si **no hay ningún respaldo válido**, no crea una base vacía encima: se detiene con un mensaje y deja el archivo dañado **intacto** para que un técnico lo revise.

**Consecuencias que debes entender:** (a) se pierde lo hecho después del respaldo elegido y no sincronizado; (b) aplica el **riesgo de folios repetidos** de 4.3; (c) conserva la base dañada para análisis: no la borres hasta que el negocio esté seguro. *(Hay lógica de selección con prueba escrita en el diseño del programa, pero no se ha ejecutado.)*

## 5. Respaldos de MongoDB Atlas

### 5.1 Lo que ofrece el plan gratuito (según la documentación oficial del 22/10/2026)

La página oficial de límites dice que **se pueden habilitar respaldos en clusters gratuitos** (una instantánea diaria, hasta cuatro conservadas). Esto **contradice** el comentario de `apps/api/src/backup-mongo.ts` (que afirma que el plan gratuito no incluye respaldos administrados) y lo que mucha gente asume. **No des por hecho ninguna de las dos versiones:** verifica en tu consola de Atlas si la opción existe y está activada, y no sustituyas con ella tu propia copia. Más detalle en [SERVICIOS_GRATUITOS.md](SERVICIOS_GRATUITOS.md).

### 5.2 Respaldo propio, verificable (recomendado)

Opción A — el script del proyecto (`apps/api/src/backup-mongo.ts`):

```powershell
npm run backup:mongo -w @amara/api
```

Necesita el `apps/api/.env` con `MONGODB_URI`. Qué hace (según el código):
- Crea una carpeta por ejecución, `BACKUP_DIR\<fecha-hora UTC>\` (por omisión `BACKUP_DIR=./backups`, relativo a la carpeta desde donde corre el comando; con `-w` es `apps/api/backups`, ya ignorada por Git), con **un archivo `.ndjson` por colección** (un documento JSON por línea) y un `manifest.json`.
- **Verifica** cada archivo releyéndolo (número de líneas, JSON válido con `_id`, SHA-256) y registra el resultado en `backups_log` (visible en `GET /admin/backups`). Termina con código 1 si algo falla.
- **No borra respaldos antiguos** (hazlo tú) y **no hay un script de restauración**: la restauración se hace con `mongoimport` (sección 5.3).
- Los archivos contienen **hashes de contraseñas y datos del negocio**; en Linux/macOS se crean con permisos restringidos, en Windows protege la carpeta tú.

Opción B — herramientas oficiales (`mongodump`), independiente del proyecto. Instálalas (`winget install MongoDB.DatabaseTools`) y ejecuta, usando la cadena de conexión del **mismo** usuario de la API:

```powershell
$fecha = Get-Date -Format "yyyy-MM-dd"
mongodump --uri="mongodb+srv://USUARIO:CONTRASENA@cluster0.xxxxx.mongodb.net/amara" --db=amara --gzip --out="D:\Respaldos-Mongo\$fecha"
```

- No se puede usar sobre la base `admin` ni con `--dumpDbUsersAndRoles`/`--oplog` en el plan gratuito (no los necesitamos).
- Los **usuarios de Atlas** no forman parte de la copia (se recrean a mano).
- La copia contiene **datos del negocio y hashes de contraseñas**: guárdala en un lugar privado y **nunca en GitHub** (`backups/` ya está en `.gitignore`).
- Frecuencia sugerida: **una vez a la semana** como mínimo y **antes de cualquier cambio grande**. Puedes programarla con el Programador de tareas de Windows.

### 5.3 Restaurar MongoDB sin pisar lo actual

Restaura **primero a otra base** para comprobar (`amara_restaurada`), nunca sobre `amara`.

**Desde una copia de `mongodump` (opción B):**

```powershell
mongorestore --uri="mongodb+srv://USUARIO:CONTRASENA@cluster0.xxxxx.mongodb.net" --gzip --nsFrom="amara.*" --nsTo="amara_restaurada.*" "D:\Respaldos-Mongo\2026-10-22"
```

**Desde los `.ndjson` del script (opción A)**, una colección a la vez (los documentos usan `_id` de texto y fechas ISO de texto, así que el JSON simple basta):

```powershell
mongoimport --uri="mongodb+srv://USUARIO:CONTRASENA@cluster0.xxxxx.mongodb.net" --db=amara_restaurada --collection=sales --file="D:\...\sales.ndjson"
```

Revisa `amara_restaurada` en Atlas (ojo: el almacenamiento total del plan gratuito es 512 MB). Para usarla de verdad, cambia `MONGODB_DB` a `amara_restaurada` en la API (y reinicia) o copia lo necesario. **No uses `--drop` contra `amara`** sin tener otra copia. *(Comandos sin probar; confirma la sintaxis con `mongorestore --help`/`mongoimport --help` de la versión instalada.)*

### 5.4 Después de restaurar MongoDB

Las existencias de `stock` pueden no coincidir con los movimientos: la API incluye `reconcileStock` (ruta `POST /inventory/reconcile`, permiso `sync.conflictos`) que recalcula las existencias sumando los movimientos. Pruébalo primero en modo simulado (`dryRun=true`), que solo informa diferencias sin corregir.

## 6. Teléfonos

La documentación y el código revisados no incluyen un respaldo automático de la base del teléfono. Trata el teléfono como un dispositivo cuya información importante **debe sincronizarse a la nube** cuanto antes; no hay respaldo local del teléfono hacia otro lugar **[por confirmar en `apps/mobile`]**.

## 7. Qué hacer si un respaldo falla

El programa debe mostrar la fecha y resultado del último respaldo y avisar si falló (`backups_log.ok = 0` con su `error`). **[por confirmar la pantalla exacta]**

| Mensaje / síntoma | Causa probable | Qué hacer |
|---|---|---|
| "Disco lleno" / espacio insuficiente | Sin espacio | Libera espacio, baja `retention.keepRecent`, o cambia `backupDir` a otro disco |
| No se encuentra la carpeta / USB | Destino desconectado | Conecta el USB; revisa la letra de unidad; corrige `backupSecondaryDir` |
| "el archivo ya existe" | El nombre lleva segundos; dos respaldos en el mismo segundo | `backupInto` se niega a sobrescribir (por diseño); repetir el respaldo un instante después |
| Verificación falla (`integrity_check` ≠ ok) | Disco con problemas o copia incompleta | No uses esa copia; haz un respaldo manual inmediato; revisa el disco |
| No hay respaldos recientes | Programa cerrado o tarea no registrada | Abre el programa; revisa la tarea programada (sección 3.3) |

**Respaldo manual de emergencia** (programa **cerrado**):

```powershell
$d = "$env:APPDATA\Esoterica Amara"
$dest = "E:\Emergencia_$(Get-Date -Format 'yyyy-MM-dd_HH-mm')"
New-Item -ItemType Directory $dest | Out-Null
Copy-Item "$d\*" $dest -Recurse
```

Con el programa cerrado, copiar la carpeta completa (incluyendo `-wal` y `-shm`) es seguro. **Con el programa abierto no copies el archivo a mano**: usa el respaldo del programa.

## 8. Rutina recomendada

| Frecuencia | Acción | Quién |
|---|---|---|
| Cada día | Ver que el último respaldo sea de hoy y con resultado correcto | Gerente |
| Cada semana | Llevarse la **USB** o copiar a otro equipo; `mongodump` | Gerente |
| Cada mes | **Probar** una restauración en base de prueba (sección 4.1) | Quien mantiene el sistema |
| Antes de actualizar | Respaldo manual + sincronizar | Quien actualiza |
