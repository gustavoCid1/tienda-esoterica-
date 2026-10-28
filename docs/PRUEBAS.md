# Pruebas: los 27 escenarios obligatorios

> Revisión: 22/10/2026.
> **Estado global: NINGUNA prueba se ha ejecutado.** Este repositorio se escribió sin acceso a npm: no se ha instalado nada, no se ha compilado, y ninguna prueba automatizada ni manual se ha corrido. Cada escenario trae el estado **"sin ejecutar"**. **No se inventa ningún resultado.** Cuando ejecutes una prueba, anota fecha, quién la hizo y el resultado en la columna de la tabla de la sección 3.

## 1. Cómo ejecutar las pruebas automatizadas

### 1.1 Preparación

```powershell
node -v          # 22.18 o superior (ver nota)
npm install
npm run typecheck
```

### 1.2 Paquetes `shared`, `database`, `sync` (ejecutor integrado de Node)

Los `package.json` de estos paquetes **no tienen script `test`**, así que `npm test` **no los ejecuta**. Lánzalos así desde la raíz:

```powershell
node --test packages/shared/test/sales.test.ts packages/shared/test/cash-reports.test.ts packages/database/test/local-store.test.ts packages/sync/test/sync.test.ts
```

Requisitos (por la documentación de Node; **no verificado ejecutando**): Node ≥ 22.18 (ejecuta TypeScript sin configuración) y `node:sqlite` (Node ≥ 22.13). Las pruebas de `database` y `sync` usan una base SQLite real (`node:sqlite`) con reloj simulado y un **servidor simulado** (`FakeServer`) en memoria: **no tocan MongoDB, la API ni la red**.

### 1.3 Móvil (script `test` propio)

```powershell
npm run test -w @amara/mobile
```
(ejecuta `node --test "test/*.test.ts"`).

### 1.4 Web (Vitest)

```powershell
npm run test -w @amara/web
```

### 1.5 API y escritorio (Vitest)

Tienen `vitest run` configurado pero, a la fecha, **sin archivos de prueba** (`apps/api/test/**` y las pruebas de `apps/desktop`). Con Vitest 2, si no encuentra archivos de prueba, `vitest run` **termina con error**; por eso `npm test` en la raíz puede fallar aunque no haya fallos reales. Si ocurre, agrega pruebas o la opción `passWithNoTests` en la configuración de Vitest.

### 1.6 Todo junto

`npm test` en la raíz ejecuta el script `test` de los *workspaces* que lo tengan (móvil, web, API, escritorio) pero **no** el de los paquetes. Usa los comandos 1.2 a 1.5.

## 2. Leyenda

- **Auto** = prueba automatizada existente en el repositorio (archivo y nombre exacto). Cubre solo la **lógica**, no el equipo real.
- **Manual** = procedimiento que hay que hacer a mano.
- **[hardware]** impresora, escáner, teléfono Android. **[servicio externo]** MongoDB Atlas, Render, cuenta de Expo.
- **Cobertura:** *Auto parcial* = la lógica de fondo tiene prueba pero falta la prueba de extremo a extremo.

## 3. Resumen

| # | Escenario | Auto (hoy) | Manual necesario | Estado |
|---|---|---|---|---|
| 1 | Gerente registra producto con dos tamaños | Parcial | Sí [servicio externo] | **sin ejecutar** |
| 2 | Existencias distintas en dos sucursales | Parcial | Sí | **sin ejecutar** |
| 3 | Etiqueta con código de barras y QR | Parcial | Sí [hardware] | **sin ejecutar** |
| 4 | Móvil escanea y reconoce la variante | Parcial | Sí [hardware] | **sin ejecutar** |
| 5 | Venta del vendedor actualiza inventario | Sí | Recomendado | **sin ejecutar** |
| 6 | Dos copias físicas del ticket | Parcial (formato) | Sí [hardware] | **sin ejecutar** |
| 7 | Falla de impresión no duplica la venta | Parcial | Sí [hardware] | **sin ejecutar** |
| 8 | Gerente ve el total del día en el móvil | Parcial | Sí [hardware][servicio externo] | **sin ejecutar** |
| 9 | El total sube al sincronizar una venta nueva | Parcial | Sí [servicio externo] | **sin ejecutar** |
| 10 | Vendedor no ve totales ni informes | Parcial (permisos) | Sí (API) | **sin ejecutar** |
| 11 | Permiso temporal y expiración | Sí | Recomendado | **sin ejecutar** |
| 12 | Corte de caja con fondo, movimientos y diferencia | Sí | Recomendado | **sin ejecutar** |
| 13 | Informe mensual y por fechas | Parcial | Sí (API) | **sin ejecutar** |
| 14 | PC sin internet: venta y ticket | Parcial | Sí | **sin ejecutar** |
| 15 | Escritorio sigue sin web ni servidor | Parcial | Sí | **sin ejecutar** |
| 16 | PC averiada: teléfono con último inventario | Parcial | Sí [hardware] | **sin ejecutar** |
| 17 | Teléfono vende sin conexión y conserva tras reiniciar | Parcial | Sí [hardware] | **sin ejecutar** |
| 18 | Pendientes se sincronizan sin duplicar | Sí (servidor simulado) | Sí (servidor real) | **sin ejecutar** |
| 19 | Conflictos de existencias documentados | Sí (servidor simulado) | Sí (servidor real) | **sin ejecutar** |
| 20 | Respaldo restaurable en base de prueba | Sí (copia) | Sí | **sin ejecutar** |
| 21 | Se identifica un respaldo fallido | Parcial | Sí | **sin ejecutar** |
| 22 | Vendedor sin acceso a endpoints administrativos | No | Sí (API) | **sin ejecutar** |
| 23 | Dos ventas simultáneas sin inconsistencia | Sí (una terminal) | Sí (dos terminales) | **sin ejecutar** |
| 24 | Tickets antiguos conservan precios | Sí | Recomendado | **sin ejecutar** |
| 25 | Estadísticas coinciden con lo persistido | Parcial | Sí | **sin ejecutar** |
| 26 | Distingue datos locales de sincronizados | Parcial | Sí | **sin ejecutar** |
| 27 | Resumen indica cuándo puede estar incompleto | Sí | Recomendado | **sin ejecutar** |

Prerrequisitos manuales comunes: API en marcha (`npm run dev:api`) con MongoDB Atlas, gerente creado con `npm run seed`, 2 sucursales, 2 terminales, un vendedor y un gerente de prueba, y un producto de prueba. Usa **datos de prueba**, nunca los reales.

---

## 4. Detalle por escenario

### 1. El gerente registra un producto con dos tamaños
- **Auto parcial:** `packages/database/test/local-store.test.ts` → *"catálogo: producto con dos tamaños y existencias distintas por sucursal"* (lee un producto con variantes "Chica" y "Grande" ya descargado); `apps/web/src/lib/forms.test.ts` → *"arma el cuerpo con importes en centavos y existencia inicial"*, *"reporta nombre vacío y costo inválido…"*.
- **No cubierto automáticamente:** la **alta real** en la API (`POST /catalog/products`) y en MongoDB.
- **Manual [servicio externo]:** (1) Inicia sesión en la web como gerente. (2) Catálogo → Nuevo producto: nombre "Vela de prueba", tipo, categoría, SKU único. (3) Agrega dos variantes: "Chica" (costo 40, precio 90) y "Grande" (costo 70, precio 150). (4) Guarda. (5) Verifica en Inventario que aparecen **ambas variantes** bajo un solo producto, cada una con su **código interno `AMA########`**, y en Atlas (*Browse Collections*) un documento en `products` y dos en `variants`. (6) Intenta crear otro producto con el **mismo SKU**: debe rechazarlo.
- **Esperado:** un producto, dos variantes, sin duplicar el producto por tamaño. **Estado: sin ejecutar.**

### 2. Existencias distintas en las dos sucursales
- **Auto parcial:** `local-store.test.ts` → mismo test (sucursal 1: 10 y 4; sucursal 2: 2 y 7; filtro "bajos" en la sucursal 2).
- **Manual:** al crear el producto del escenario 1, define existencia inicial: Chica = 10 en Sucursal 1 y 2 en Sucursal 2; Grande = 4 y 7. Revisa la tabla de Inventario filtrando por cada sucursal y el consolidado. Revisa `stock` en Atlas (un documento por variante y sucursal) y `inventory_movements` (un movimiento por cada existencia inicial). Inicia sesión como un usuario asignado **solo** a Sucursal 1: no debe ver la 2.
- **Estado: sin ejecutar.**

### 3. Etiqueta con código de barras y QR
- **Auto parcial:** `apps/web/src/lib/labels.test.ts` (valor del código, lotes, duplicados, advertencias, copias); `apps/mobile/test/lib-misc.test.ts` → *Code128* (tabla, suma de verificación, rechazo de caracteres no válidos); `packages/shared/test/cash-reports.test.ts` → *"folios, ids y QR"*.
- **Manual [hardware]:** (1) En la web, Generación de códigos → elige "Vela de prueba / Chica" → vista previa de etiqueta con nombre, variante, SKU, código de barras (Code 128) y QR, y precio. (2) Imprime en papel. (3) Verifica que el código de barras legible lo lee el escáner y que el QR contiene `amara:v1:<id>` (se puede leer con la cámara del teléfono). (4) Prueba imprimir un **lote** y **reimprimir**.
- **Estado: sin ejecutar.**

### 4. El móvil escanea el código y reconoce la variante
- **Auto parcial:** `local-store.test.ts` → *"lectura de códigos: barras, interno, QR y desconocido"*; `lib-misc.test.ts` → *"Códigos candidatos (UPC-A/EAN-13) y antirrebote"*.
- **Manual [hardware]:** con el APK/Expo Go: abre el escáner, apunta a la etiqueta del escenario 3 (código de barras y luego QR). Debe mostrar **variante, precio, existencia y sucursal**. Escanea un código inexistente: debe indicar que no existe (y ofrecer el alta solo a quien tenga permiso). Prueba también el formato real de tus etiquetas comerciales (EAN-13/UPC).
- **Estado: sin ejecutar.**

### 5. El vendedor registra una venta y el inventario se actualiza
- **Auto:** `local-store.test.ts` → *"venta: guarda todo, descuenta inventario y genera ticket con folio"* (venta de 3 piezas, total, cambio, folio `AMA-AP1-261022-0001`, existencias 8 y 3, la otra sucursal no cambia, ticket y auditoría).
- **Manual (recomendado):** en la PC, el gerente abre caja; el vendedor escanea 2 Chica + 1 Grande, paga en efectivo con billete mayor; verifica cambio, folio, ticket y que el inventario bajó. Tras sincronizar, verifica en Atlas: documento en `sales` y movimientos tipo `venta`.
- **Estado: sin ejecutar.**

### 6. Se producen dos copias físicas del ticket
- **Auto parcial:** `lib-misc.test.ts` → *"Ticket: texto, HTML con 2 copias y escape"* (móvil). Para escritorio existe `apps/desktop/src/shared/ticket-format.ts`, **sin prueba propia todavía**.
- **Manual [hardware]:** con la térmica conectada: haz una venta con `autoPrint` activo. Deben salir **dos tickets consecutivos** con el **mismo folio**, uno rotulado copia cliente y otro copia tienda, con: Esotérica Amara, sucursal, folio, fecha y hora, productos, cantidades, precios, subtotal, descuento, total, método de pago, recibido y cambio. Repite con papel de 58 mm y de 80 mm (cambiando `paperMm`).
- **Estado: sin ejecutar.**

### 7. Una falla de impresión no duplica la venta
- **Auto parcial:** `local-store.test.ts` → *"idempotencia: reintentar la misma venta no duplica nada"* (la venta se guarda antes de imprimir y repetir el mismo `saleId` devuelve la existente). El registro de error de impresión (`recordPrintFailure`) no tiene prueba propia.
- **Manual [hardware]:** (1) Apaga o desconecta la impresora. (2) Haz una venta: debe quedar **guardada** aunque la impresión falle y mostrar un aviso. (3) Conecta la impresora y **reimprime desde el archivo de tickets**. (4) Verifica que hay **una sola venta** con ese folio (archivo de tickets y, tras sincronizar, `sales` en Atlas) y que el inventario bajó **una sola vez**.
- **Estado: sin ejecutar.**

### 8. El gerente consulta el total de ventas del día en su móvil
- **Auto parcial:** `apps/mobile/test/lib-summary.test.ts` → *"resumen OFFLINE con LocalStore real: vendido, cancelaciones, devoluciones y métodos por separado"*, *"el efectivo esperado NO es lo vendido"*, *"explicación de ventas netas"*, *"rangos de fechas"*.
- **Manual [hardware][servicio externo]:** el gerente inicia sesión en el teléfono → "Resumen de ventas de hoy". Verifica: total vendido, ventas netas (con explicación), número de tickets, promedio, efectivo/tarjeta/transferencia/otros, cancelaciones y devoluciones por separado, última actualización, sucursal. Compara las cifras con la suma de los tickets del día en la web. Confirma que el **efectivo esperado** se muestra aparte del total vendido.
- **Estado: sin ejecutar.**

### 9. El total del día aumenta al sincronizarse una nueva venta
- **Auto parcial:** `lib-summary.test.ts` → *"al reconectar gana el servidor y NUNCA se suma al local (sin doble conteo)"*; `packages/sync/test/sync.test.ts` → *"sin internet… al volver se sincroniza sin duplicar"*.
- **Manual [servicio externo]:** (1) Anota el total en el teléfono. (2) Haz una venta de $90 en la PC y espera la sincronización (o fuerza la sincronización). (3) Refresca el resumen del teléfono: debe subir exactamente $90 y el número de tickets en 1. (4) Repite el refresco: **no** debe volver a subir.
- **Estado: sin ejecutar.**

### 10. El vendedor no puede consultar totales acumulados ni informes
- **Auto parcial:** `packages/shared/test/cash-reports.test.ts` → *"permisos por rol: vendedor sin finanzas, desarrollador sin finanzas"* (solo la matriz de permisos). **No existe prueba de los endpoints.**
- **Manual (API):** obtén un token del vendedor y del desarrollador y pide cada ruta financiera. Ejemplo en PowerShell:

```powershell
$api = "http://localhost:8080"
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType "application/json" -Body '{"username":"vendedor1","password":"CONTRASENA"}'
$h = @{ Authorization = "Bearer $($login.token)" }
foreach ($ruta in "/stats/today","/stats/summary?from=2026-10-01&to=2026-10-31","/stats/months?from=2026-01-01&to=2026-12-31","/stats/dashboard?from=2026-10-01&to=2026-10-31","/cash/sessions","/sales","/admin/audit") {
  try { Invoke-RestMethod -Uri "$api$ruta" -Headers $h | Out-Null; "$ruta -> RESPONDIÓ (MAL)" } catch { "$ruta -> $($_.Exception.Response.StatusCode.value__)" }
}
```
- **Esperado:** `403` en todas. Repite con el usuario **desarrollador** (también `403` en lo financiero). En las apps: el vendedor no ve el resumen del día ni gráficas ni cortes.
- **Estado: sin ejecutar.**

### 11. El gerente concede un permiso temporal y este expira
- **Auto:** `local-store.test.ts` → *"permiso temporal: vendedor da entrada solo con permiso vigente; expira; no hay doble registro"*; `cash-reports.test.ts` → *"permiso temporal: vigencia, sucursal, función y revocación"*; `apps/mobile/test/lib-misc.test.ts` → *"Entradas: gerente siempre; vendedor con permiso vigente"*, *"Entradas: bloqueos (vencido, otra sucursal, revocado…)"*, *"Entradas: NO se puede comprobar => bloquea"*; `apps/web/src/lib/ops.test.ts` → permisos temporales.
- **Manual (recomendado):** el gerente concede 5 minutos a un vendedor en la web; el vendedor registra una entrada en el teléfono (debe funcionar y quedar con vendedor y gerente autorizador); espera a que venza y repite (debe bloquearse); concede otro permiso y **revócalo** antes de que venza (tras sincronizar el teléfono, debe bloquearse). Prueba que el permiso **no** permite cortes de caja.
- **Estado: sin ejecutar.**

### 12. El gerente registra un corte de caja con efectivo inicial, movimientos y diferencia
- **Auto:** `local-store.test.ts` → *"corte de caja: esperado solo con efectivo; diferencia; no se puede reabrir ni editar"* (fondo $1,000 + venta en efectivo $90 − gasto $20 − retiro $300 = $770 esperados; contado $760 → diferencia −$10; tarjeta no suma al efectivo; el corte no se edita ni se borra); `cash-reports.test.ts` → *"efectivo esperado no suma tarjeta ni transferencia"*, *"desglose de billetes y monedas"*.
- **Manual (recomendado):** abre caja con $500; vende $90 en efectivo y $150 con tarjeta; registra un gasto de $20 y un retiro de $100; cuenta el efectivo con el desglose de billetes; cierra. Esperado: $500 + $90 − $20 − $100 = **$470**. Registra $460 contados → diferencia **−$10**. Verifica que el corte muestra fecha, sucursal, terminal, usuario, esperado, contado, diferencia, total por método y número de operaciones; y que no se puede reabrir.
- **Estado: sin ejecutar.**

### 13. Se genera un informe mensual y otro por fechas seleccionadas
- **Auto parcial:** `cash-reports.test.ts` → *"resumen: cancelaciones y devoluciones restan por fecha del registro"*, *"totales por mes y mejor mes"*, *"fechas de México"*; web: `dashboard.test.ts` (mes con mayor importe, barras), `dates.test.ts`.
- **Manual (API, con ventas de al menos dos meses):** `GET /stats/months?from=…&to=…`, `GET /stats/reports/monthly` y `GET /stats/summary?from=…&to=…&branchId=…`. Comprueba que el total del mes = suma de tickets del mes menos cancelaciones y devoluciones **registradas en ese mes**; que el rango por fechas respeta los límites del día en hora de México; que el informe se distingue de un corte real.
- **Estado: sin ejecutar.**

### 14. La PC pierde internet, registra una venta y conserva su ticket
- **Auto parcial:** `sync.test.ts` → *"sin internet: la venta se guarda y la cola queda pendiente; al volver se sincroniza sin duplicar"*; `local-store.test.ts` → *"persistencia: ventas y tickets sobreviven al cerrar y reabrir el archivo"*.
- **Manual:** desconecta el cable/Wi-Fi de la PC; haz una venta; imprime el ticket; cierra y abre el programa; busca el folio en el archivo de tickets (debe estar, con sus productos y precios). Reconecta y comprueba que pasa a "sincronizada".
- **Estado: sin ejecutar.**

### 15. El escritorio sigue funcionando si la web y el servidor dejan de responder
- **Auto parcial:** `sync.test.ts` → *"…ventas de otra terminal: base nueva + pendientes"* (simula servidor caído y ventas locales).
- **Manual:** (1) Con la PC ya sincronizada, apaga la API (o cambia `apiUrl` a una dirección inexistente). (2) Abre el programa y reinicia Windows. (3) Haz ventas, una entrada de mercancía (gerente), un movimiento de caja y un corte. (4) Todo debe funcionar. (5) Restablece la API: la cola se vacía sin duplicados.
- **Estado: sin ejecutar.**

### 16. La PC se avería y el teléfono trabaja con el último inventario local conocido
- **Auto parcial:** `local-store.test.ts` → *"los pulls del servidor no borran el efecto de ventas locales pendientes"*; `apps/mobile/test/lib-staleness.test.ts` (avisos de datos viejos).
- **Manual [hardware]:** (1) Sincroniza el teléfono. (2) Apaga la PC y quita internet. (3) En el teléfono: el gerente abre caja, el vendedor vende; el inventario del teléfono debe bajar con cada venta y **no volver** al valor de la mañana. (4) Debe mostrarse la advertencia de datos posiblemente desactualizados y la hora de la última sincronización. (5) Verifica que **no** se puede imprimir por la PC apagada.
- **Estado: sin ejecutar.**

### 17. El teléfono registra ventas sin conexión y las conserva después de reiniciar la aplicación
- **Auto parcial:** `local-store.test.ts` → *"persistencia: ventas y tickets sobreviven al cerrar y reabrir el archivo"* (con SQLite de Node, **no** `expo-sqlite`).
- **Manual [hardware]:** modo avión; vende 2 veces; cierra la app desde "aplicaciones recientes" y ábrela; los tickets y folios deben seguir; reinicia el teléfono y repite.
- **Estado: sin ejecutar.**

### 18. Las operaciones pendientes se sincronizan después sin duplicar ventas
- **Auto:** `sync.test.ts` → *"sin internet… sin duplicar"* y *"se corta la red DESPUÉS de que el servidor aplicó: el reintento no duplica"*; `local-store.test.ts` → *"cola: acuse aplica, duplicados e inconsistencias quedan documentadas"*. (Con **servidor simulado**.)
- **Manual [servicio externo]:** genera 5 ventas sin conexión; reconecta; corta la conexión a mitad de la sincronización (desconecta Wi-Fi unos segundos); reconecta. En Atlas, `sales` debe tener **exactamente 5** y el stock descontado **una vez**.
- **Estado: sin ejecutar.**

### 19. Los conflictos de existencias quedan documentados
- **Auto:** `sync.test.ts` → *"conflicto de existencias: se aplica la venta y queda documentado para el gerente"*; `local-store.test.ts` → *"cola: acuse aplica…"* (conflicto en `sync_conflicts`, no se duplica con acuse repetido) y *"stock negativo no bloquea la venta física pero avisa"*. (Servidor simulado.)
- **Manual [servicio externo]:** deja 1 pieza en el servidor; vende 3 desde una terminal desconectada; sincroniza. Esperado: la venta existe, el stock queda en −2, aparece un conflicto abierto para el gerente en la web con el detalle; el gerente lo resuelve con un ajuste con motivo; nada se borra.
- **Estado: sin ejecutar.**

### 20. Un respaldo local puede restaurarse en una base de prueba
- **Auto:** `local-store.test.ts` → *"respaldo: VACUUM INTO crea copia consistente, restaurable y verificable"* (crea copia, no sobrescribe, abre con `integrity_check = ok`, cuenta ventas). La rotación (`apps/desktop/src/shared/backup-rotation.ts`) **no tiene pruebas todavía**.
- **Manual:** sigue [RESPALDOS.md](RESPALDOS.md), secciones 3.4 y 4.1 (verificar con `integrity_check` y abrir en una instalación de prueba).
- **Estado: sin ejecutar.**

### 21. El sistema identifica un respaldo fallido
- **Auto parcial:** `local-store.test.ts` → mismo test registra un respaldo con `ok: false, error: 'Disco lleno'` y lo recupera con `listBackups`. **No** prueba que la pantalla lo muestre ni la detección de tarea omitida.
- **Manual:** configura `backupDir` en una USB, retírala y espera un ciclo de respaldo (o reduce `backupIntervalMin` a 15). Debe quedar un registro fallido y un aviso visible. Llena una carpeta pequeña (simulación) o apunta a una ruta inexistente. Apaga la PC a la hora de la tarea diaria y enciéndela: comprueba que el respaldo diario se intenta al volver ([RESPALDOS.md](RESPALDOS.md), 3.3).
- **Estado: sin ejecutar.**

### 22. El vendedor no puede acceder directamente a endpoints administrativos
- **Auto:** **ninguna** todavía (`apps/api/test` no existe). Existe `requirePerm` en `apps/api/src/auth.ts`.
- **Manual (API):** igual que el escenario 10 pero con rutas de escritura. Con el token del vendedor:

```powershell
foreach ($ruta in "/admin/users","/admin/branches","/admin/terminals","/admin/grants","/admin/conflicts","/admin/audit","/admin/backups") {
  try { Invoke-RestMethod -Uri "$api$ruta" -Headers $h | Out-Null; "$ruta -> RESPONDIÓ (MAL)" } catch { "$ruta -> $($_.Exception.Response.StatusCode.value__)" }
}
# Sin token debe dar 401; con token de vendedor, 403
try { Invoke-RestMethod -Method Post -Uri "$api/catalog/products" -Headers $h -ContentType "application/json" -Body '{}' } catch { $_.Exception.Response.StatusCode.value__ }
try { Invoke-RestMethod -Method Post -Uri "$api/sales/CUALQUIER-ID/cancel" -Headers $h -ContentType "application/json" -Body '{"reason":"prueba"}' } catch { $_.Exception.Response.StatusCode.value__ }
```
- **Esperado:** 401 sin token; **403** con token de vendedor en todas. Prueba también que modificar el rol en el almacenamiento local de una app **no** otorga acceso a la API (la API lee el rol de MongoDB).
- **Estado: sin ejecutar.**

### 23. Dos ventas simultáneas no causan una actualización inconsistente del inventario
- **Auto:** `local-store.test.ts` → *"ventas simultáneas: folios únicos e inventario consistente"* (8 ventas a la vez en una terminal: 8 folios distintos, existencia final correcta).
- **Manual [servicio externo]:** con 2 terminales (PC y teléfono) y la misma variante con 10 piezas: vende 1 pieza en cada una "al mismo tiempo" varias veces; sincroniza ambas. La existencia en el servidor debe ser 10 − (total vendido) exacta, y `inventory_movements` debe tener un movimiento por cada pieza. Para probar concurrencia del servidor, envía dos `POST /sync/push` simultáneos con ventas distintas de la misma variante.
- **Estado: sin ejecutar.**

### 24. Los tickets antiguos conservan sus precios originales
- **Auto:** `local-store.test.ts` → *"tickets históricos conservan precios aunque cambie el catálogo"* (cambia precio y nombre del producto; la venta y el ticket anteriores no cambian, la nueva usa el precio nuevo).
- **Manual (recomendado):** vende una pieza a $90, cambia el precio a $120 en la web, sincroniza la PC y reimprime el ticket antiguo: debe decir $90 y el nombre de entonces.
- **Estado: sin ejecutar.**

### 25. Las estadísticas coinciden con las ventas persistidas y las devoluciones registradas
- **Auto parcial:** `cash-reports.test.ts` → *"resumen: cancelaciones y devoluciones restan por fecha del registro"*; `local-store.test.ts` → *"resumen local…"*, *"cancelación y devolución restituyen inventario…"*; `apps/web/src/lib/ops.test.ts` → devoluciones.
- **Manual:** con un día de ventas de prueba (incluye 1 cancelación y 1 devolución parcial): suma a mano los tickets del día; compara con "Resumen de hoy" y el dashboard: vendido bruto, cancelaciones, devoluciones, netas, tickets y promedio; la utilidad bruta = netas − costo de lo vendido neto de devoluciones (considera sus limitaciones documentadas en `reports.ts`). Para revisar con SQL en SQLite local: `SELECT SUM(total_cents) FROM sales WHERE created_at >= ? AND created_at < ?` (con la base abierta en solo lectura).
- **Estado: sin ejecutar.**

### 26. El sistema distingue los datos locales de los datos sincronizados
- **Auto parcial:** `local-store.test.ts` → *"resumen local: marca que puede estar incompleto y cuenta pendientes"* (`source: 'local'`, `pendingOps`), *"cola: acuse aplica…"* (`sync_state`); `lib-summary.test.ts`.
- **Manual:** haz una venta sin conexión y revisa que en la lista/estado se vea **pendiente** y que el resumen diga que es **local**; al sincronizar debe pasar a **sincronizada** y el resumen cambiar a la fuente del servidor, con la hora de última sincronización.
- **Estado: sin ejecutar.**

### 27. El resumen de ventas del gerente indica cuándo la información puede estar incompleta
- **Auto:** `local-store.test.ts` → *"resumen local: marca que puede estar incompleto…"* (`mayBeIncomplete: true`); `lib-summary.test.ts` → *"servidor con pendientes locales: avisa que no están incluidas"*; `lib-staleness.test.ts` → umbrales de 1 h y 24 h.
- **Manual [hardware]:** (1) Con el teléfono sin conexión, abre "Resumen de ventas de hoy": debe indicar datos **locales**, última sincronización, **operaciones pendientes** y que puede faltar información de otras terminales. (2) Con conexión pero con operaciones propias sin enviar, debe avisar que no están incluidas. (3) Compara con el total real al terminar.
- **Estado: sin ejecutar.**

---

## 5. Registro de ejecución (rellenar)

| # | Fecha | Quién | Resultado (OK / falló / bloqueado) | Notas |
|---|---|---|---|---|
| 1 | | | | |
| … | | | | |

Reglas: no marques OK sin haberlo visto; si una prueba falla, **corrige el código o la prueba y anota qué pasó**; no borres un fallo del registro.

## 6. Pruebas que faltan por escribir (huecos conocidos)

- Pruebas de **rutas de la API** (permisos 401/403, reautenticación, idempotencia de `/sync/push`, estadísticas).
- Pruebas del **servidor real** contra una MongoDB (índices únicos, `$inc` concurrente, `reconcileStock`).
- Pruebas de **impresión** y de la **rotación de respaldos** del escritorio.
- Pruebas de interfaz de escritorio y móvil (hoy solo hay lógica pura).
- Pruebas del adaptador `expo-sqlite` (hoy se prueba con `node:sqlite`).
