# Pendientes y supuestos de `apps/mobile` (versión 2)

Estado: el código se escribió SIN poder ejecutar `npm install`, compilar ni probar en un teléfono o emulador. No se afirma que compile ni que funcione. Antes de usarlo: `npm install`, `npx expo install --fix` (alinea versiones), `npm run typecheck` y `npm test` en `apps/mobile`.

Lo único comprobado en este entorno:

- `npm test` (`node --test`): 77 pruebas pasan. Cubren la lógica pura de `src/lib` y flujos reales contra `LocalStore` (autorización de cierre/devolución/cancelación, bloqueo de ventas sin existencia, alertas sin repetición, agregación de gráficas, armado de tickets de cierre y permiso, etiquetas, formulario de tokens, carrito con extras).
- Un `tsc --strict` sobre `src/lib/*.ts` solo mostró errores de entorno (`TextEncoder`, `@noble/hashes` sin instalar). Los archivos `.tsx` y `src/services` (React Native, Expo) NO se pudieron revisar con el compilador.

## Dependencias nuevas (`apps/mobile/package.json`)

Los rangos `~` son estimaciones para Expo SDK 54; `npx expo install --fix` debe corregirlos.

- `expo-notifications ~0.32.0` (notificación local de existencias; permiso de Android 13).
- `expo-task-manager ~14.0.0` y `expo-background-task ~1.0.0` (revisión periódica en segundo plano).
- `react-native-webview 13.15.0` (vista previa de tickets, etiquetas, cierre y permiso con el mismo HTML que se imprime).
- `qrcode ^1.5.4` (matriz del QR para etiquetas, vía `qrcode/lib/core/qrcode`).
- Ya existían y se usan: `react-native-svg` (gráficas dibujadas a mano), `expo-print`, `expo-sharing`.

`app.json`: plugin `expo-notifications` y permiso `POST_NOTIFICATIONS`. `index.ts` importa `src/services/background-alerts` antes de `expo-router/entry` (la tarea debe definirse al cargar el módulo).

IMPORTANTE: `react-native-webview`, `expo-notifications` y `expo-background-task` NO funcionan en Expo Go de forma completa (las notificaciones y la tarea en segundo plano exigen un build de desarrollo o de producción con EAS). Hay que generar un build nuevo; un `expo start` con Expo Go no basta para probar estas partes.

## Archivos nuevos

`src/lib`: `charts.ts`, `series-local.ts`, `chart-geometry.ts`, `low-stock.ts`, `authorize.ts`, `documents.ts`, `closure-data.ts`, `tokens-form.ts`, `labels.ts`, `misc-v2.ts`.
`src/services`: `qr.ts`, `notifications.ts`, `alerts.ts`, `background-alerts.ts`, `documents-service.ts`, `stats-series.ts`, `today.ts`, `employees.ts`.
`src/state`: `AlertsContext.tsx`. `src`: `hooks-v2.ts`, `types/qrcode-core.d.ts`.
`src/components`: `charts.tsx`, `SalesCharts.tsx`, `HtmlPreview.tsx`, `Sheet.tsx`, `AuthModal.tsx`, `DocPreview.tsx`, `PermitButton.tsx`, `SaleTicketView.tsx`.
`app/`: `admin.tsx`, `notifications.tsx`, `today.tsx`, `cash.tsx`, `adjust.tsx`, `tokens.tsx`, `limpias.tsx`, `extras.tsx`, `labels.tsx`, `product-sales.tsx`.
`test/`: `charts.test.ts`, `low-stock.test.ts`, `authorize-v2.test.ts`, `labels-tokens.test.ts`.

## Archivos modificados

`index.ts`, `package.json`, `app.json`, `app/_layout.tsx` (monta `AlertsProvider`, registra pantallas, el gerente entra al Panel administrativo una vez por inicio de sesión), `app/cart.tsx`, `app/ticket/[id].tsx`, `app/(tabs)/{home,more,scan,inventory}.tsx`, `src/state/CartContext.tsx`, `src/lib/cart.ts`, `src/lib/ticket-render.ts`, `src/services/api.ts` (cabeceras y `put`). `src/theme.ts` NO se tocó: solo se leen sus colores.

## Qué hace cada punto del contrato

1. Panel administrativo (solo gerente): "Mis ventas" de hoy y gráficas generales (pastel, líneas, barras dibujadas con SVG; el tipo se recuerda por usuario en la tabla `meta` local). En línea usa `/stats/top-products-series`; sin conexión calcula con datos locales y lo rotula como posiblemente incompleto.
2. Ventas del producto (gerente): desde el detalle de inventario, gráfica del mes (líneas/barras) y últimas ventas del mes.
3. Notificaciones (gerente): lista y contador de productos en o bajo su mínimo; en línea `low-stock`, sin conexión `LocalStore`. Notificación LOCAL al abrir la app o sincronizar, sin repetir la misma alerta (el estado se guarda por usuario y sucursal, y solo si la notificación se mostró de verdad). Tarea periódica en segundo plano si el sistema la permite.
4. Tickets de hoy: solo lo vendido (producto, cantidad, precio) e importe; el ticket completo solo con el botón. Botones de ticket de cierre y de ticket de permiso (violeta).
5. Caja: apertura con hora y monto; el cierre EXIGE contraseña de administrador o token (local y, si hay red, `/security/verify`); resumen y ticket de cierre.
6. Devoluciones y cancelaciones con la misma autorización.
7. Cobro: ventana para elegir quién vende (se guarda, no se imprime), botón Extra por categorías, bloqueo de ventas sin existencia o de más, negativos heredados mostrados como 0 con aviso "por corregir", manejo de `sin_existencia`, vista previa del ticket con Imprimir (las dos copias seguidas) y Compartir/guardar PDF.
8. Etiquetas: vista previa de la hoja, mostrar/ocultar nombre, precio, QR y código de barras, Imprimir y PDF.
9. Limpias: artículos y cantidades, cargo por servicio opcional, pago; venta de tipo `limpia`. El vendedor solo con contraseña de administrador o token `limpias`.
10. Extras (administrador): `GET/PUT /settings/extra-categories`.
11. Tokens (administrador, en línea): crear (con confirmación de contraseña vía `/auth/reauth` y `x-reauth`), código de 6 a 10 caracteres visible una sola vez, listar y revocar.

## Verdad sobre las notificaciones

Sin FCM/Expo Push NO existe aviso en tiempo real con la app totalmente cerrada. Lo que sí hay: aviso local al abrir o sincronizar, y una tarea periódica (`expo-background-task`, que usa WorkManager) que Android ejecuta cuando quiere (mínimo ~15 minutos, aplazable por ahorro de batería o por el fabricante) y que necesita conexión para sincronizar. La app lo dice en la pantalla de Notificaciones. Para avisos reales haría falta un servicio push en el servidor, que no se hizo.

## Lo que NO se hizo

- Movimientos de caja (ingresos/egresos) en el móvil.
- Sincronizar el tipo de gráfica con `/prefs` (queda solo en el teléfono).
- Reimpresión del ticket de permiso después de salir de la pantalla (el código no se vuelve a consultar: el servidor solo guarda su hash).
- Push remoto (FCM / Expo Push).
- Edición del precio o de las ventas del producto desde la pantalla de ventas del producto.
- Pruebas automáticas de pantallas React Native (no hay entorno para ello).

## Supuestos

- El cargo por servicio de una limpia se guarda como una línea `extra` colgada de la variante del primer artículo (el contrato exige variante padre); por eso una limpia necesita al menos un artículo.
- El vendedor cuenta el efectivo "a ciegas" al cerrar caja (no ve esperado, diferencia ni totales); el gerente sí ve el ticket de cierre.
- Una autorización validada en línea se pasa al almacén como `authorizationTrusted`, porque el token puede no estar en la caché local.
- La forma de las respuestas de `/security/tokens`, `/settings/extra-categories`, `/stats/*` y `/sales/today-summary` se leyó del código de la API y se interpreta de forma tolerante.
- Los rangos de fechas y "hoy" usan la zona de México (`@amara/shared`).

## Riesgos (revisar primero en un teléfono real)

- Metro: `qrcode/lib/core/qrcode` (importación profunda) puede fallar al empaquetar; la declaración está en `src/types/qrcode-core.d.ts`. Si falla, cambiar a `qrcode-generator` o generar el QR con `react-native-qrcode-svg` por etiqueta.
- WebView: la vista previa usa `javaScriptEnabled={false}`; el aspecto de la hoja real depende de la impresora y del servicio de impresión de Android. Las térmicas Bluetooth normalmente no aparecen en el diálogo del sistema.
- Impresión: `Print.printAsync` no confirma que haya salido papel, solo que el sistema aceptó el trabajo. El tamaño de página de las etiquetas (`width`/`height` en puntos) debe probarse con la impresora real.
- Cámara: sin cambios en el escáner; se mantiene el permiso CAMERA ya existente.
- Notificaciones: el permiso de Android 13 se pide al entrar el gerente; si lo niega, la lista y el contador siguen funcionando pero no hay aviso. Con ahorro de batería agresivo la tarea periódica puede no correr.
- Rendimiento: `scrypt` (contraseñas) corre en el hilo de JavaScript y puede congelar la pantalla unos segundos al autorizar; la ventana muestra "Comprobando..." antes.
- Tipos: los `.tsx` y servicios no pasaron por `tsc`; es probable que haya errores menores de tipos o importaciones al primer `npm run typecheck`.
- Paquetes: no se tocó `packages/*`. Si el servidor no expone alguna ruta citada (p. ej. `/stats/product-series`), la app cae a datos locales con aviso.
