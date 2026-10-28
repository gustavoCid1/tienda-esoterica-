# Escritorio v2: lo hecho, lo pendiente y los riesgos

Estado: **escrito y releído, NO compilado ni probado en Electron.** Este entorno no puede instalar dependencias ni compilar.
Lo único que se ejecutó fue la lógica pura y la prueba contra `LocalStore` con un sustituto mínimo de `vitest`
(mismas aserciones; ver "Pruebas"). No se corrió `tsc`, `electron-vite` ni `vitest` reales.

## Dependencias nuevas

Ninguna. No se tocó `package.json`.

## Archivos creados (`apps/desktop`)

Lógica pura (con pruebas):
- `src/shared/token-form.ts`: duración en minutos/horas, longitud 6 a 10, cuerpo de `POST /security/tokens`, textos.
- `src/shared/auth-grants.ts`: boletos de autorización de un solo uso (en memoria del main) y limitador de intentos.
- `src/shared/closure-ticket.ts`: datos y HTML del ticket de cierre de caja.
- `src/shared/permit-ticket.ts`: HTML del "TICKET DE PERMISO" (violeta).
- `src/renderer/lib/cart.ts`: carrito con existencias, líneas Extra, cargo de servicio de Limpia.
- `src/renderer/lib/seller-memory.ts`: última persona vendedora elegida (solo sugerencia).

Pantallas y componentes (sin pruebas automáticas):
- `renderer/components/`: `AuthPrompt`, `SellerPickModal`, `ExtraModal`, `HtmlFrame`, `DocPreviewModal`, `LabelPreviewModal`, `ExtraCategoriesCard`.
- `renderer/screens/Limpias.tsx`, `renderer/screens/Tokens.tsx`.
- `renderer/styles-v2.css` (nuevo; `styles.css` NO se modificó).

Pruebas (`apps/desktop/test/`): `cart`, `ticket-v2`, `closure-permit`, `token-form`, `auth-grants`, `authorization-flow`.

## Archivos modificados

`shared/ticket-format.ts`, `shared/label-html.ts`, `shared/settings.ts`, `shared/ipc.ts`, `main/printing.ts`, `main/ipc.ts`,
`renderer/state/PosState.tsx`, `renderer/screens/{Pos,Tickets,Cash,Labels,Inventory,Settings}.tsx`,
`renderer/components/{SaleModals,InventoryModals}.tsx`, `renderer/App.tsx`, `renderer/main.tsx`, `renderer/index.html`
(CSP: se añadió `frame-src about:` para el iframe de la vista previa).

## Qué se implementó (resumen por requisito)

1. **¿Quién vende?** Ventana antes del pago con gerentes y vendedores activos de la sucursal (de la base local). Se guarda `sellerId/sellerName`; el ticket NO lo imprime ("Atendió" sigue siendo quien cobra). Se recuerda la última elección solo como sugerencia. El main valida que el `sellerId` sea de la sucursal. Al vendedor se le ocultan `sellerId/sellerName` en consultas.
2. **Extra** por línea solo en categorías de `extraCategories`: monto + nota, línea `extra`, cantidad 1, sin inventario; se ve como "Extra: nota" en carrito, detalle y ticket.
3. **Ticket tras cobrar**: modal con vista previa; "Imprimir" manda las dos copias seguidas; "Guardar PDF" aparte (diálogo nativo). La venta se guarda antes de imprimir y reimprimir nunca crea venta. El mismo modal está en el archivo de tickets. `autoPrint` quedó en `false` por omisión.
4. **Existencias**: no se agrega más de lo disponible ni se vende en 0; "Sin existencia"; saldos negativos heredados se muestran como 0 con aviso "existencia por corregir"; `StoreError sin_existencia` tiene mensaje propio.
5. **Caja**: se muestra hora, monto y quién abrió. Cerrar exige autorización (contraseña de admin o token) con `verifyActionAuthorization`; se guarda quién autorizó. "Generar ticket de cierre" con vista previa e impresión (también por fila en el historial). El vendedor cierra a ciegas (sin esperado ni diferencia).
6. **Cancelar/devolver**: misma autorización. Gerente con su contraseña; vendedor con contraseña de admin o token `devolucion`/`cancelacion`. El vendedor solo ajusta ventas propias. Los extras no regresan existencias.
7. **Etiquetas**: casillas para nombre, precio y QR; modal de vista previa con "Imprimir" y "Guardar PDF". El código de barras y su texto siempre se imprimen.
8. **Limpias**: artículos, cantidades, cargo opcional de servicio (línea Extra ligada al primer artículo), método de pago; venta `type: 'limpia'` con ticket titulado LIMPIA e inventario. Vendedor solo con contraseña de admin o token `limpias`; la autorización queda en la venta.
9. **Tokens** (solo gerente, en línea): propósitos, duración, sucursal, usos máximos, longitud hasta 10; el código se muestra UNA vez; "Ticket de permiso" violeta con rótulo y marco; lista y revocación.
10. **Ajustes** (solo gerente): categorías con Extra; `PUT /settings/extra-categories` con conexión, copia local siempre.

Notificaciones de mínimos: no se hicieron en escritorio (según lo pedido). El vendedor sigue sin ver totales, gráficas ni cortes.

## Diseño de la autorización (importante para quien revise)

La pantalla nunca fabrica una autorización. El main valida la contraseña/código (local con caché y, si hay red, `POST /security/verify`) y devuelve un **boleto opaco** guardado en memoria: de un usuario, un propósito, caduca a 10 min y se quema solo cuando la acción termina bien (si falla por otra razón se reintenta sin volver a teclear). La contraseña y el código no se guardan ni se registran. Hay límite de 5 fallos por minuto por usuario. Cerrar sesión borra los boletos. Si no se puede comprobar, se niega.

## Qué NO se hizo / pendiente

- Verificar todo en una máquina con dependencias: `npm install`, `tsc --noEmit` (tres tsconfig), `vitest run`, `electron-vite build`.
- Prueba manual de impresión real en la térmica (58/80 mm): dos copias seguidas, corte entre copias, ticket de cierre y ticket de permiso.
- Prueba manual del PDF (`printToPDF`) y del diálogo "Guardar como" en Windows.
- No hay pruebas automáticas de pantallas React ni del proceso main (IPC), solo de lógica pura y del `LocalStore`.
- Tokens: solo en línea; no se pueden crear ni revocar sin conexión (decisión del requisito). El listado de tokens depende del servidor.
- El ticket de permiso solo se puede imprimir al crear el token (el servidor no guarda el código). Reimprimirlo después no es posible por diseño.
- Texto de los avisos y colores no pasaron revisión visual.

## Supuestos

- `GET /security/tokens`, `POST /security/tokens`, `POST /security/tokens/:id/revoke`, `POST /security/verify`, `POST /auth/reauth` (cabecera `x-reauth`) y `PUT /settings/extra-categories` existen con la forma que ya tienen en `apps/api` y `packages/shared/src/schemas.ts`.
- `LocalStore.registerSale/closeCash/cancelSale/refundSale/verifyActionAuthorization/getClosure/getExtraCategories` se comportan como en `packages/database/test/v2.test.ts`.
- El cargo de servicio de una Limpia se modela como línea `extra` ligada al primer artículo (el modelo de venta no tiene un concepto de "servicio" sin producto).
- Los vendedores de la lista "¿quién vende?" salen de `users_local` (los usuarios que bajó el último pull); un usuario nuevo no aparece hasta sincronizar.
- Un solo token de ≤10 caracteres sirve para cualquier acción sensible si trae el propósito correcto.

## Qué faltaría en `packages/*` (no se tocó)

- Un método de `LocalStore` para listar vendedores activos de una sucursal; hoy el main filtra `users_local` por su cuenta (`listSellers` en `main/ipc.ts`).
- Si se quiere reimprimir un ticket de permiso, el servidor tendría que guardar el código cifrado (hoy solo guarda hash, y es lo correcto por seguridad).

## Riesgos

- **Impresión real**: `webContents.print` con tamaños en micrones y papel continuo puede variar por controlador. Las dos copias son dos trabajos seguidos; si la impresora tarda, el orden se conserva por la cola interna pero no se probó.
- **Vista previa**: es un `iframe srcDoc` con CSP estricta; usa el mismo HTML que se imprime, pero el motor de impresión puede paginar distinto de la pantalla.
- **PDF**: `printToPDF` recibe el tamaño en pulgadas; con papel continuo (`auto`) se calcula una altura finita y podría cortar un ticket muy largo.
- **Tipos**: no se corrió `tsc`; es probable que haya errores de tipo menores (se hizo una revisión cruzada de imports y canales IPC, que no encontró faltantes).
- **Pruebas**: `authorization-flow.test.ts` usa `node:sqlite`; si la versión de Vitest no lo resuelve, las pruebas quedan "skipped" (no pasan en falso). Requiere Node 22.5 o superior.
- **Existencias heredadas negativas**: la interfaz las oculta como 0; el almacén las respeta. Quien las vea en reportes debe corregirlas con un conteo.

## Pruebas

`npm test -w @amara/desktop` (vitest). Nuevas: `cart` (existencias, extras, tope), `ticket-v2` (Extra, LIMPIA, sellerName no impreso, par de copias, etiquetas con opciones), `closure-permit` (ticket de cierre y de permiso), `token-form`, `auth-grants` (boletos, caducidad, límite), `authorization-flow` (LocalStore real: cierre y cancelación con autorización, propósito distinto, token vencido, Limpia, sin existencia, Extra sin inventario, ticket de cierre desde el corte guardado).

Aquí se ejecutaron esas pruebas con un sustituto propio de `describe/it/expect` sobre Node 22 y pasaron todas; **no** se corrió Vitest real.
