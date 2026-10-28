# Contingencias: qué hacer cuando algo falla

> Revisión: 22/10/2026. Procedimientos basados en el comportamiento del código (`packages/database`, `packages/sync`, `apps/mobile/src/lib`). **Ninguno se ha ensayado en la práctica.** Se recomienda **ensayar cada escenario** una vez con datos de prueba antes de necesitarlo de verdad. Marcas: **[hardware]**, **[por confirmar]**.

## Regla general

> **Si dudas, no borres nada.** Anota en papel (folio, productos, total, forma de pago) las ventas que no puedas registrar y captúralas después. Nunca "arregles" un problema reinstalando el programa sin antes hacer un respaldo de `%APPDATA%\Esoterica Amara` ([RESPALDOS.md](RESPALDOS.md)).

## 1. Se cae el internet (la PC y el teléfono funcionan)

| Qué ocurre | Qué hacer |
|---|---|
| La PC sigue vendiendo | Nada especial: sigue vendiendo, imprimiendo y registrando. Cada venta queda **pendiente de sincronizar** |
| El programa muestra "sin conexión" / pendientes | Es normal. Los datos están guardados en la PC |
| Regresa internet | La sincronización se reintenta sola; **no vuelvas a capturar** nada. Espera a que los pendientes lleguen a 0 |
| El gerente en el celular | Ve un resumen **local** (solo lo que ese teléfono conoce) con advertencia "puede estar incompleto" |

**No se pueden hacer sin internet:** altas/ediciones de productos, cambios de precio, **transferencias entre sucursales**, gestión de usuarios y permisos temporales. Anótalos y hazlos al volver la conexión.

Límite honesto: mientras no hay internet, **cada terminal solo conoce lo que ella misma vendió**. Las existencias de las dos sucursales pueden desajustarse temporalmente (posible sobreventa). Al sincronizar, lo que quede en negativo se marca como **conflicto** para el gerente.

## 2. Se cae el servidor (API) o MongoDB Atlas

Igual que el punto 1: la tienda sigue vendiendo. Además:

- **Render gratuito dormido:** la primera conexión tarda ~1 minuto; puede aparecer "sin conexión" un momento.
- **Atlas pausado (30 días sin uso):** entra a Atlas y pulsa **Resume**.
- **Cuenta suspendida o servicio terminado:** exporta los datos que puedas (ver [RESPALDOS.md](RESPALDOS.md)) y migra (ver [DESPLIEGUE_API.md](DESPLIEGUE_API.md), sección 8).

## 3. La PC se avería

### 3.1 Primero evalúa qué se salvó

| Situación | Qué hacer |
|---|---|
| La PC enciende pero va mal | Haz **de inmediato** un respaldo manual de `%APPDATA%\Esoterica Amara` a una USB (con el programa cerrado) y de ahí trabaja |
| La PC no enciende pero el **disco está sano** | Saca el disco, conéctalo a otra PC (adaptador USB) y copia `%APPDATA%\Esoterica Amara` de ese usuario. Ahí está **todo**, incluso lo no sincronizado |
| El disco murió | Recupera el **último respaldo externo** (USB / otra computadora). Se perderá lo ocurrido después de su hora (sección 3.3) |

### 3.2 Seguir vendiendo mientras tanto: el teléfono como terminal de emergencia **[hardware]**

Funciona **solo si el teléfono ya había iniciado sesión con internet y sincronizado antes** (tiene catálogo y existencias de la sucursal).

1. **Revisa la advertencia de datos desactualizados** en la app (aviso a partir de 1 hora sin sincronizar; crítico a las 24 horas). Las existencias que ves son las de la **última sincronización más lo que este teléfono haya vendido** después; **no incluyen** lo que la PC vendió y nunca le envió.
2. **El gerente inicia sesión en el teléfono y abre la caja** del teléfono (con fondo inicial). Un vendedor **no puede abrir caja**, y mientras no haya caja abierta las ventas se bloquean.
3. El vendedor (o gerente) vende: escanea o busca, cobra, y la venta queda guardada **en el teléfono** con su **folio propio** (el código de terminal del teléfono es distinto al de la PC, así que los folios no chocan).
4. **Tickets:** quedan guardados y se pueden reimprimir. Imprimir **depende de tu impresora y teléfono** (la app usa la impresión del sistema Android) **[hardware]**; no se garantiza imprimir en la térmica, y **si la térmica está conectada a la PC averiada, el teléfono no puede imprimir a través de ella**. Si no se puede imprimir, anota el folio y entrega el comprobante de otra forma (el cliente puede recibir el ticket más tarde).
5. **Las ventas de emergencia se conservan** aunque cierres y abras la app (SQLite del teléfono).
6. **Descuentos, cancelaciones, devoluciones:** solo el gerente.
7. Conecta el teléfono a internet en cuanto puedas y sincroniza; así las ventas llegan a la nube y no dependen del teléfono.

### 3.3 Qué NO se puede recuperar

- Lo vendido en la PC **después del último respaldo** y **antes de haberlo enviado a la nube**, si el disco no se recupera y el teléfono nunca recibió esas ventas.
- El teléfono **no puede adivinar** ventas que nunca recibió. Si la PC y el teléfono estaban vinculados en la misma red, el teléfono pudo recibir réplicas de las ventas de la PC (modo teléfono–PC); eso reduce la pérdida, pero no la elimina.
- Las ventas se pueden reconstruir parcialmente con: tickets impresos (copia tienda), comprobantes de tarjeta/terminal bancaria, transferencias recibidas y el efectivo en caja.

### 3.4 Cuando llegue la PC nueva (o reparada)

1. Instala el programa ([INSTALACION_WINDOWS.md](INSTALACION_WINDOWS.md)) e inicia sesión **con internet** para descargar catálogo y existencias.
2. **No reutilices la identidad de una terminal si restauras un respaldo viejo** — riesgo de **folios repetidos** (explicado en [RESPALDOS.md](RESPALDOS.md), sección 4.3). Pide al gerente registrar una terminal nueva.
3. Si recuperaste el disco o un respaldo, restáuralo ([RESPALDOS.md](RESPALDOS.md), sección 4) y sincroniza: las ventas no enviadas saldrán de la cola (`pendiente`) sin duplicarse.
4. Concilia: compara la caja física contra el corte.

## 4. Corte de caja provisional (sin conexión o con pendientes)

- Solo el **gerente** puede hacer el corte.
- Si el dispositivo está sin conexión o tiene operaciones **propias** sin enviar, el corte se guarda como **provisional** y con conciliación **"pendiente"**. Nunca se borra ni se edita (un corte cerrado queda bloqueado por la base de datos).
- Al sincronizar, el servidor confirma el corte (`conciliado`) o lo marca **con diferencias**.
- **Límite que debes recordar:** un corte local solo representa **esa caja y lo que ese equipo conoce**. El sistema **no puede saber** si otra terminal desconectada tiene ventas sin enviar, así que no debe presentarse como el resultado de toda la tienda. Espera la conciliación antes de dar el día por cerrado.
- Si el efectivo contado no coincide, la diferencia (contado − esperado) queda registrada como **faltante (negativa)** o **sobrante (positiva)**; no se "arregla" cambiando cifras.

## 5. Falla la impresora **[hardware]**

1. **La venta ya está guardada.** No la captures otra vez.
2. Revisa papel, tapa, cable, que la impresora esté "En línea" y que la cola de Windows no esté pausada.
3. Reimprime desde el archivo de tickets o el botón de reimpresión **con el mismo folio**: no crea otra venta.
4. Si la impresora seguirá fuera de servicio, entrega el comprobante a mano o envíalo después; anota el folio.

## 6. Falla el escáner

Escribe el código o busca por nombre. Prueba el escáner en el Bloc de notas ([INSTALACION_WINDOWS.md](INSTALACION_WINDOWS.md), sección 6).

## 7. Se fue la luz en plena venta

Lo ya confirmado está a salvo (SQLite en modo WAL con `synchronous=FULL`). Una venta **no confirmada** no existe: al volver, revisa si el folio aparece en el archivo de tickets; si no, repítela. Si el ticket impreso existe pero la venta no, repítela y cancela mentalmente el papel (o anótalo como ticket sin venta).

## 8. Hay conflictos de sincronización

El gerente debe revisarlos cada día. Un conflicto (por ejemplo, **existencia negativa**) significa: la venta **sí se registró** (el cliente ya pagó), pero el inventario quedó en negativo. Pasos: contar físicamente el producto; si hay diferencia real, registrar un **ajuste con motivo**; marcar el conflicto como resuelto. **Nunca se elimina la venta.**

## 9. Lista de comprobación para ensayar (una vez al mes)

- [ ] Desconectar internet; hacer una venta; verificar que queda pendiente; reconectar; verificar que sincroniza **sin duplicar**.
- [ ] Apagar la API (o usar una URL equivocada) y vender.
- [ ] En el teléfono: abrir caja como gerente, vender, cerrar la app, abrirla y ver que la venta sigue.
- [ ] Restaurar un respaldo en base de prueba.
- [ ] Probar que la impresora saca dos copias y que reimprimir no crea otra venta.

Todos estos puntos coinciden con los escenarios de [PRUEBAS.md](PRUEBAS.md); mientras estén "sin ejecutar", **no asumas que funcionan**.
