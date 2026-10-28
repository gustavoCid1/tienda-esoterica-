# Instalación en Windows (PC del mostrador)

> Revisión: 22/10/2026. **Nada de esto se ha probado en una PC real ni con una impresora real.** Lo marcado **[hardware]** depende de tu impresora, escáner o equipo; lo marcado **[por confirmar]** depende de algo que solo se sabrá al instalar y probar. Lo demás está tomado de `apps/desktop/electron-builder.yml`, `apps/desktop/build/installer.nsh`, `apps/desktop/package.json` y `apps/desktop/src/shared/settings.ts`.

## 1. Lo que necesitas

| Qué | Nota |
|---|---|
| Windows 10 u 11, 64 bits | El instalador se genera para `x64` |
| Impresora térmica de tickets (58 u 80 mm) con su controlador instalado en Windows | **[hardware]** |
| Escáner de códigos USB que funcione como teclado | **[hardware]** |
| Conexión a internet | Opcional para vender; necesaria para sincronizar |
| Acceso de administrador de Windows | Solo si el instalador lo pide |

## 2. Dos formas de obtener el programa

### A. Instalar con el instalador (uso normal)

Quien mantiene el sistema genera el instalador (sección 8) y te entrega un archivo `.exe`. Normalmente se llama **`Esoterica Amara Setup 1.0.0.exe`** (nombre estándar de electron-builder; confírmalo al generarlo).

1. Haz doble clic en el instalador.
2. Si Windows muestra **"Windows protegió su PC"** (SmartScreen): el instalador **no está firmado** (un certificado de firma tiene costo y no se ha contratado). Si confías en quien te lo dio: **Más información → Ejecutar de todos modos**.
3. El instalador (NSIS) **no es de "un clic"**: te deja **cambiar la carpeta de instalación** y se instala **solo para tu usuario** de Windows (`perMachine: false`).
4. Se crean accesos directos en el **Escritorio** y en el **menú Inicio** ("Esoterica Amara").
5. El instalador también **registra una tarea programada de Windows para el respaldo diario** (ver [RESPALDOS.md](RESPALDOS.md)). Ese paso **no está verificado en una instalación real**.

### B. Ejecutar en modo desarrollo (solo para técnicos)

```powershell
npm install
npm run dev:desktop
```

## 3. Dónde se guardan tus datos (MUY IMPORTANTE)

| Qué | Dónde |
|---|---|
| **Base de datos SQLite** (ventas, inventario, caja, cola de sincronización) | **`%APPDATA%\Esoterica Amara\`** |
| Ajustes de la terminal (`config.json`) | La misma carpeta |
| Secretos/llaves del enlace con el teléfono | La misma carpeta (según el comentario del instalador) |
| Respaldos (predeterminado) | `Documentos\Esoterica Amara\Respaldos` |
| Programa instalado | La carpeta que elegiste al instalar (sin datos importantes) |

`%APPDATA%` normalmente es `C:\Users\TU_USUARIO\AppData\Roaming`. Para abrir la carpeta, pega esto en el Explorador de archivos:

```text
%APPDATA%\Esoterica Amara
```

**Por qué es seguro:** los datos están **fuera** de la carpeta del programa. Reinstalar o actualizar el programa **no los toca**, y el desinstalador está configurado para **no borrar los datos** (`deleteAppDataOnUninstall: false`). Los datos tampoco están en carpetas temporales.

**Archivos en `%APPDATA%\Esoterica Amara\` (según `apps/desktop/src/main/paths.ts`):** `amara.sqlite` (la base), `config.json` (ajustes), `terminal-token.bin` (credencial de la terminal, protegida con Windows), `lan-devices.json` (teléfonos enlazados), `etiquetas.json`, y las carpetas `respaldos-internos` (copias previas a migraciones) y `logs`. Para verlos:

```powershell
Get-ChildItem "$env:APPDATA\Esoterica Amara" -Recurse | Select-Object FullName, Length, LastWriteTime
```

Junto al archivo `.sqlite` puede haber dos archivos auxiliares con el mismo nombre terminados en `-wal` y `-shm`. **Forman parte de la base**: al copiarla "a mano", copia siempre los tres juntos y con el programa **cerrado** (o mejor, usa los respaldos del programa, que son copias consistentes).

> Importante: los respaldos que se guardan por omisión en **Documentos** están en el **mismo disco** que la base. No protegen si el disco se daña o la PC se pierde. Configura un **segundo destino** (USB o carpeta externa) — ver sección 6.

## 4. Primer arranque

1. Abre **Esoterica Amara**.
2. Si tu API ya está desplegada, escribe su dirección en los ajustes (`apiUrl`, por ejemplo `https://tu-api.onrender.com`; debe empezar con `http://` o `https://`). Vacío = la PC trabaja solo en local. **[por confirmar]** pantalla exacta.
3. Inicia sesión **con internet la primera vez** para que la PC descargue el catálogo, los usuarios y las sucursales. Sin esa primera sincronización la PC no tiene catálogo.
4. Elige la **sucursal** y la **terminal** (las crea el gerente en la web: [API.md](API.md), `/admin/terminals`).
5. El **gerente abre la caja** (fondo inicial). Mientras no haya caja abierta, las ventas se bloquean (`caja_cerrada`), salvo que se configure lo contrario.
6. Haz una **venta de prueba** y revisa el ticket (ver sección 5).

## 5. Impresora térmica (58 mm / 80 mm) **[hardware]**

El sistema imprime **dos copias de cada venta** (cliente y tienda), una tras otra, con el mismo folio. La venta se guarda **antes** de imprimir: si la impresora falla, la venta existe y se puede **reimprimir el mismo folio** sin crear otra.

### 5.1 En Windows

1. Conecta la impresora y **instala el controlador del fabricante**. Comprueba que aparece en *Configuración → Bluetooth y dispositivos → Impresoras y escáneres*.
2. Imprime la **página de prueba de Windows** (Propiedades de la impresora → *Imprimir página de prueba*). Si esta no sale bien, el problema es del controlador/cable, no del programa.
3. En *Preferencias de impresión* del controlador, elige el **tamaño de papel del rollo** (58 mm u 80 mm; muchos controladores lo llaman "Roll Paper 80mm" o "80 x 297"), márgenes en cero y, si existe, corte automático.
4. Anota el **nombre exacto** de la impresora tal como aparece en Windows.

### 5.2 En el programa (`config.json` / pantalla de Configuración)

| Ajuste | Valores | Para qué |
|---|---|---|
| `ticketPrinter` | Nombre **exacto** de la impresora; vacío = la predeterminada de Windows | Impresora de tickets |
| `paperMm` | `58` u `80` | Ancho de papel (por omisión 80) |
| `printPageSizeMode` | `driver` (usa el tamaño del controlador; **recomendado**) o `medido` (mide el alto del ticket) | Si `driver` corta mal o deja mucho blanco, probar `medido` |
| `autoPrint` | `true`/`false` | Imprimir las dos copias al guardar la venta (por omisión sí) |
| `labelPrinter`, `labelWidthMm`, `labelHeightMm` | Por omisión 50 × 30 mm | Etiquetas de producto (distintas de los tickets) |
| `ticketFooter` | Texto | Pie del ticket (por omisión "Gracias por su compra") |

Haz la **prueba de impresión** desde el programa si existe la opción en tu versión y comprueba: logotipo/nombre, sucursal, folio, fecha y hora, productos, cantidades, precios, descuentos, total, forma de pago, recibido y cambio, y la leyenda "copia cliente"/"copia tienda".

**No se garantiza** que todos los modelos de impresora funcionen igual. Si el ticket sale cortado, cambia `paperMm`, el tamaño en el controlador o `printPageSizeMode`.

El ticket es un **comprobante interno**, no una factura (no es CFDI).

## 6. Escáner USB **[hardware]**

- Debe comportarse como **teclado**: al leer un código "teclea" los dígitos y termina con **Enter**. Casi todos vienen así; si no, consulta el manual del escáner (código de configuración "sufijo Enter").
- **Prueba:** abre el Bloc de notas, escanea un producto y comprueba que aparece el número y baja una línea.
- El programa distingue un escáner de una persona tecleando por la **velocidad**: ajustes `scannerMaxGapMs` (por omisión 50 ms entre teclas) y `scannerMinLength` (por omisión 4 caracteres). Si el programa no detecta bien las lecturas, sube un poco `scannerMaxGapMs` (máximo 200).
- Un lector convencional **láser/lineal normalmente solo lee códigos de barras, no QR**. Para QR se necesita un lector de imagen (2D) o usar la cámara del teléfono. Comprueba tu modelo.
- Códigos que acepta el sistema: código de barras comercial de la variante, código interno `AMA` + 8 dígitos, y el valor del QR `amara:v1:<id>`.

## 7. Cómo actualizar el programa **sin perder datos**

1. **Antes de nada, haz un respaldo manual** (ver [RESPALDOS.md](RESPALDOS.md)) y cópialo a una USB.
2. **Sincroniza** (si hay internet) para que no queden operaciones pendientes.
3. **Cierra** el programa por completo (también el ícono junto al reloj, si queda uno).
4. Ejecuta el **instalador de la nueva versión** sobre la anterior (misma carpeta). No hace falta desinstalar. Si desinstalas, tus datos **no se borran**, pero igual haz el respaldo.
5. Abre el programa. Si la nueva versión trae **migraciones** de base de datos, se aplican solas al abrir, dentro de una transacción.
6. Comprueba: ¿están tus ventas de hoy? ¿el inventario? ¿el último corte?

**Advertencia de regreso:** una vez que una versión nueva migra la base, **volver a la versión anterior puede fallar**. Por eso el respaldo del paso 1 es obligatorio. Para regresar: restaura ese respaldo con la versión anterior instalada ([RESPALDOS.md](RESPALDOS.md)).

## 8. Construir el instalador (quien mantiene el sistema)

Requisitos: Windows, Node.js 22, `npm install` hecho. El comando `dist` de `apps/desktop` ejecuta: reconstruir `better-sqlite3` para Electron → compilar → empaquetar con `electron-builder --win nsis --publish never`.

```powershell
npm run build:desktop
```

- El resultado queda en **`apps\desktop\release\`**.
- Reconstruir `better-sqlite3` (módulo nativo) puede requerir **Visual Studio Build Tools** (carga de trabajo "Desarrollo para el escritorio con C++") y Python si no existe un binario precompilado. **[no verificado]**; es el punto donde más probable es que aparezcan errores en la primera compilación.
- El instalador incluye el logotipo de tickets y los scripts de `scripts\windows\*.ps1` (respaldo diario) en `resources\scripts`.
- `--publish never`: no sube nada a ningún sitio.

## 9. Firewall y teléfono vinculado

Si activas el enlace con el teléfono (`lanEnabled`, por omisión sí), la PC escucha en la red local (puerto por omisión **47880**). La primera vez Windows pregunta si permites el acceso: elige **Redes privadas** (la del negocio), **no** "Redes públicas". El PC y el teléfono deben estar en la **misma red**. Esto **no funciona** si la red aísla a los clientes entre sí (algunas redes de invitados).

## 10. Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| `npm install` falla con `better-sqlite3` | Versión de Node distinta a la esperada; faltan herramientas de compilación (sección 8) |
| "Windows protegió su PC" | Instalador sin firma; ver sección 2.A |
| No imprime | Prueba de página de Windows; nombre exacto en `ticketPrinter`; que la impresora no esté "sin conexión" ni pausada en la cola de impresión |
| Ticket cortado o con mucho blanco | `paperMm`, tamaño de papel del controlador, `printPageSizeMode` |
| El escáner no hace nada | Pruébalo en el Bloc de notas; revisa el sufijo Enter; sube `scannerMaxGapMs` |
| "La caja está cerrada" | El gerente debe abrir la caja |
| Datos "desaparecidos" tras reinstalar | Revisa que abres con el **mismo usuario de Windows**: los datos están en `%APPDATA%` de **ese** usuario |
| Se agotó el espacio en disco | Los respaldos se rotan (ver [RESPALDOS.md](RESPALDOS.md)); libera espacio o cambia `backupDir` |


## Notas adicionales de comportamiento (según el código de `apps/desktop`, sin ejecutar)

- **Activación de terminal:** la primera vez, la PC debe activarse con el servidor (el gerente emite el token de terminal, válido 400 días y revocable); el token se guarda cifrado en `terminal-token.bin`.
- **Línea de comandos:** `"Esoterica Amara.exe" --backup-now` hace un respaldo y sale (lo usa la tarea programada; ver [RESPALDOS.md](RESPALDOS.md)).
- **Si la base se daña**, el programa intenta recuperarse solo desde el último respaldo válido (ver RESPALDOS.md, sección 4.5).
- **Impresión:** los tickets se envían a la impresora configurada; el resultado real depende de tu impresora **[hardware]**.
