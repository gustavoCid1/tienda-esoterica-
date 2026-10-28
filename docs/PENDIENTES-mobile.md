# Pendientes y supuestos de `apps/mobile`

> Revisión: 22/10/2026. Esta app se escribió **sin poder instalar dependencias ni compilar** (registro npm bloqueado en el entorno). Nada de lo que depende de Expo, React Native, la cámara, la impresión o la red local se ha ejecutado. No debe darse por funcionando hasta cumplir la sección 1.

## 1. Qué se verificó y qué no

**Verificado en el entorno de generación**

- Lógica pura y de datos, con el ejecutor `node:test` (`cd apps/mobile && npm test`, necesita Node >= 22.18 por la ejecución directa de `.ts`): 35 pruebas que pasan, entre ellas:
  - aviso de datos desactualizados (`src/lib/staleness.ts`);
  - resumen sin conexión contra un `LocalStore` real (SQLite en memoria): vendido, cancelaciones, devoluciones, métodos de pago, pendientes y avisos;
  - regla de "el servidor gana y nunca se suma al local";
  - rangos de fechas, tarjeta de "ventas netas", lectura tolerante de `/stats/*`;
  - permisos temporales de entradas (vigencia, revocación, otra sucursal, reloj atrasado, nunca sincronizado), también contra `LocalStore`;
  - venta de emergencia sin caja abierta, con folio único, cambio, descuento de existencias locales, idempotencia por `saleId` y **recuperación tras reabrir el archivo SQLite**;
  - tabla de Code 128 (propiedades del estándar: suma 11, paridad, unicidad), carrito, pagos, bloqueo de intentos, caducidad del acceso sin conexión, QR de vinculación (caducidad y red local), ticket (HTML con 2 copias y escape).
- `tsc` estricto sobre `src/lib` y `test` (con tipos reales de `@amara/*` y de Node): sin errores.
- `tsc` sobre el resto de la app **con módulos de Expo/React Native sustituidos por `any`**: detecta identificadores inexistentes y usos incorrectos de `@amara/shared|database|sync`, pero **no** valida el uso de las APIs de React Native ni de Expo. No equivale a compilar.

**Sin verificar (requiere `npm install` y un teléfono/emulador)**

- Que Metro resuelva los paquetes del monorepo (`@amara/*` publicados como `.ts`) y las subrutas `@amara/shared/password`, `@amara/shared/schemas`, `@noble/hashes/*`.
- Todas las pantallas (nunca se renderizaron), la navegación de `expo-router` y el guardia de fases de `app/_layout.tsx`.
- Cámara y lectura real de códigos; impresión; enlace con la PC; `expo-secure-store`; `expo-sqlite` con `fromExpoSqlite`; NetInfo; build EAS.
- Rendimiento de scrypt en Hermes (ver 4.4).

### Primera ejecución recomendada

1. En la raíz: `npm install`. Después, en `apps/mobile`: `npx expo install --fix` (las versiones del `package.json` son las de Expo SDK 54 que conozco; `expo install --fix` las alinea con la versión exacta de SDK instalada) y `npx expo-doctor`.
2. `npm run typecheck -w @amara/mobile` y `npm test -w @amara/mobile`.
3. `npx expo start --android` en un teléfono real (Expo Go sirve para casi todo; **`usesCleartextTraffic` y los plugins de cámara solo se aplican en un build propio**: `eas build -p android --profile preview`).
4. Probar en este orden: arranque, inicio de sesión en línea, terminal, sucursal, escáner, venta, modo avión (venta, resumen local, reinicio de la app), reconexión.

## 2. Cambios necesarios fuera de `apps/mobile` (no se hicieron)

| Dónde | Qué falta | Por qué |
|---|---|---|
| `apps/api` / `docs/API.md` | Forma exacta de la respuesta de `GET /stats/today` | La app acepta `{ summary: SalesSummary, generatedAt? }` o un `SalesSummary` directo (`src/lib/stats-parse.ts`). Si el servidor responde otra cosa, la pantalla muestra datos locales y un aviso. |
| `apps/api` | `branchId=todas` (consolidado) en `/stats/today` y `/stats/summary` | Se envía `todas` cuando el gerente elige "Todas (consolidado)"; `branchScope` ya lo acepta, pero hay que confirmar que `/stats/*` lo usa. |
| `apps/api` | `GET /stats/summary?from&to` con días `AAAA-MM-DD` (hora de México) | Para ayer, 7 días, mes e intervalos personalizados (la app usa `dateRangeSchema`). |
| `apps/api` | Respuesta de `GET /cash/current?terminalId=` | La app lee `breakdown.expectedCents` (o `session.breakdown.expectedCents`). |
| `apps/api` | Respuesta de `POST /catalog/codes/next` | La app espera `{ code: string }` (o `internalCode`). |
| `apps/api` / administración | **Alta de terminales móviles** y emisión de su token | No hay ruta para que el teléfono se registre solo. Hoy el gerente crea una terminal `movil` y el ID/código se **teclean** en `app/terminal-setup.tsx`. Sería mejor un QR de activación desde la web con `terminalId`, `terminalCode` y token. |
| `apps/api` | Aceptar ventas con `cashSessionId: null` | El móvil pone `require_open_cash = 0` (no tiene cajón) y vende sin sesión de caja. Si el servidor las rechazara o no las contara en el corte, hay que decidir la regla. |
| `apps/api` | Aceptar el **token de terminal** también en `GET /sync/pull` | Es lo que prefiere la app para sincronizar (dura 400 días y funciona con la sesión vencida); si no, usa el token de sesión. |
| `apps/desktop` | Servidor LAN con `/pair`, `/ping`, `/scan`, `/replicate`, `/print` y su pantalla del QR de vinculación | `LanClient` ya existe en `@amara/sync`; el lado PC pertenece a `apps/desktop`. No se pudo comprobar. |
| `packages/shared` o `packages/database` | Parámetros de scrypt más ligeros para el verificador móvil | `hashPassword` usa N=2^15 (~32 MB). En teléfonos modestos con Hermes puede tardar muchos segundos al iniciar sesión sin conexión. Una variante con N=2^14 manteniendo el mismo formato (`verifyPassword` ya lee N/r/p de la cadena) bastaría. |
| `packages/database` | Marca de "venta de emergencia" / origen `movil` en `sales` | Solo informativo para reportes; hoy se distingue por terminal. |
| `packages/database` | Opción de `LocalStore.summary` sin el aviso fijo `mayBeIncomplete: true` | Es correcto como está; solo se anota que la app arma sus propios avisos. |

## 3. Requisitos del encargo: cubiertos y no cubiertos

**Escritos (sin ejecutar)**

- Inicio de sesión en línea (`POST /auth/login`) y sin conexión con verificador scrypt local (nunca la contraseña), bloqueo escalonado por intentos fallidos y caducidad a 30 días; tokens, token de terminal, llave LAN y verificadores solo en `expo-secure-store`.
- Selección de sucursal autorizada; terminal; guardia de navegación por fases.
- Inventario con búsqueda y filtros agotados/bajos; detalle con precio, existencia, sucursal y lugar.
- Escáner `expo-camera` (`CameraView` + `onBarcodeScanned`; `barcodeTypes`: code128, ean13, ean8, upc_a, upc_e, qr), resultado con variante/precio/existencia/sucursal, modo VENTA (1 unidad al carrito) y modo INVENTARIO (formulario: cantidad, sucursal, lugar, variante, motivo, tipo), alta de producto cuando no existe y hay permiso, captura manual, linterna.
- Venta de emergencia sin conexión: folio único, pagos mixtos, cambio, descuento de existencias locales, persistencia SQLite (WAL + `synchronous=FULL`), borrador del carrito persistente, idempotencia por `saleId`.
- Tickets: consulta, filtro por folio y periodo, reimpresión (servicio de impresión del teléfono, PDF compartible y "pedir a la PC que imprima las 2 copias"); si no hay impresora, queda guardado.
- Códigos: QR (`react-native-qrcode-svg`) y Code 128 (codificador propio + `react-native-svg`); reserva de código interno en línea.
- Entradas de mercancía solo con permiso temporal vigente (vendedor), con validación local por hora del dispositivo y **bloqueo si no se puede comprobar**.
- Vinculación con la PC (escaneo del QR, validación de caducidad y de dirección de red local), envío de lecturas con `LanClient` y confirmación de recibido.
- Estado de sincronización: última correcta, pendientes, rechazadas, conflictos, aviso de datos desactualizados; sincronización automática (`runSyncCycle`) al abrir, al volver a primer plano, al reconectar y cada 3 minutos con la app abierta.
- "Resumen de ventas de hoy" exclusivo del gerente (acceso oculto, ruta con redirección, el servidor igualmente da 403) con todo lo pedido; efectivo esperado en tarjeta aparte; datos locales claramente rotulados sin conexión; al reconectar usa solo el servidor.
- Archivos de proyecto: `package.json`, `app.json`, `tsconfig.json`, `eas.json` (perfil `preview` = APK), `babel.config.js`, `metro.config.js`, íconos derivados del logo.

**No cubierto**

- Impresión **directa** a impresoras térmicas Bluetooth o de red (ESC/POS, puerto 9100): requiere una biblioteca nativa (por ejemplo `react-native-thermal-receipt-printer`) y un *development build*. No se incluyó ni se probó. La app lo dice con honestidad en pantalla.
- Descuentos, cancelaciones, devoluciones, apertura/corte de caja y transferencias desde el móvil (el `LocalStore` los soporta; no hay pantallas).
- Sincronización con la app cerrada (no hay `expo-background-task`): solo con la app abierta.
- Resolución de conflictos (solo se listan; se resuelven en la web).
- Pruebas automáticas de pantallas (ni Jest/RNTL ni Detox/Maestro). Las pruebas cubren lógica y datos.
- iOS (no se configuró ni probó), modo oscuro, auditoría de accesibilidad.
- Selector de fecha nativo (se usan atajos y campos de texto `AAAA-MM-DD`).

## 4. Riesgos y supuestos sin verificar

1. **Versiones.** Las del `package.json` son de Expo SDK 54 (React Native 0.81, `expo-router` 6). Hoy puede haber un SDK más nuevo; si se actualiza, revisar sobre todo `expo-router` (`useRootNavigationState`, `Tabs.sceneStyle`), `expo-camera` y `expo-print`.
2. **Metro + workspaces.** Se confía en la detección automática de monorepo (SDK 52+) y en `unstable_enablePackageExports`. Si falla la resolución de `@amara/*`, probar `watchFolders` y `nodeModulesPaths` manuales en `metro.config.js`. Los paquetes importan con extensión `.ts`; Metro lo admite, pero no se probó.
3. **Cámara y códigos.** `barcodeTypes` es una petición, no una garantía: la lectura real depende del equipo, el enfoque, la luz y la etiqueta. UPC-A puede llegar como EAN-13 con `0` delante (la búsqueda prueba ambas formas). El Code 128 generado **no se ha leído con un lector físico**; la tabla y la suma de verificación se probaron solo por propiedades. En pantalla, los módulos se ajustan a píxeles enteros, pero escanear una pantalla con un lector láser puede fallar; para etiquetas impresas usar la web o la PC.
4. **scrypt en Hermes.** `hashPassword`/`verifyPassword` son JavaScript puro (N=2^15). Pueden tardar varios segundos y bloquean el hilo de JS (el spinner nativo sigue girando). Si en un teléfono real pasa de ~5 s, aplicar el cambio de la sección 2.
5. **Reloj del dispositivo.** La vigencia local de permisos temporales confía en la hora del teléfono, con tres defensas (marca de agua del reloj, hora del último pull, antigüedad máxima de permisos de 24 h). Quien adelante el reloj puede alargar un permiso hasta la siguiente sincronización; el servidor revalida al sincronizar. Corregir un reloj que estaba adelantado exige una sincronización correcta (reinicia la marca de agua).
6. **HTTP en claro.** `usesCleartextTraffic: true` (necesario para el enlace LAN en HTTP) también permite que la API se use por `http://`. En producción, usar siempre `https://` para la API.
7. **Impresión.** `expo-print` resuelve cuando el sistema aceptó el trabajo, no cuando salió el papel. La app marca el ticket como impreso en ese momento y lo avisa en pantalla.
8. **Resumen local.** `LocalStore.summary` solo conoce lo que el teléfono tiene (sus ventas y las replicadas por la PC); las de otras terminales aparecen solo en el resumen del servidor. Por eso siempre se rotula como posiblemente incompleto.
9. **Sucursal nueva sin internet.** Elegir una sucursal por primera vez requiere conexión (hace falta su código para los folios y su catálogo).
10. **Folios.** El código de terminal (1 a 3 caracteres) debe ser único en todo el sistema; la app lo valida solo en formato. Un código repetido produciría folios repetidos.
11. **Seguridad de la sesión.** La sesión (incluido el token) se guarda en SecureStore para sobrevivir reinicios; cerrar sesión la borra. No hay bloqueo por inactividad ni biometría.
