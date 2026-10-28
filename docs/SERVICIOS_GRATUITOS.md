# Servicios gratuitos: qué se puede esperar y qué no

> **Fecha de consulta: 22 de octubre de 2026**, en las páginas oficiales citadas al final de cada sección. Los proveedores cambian límites y condiciones sin avisar. **Antes de depender de cualquiera de estos servicios, vuelve a leer su página oficial.**
>
> Regla de este proyecto: **nada es "gratis para siempre"** y **no se activa facturación, no se agrega tarjeta ni se contrata nada sin autorización expresa de la dueña**.

## Resumen para decidir

| Servicio | Para qué se usa | Costo hoy | Riesgo principal para la tienda |
|---|---|---|---|
| MongoDB Atlas (plan gratuito, antes "M0") | Base de datos central | $0 | 512 MB de espacio; se **pausa tras 30 días sin conexiones**; límites de transferencia; respaldos limitados; transacciones no confirmadas |
| Render (servicio web gratuito) | Servidor de la API | $0 | **Se duerme a los 15 min sin tráfico** y tarda ~1 min en despertar; 750 h/mes |
| GitHub Free | Guardar el código | $0 | Pierdes el código si no haces copias y no usas bien los secretos |
| Expo / EAS (plan gratuito) | Probar la app (Expo Go) y generar el APK | $0 | Límite de compilaciones; cola de baja prioridad |
| Electron / electron-builder | Instalador de Windows | $0 | Sin firma de código: Windows muestra advertencias |

**Lo que protege a la tienda de todo lo anterior:** las apps de escritorio y móvil guardan todo en SQLite local y siguen vendiendo aunque la nube se duerma, se pause o desaparezca. La nube es para sincronizar y para ver ventas desde fuera; **no es lo que sostiene el mostrador**.

---

## 1. MongoDB Atlas — plan gratuito (M0 / "Free")

Fuente: <https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/> (consultada 22/10/2026; la página no trae fecha de actualización).

| Tema | Lo que dice la documentación oficial | Qué significa para Amara |
|---|---|---|
| Almacenamiento | **0.5 GB** (512 MB), contando documentos BSON sin comprimir **más sus índices** | Con ~500 productos y miles de ventas alcanza por mucho tiempo, pero **las fotos en `photo` pesan**: deben reducirse mucho (el esquema acepta hasta ~2 MB por foto, que es demasiado para este plan; usar imágenes pequeñas). Vigilar el uso en Atlas. |
| Conexiones | "Free clusters can only have a maximum of **500** connections." | La API usa un máximo de 10 conexiones (`maxPoolSize: 10`). |
| ⚠ **Discrepancia 100 vs 500** | En la página consultada hoy, **500** es el máximo de *conexiones*; el número **100** aparece como *operaciones por segundo* (100 ops/s) y como máximo de *alertas*. Otras fuentes (documentos antiguos, foros, comparativas) citan "100 conexiones" para M0. | **Verificar en la documentación oficial y en tu propia consola de Atlas** (Clusters → tu cluster → pestaña de métricas/límites). Mientras tanto, no depender de más de ~10 conexiones simultáneas: el diseño ya lo respeta. |
| Operaciones por segundo | 100 operaciones/s (lecturas y escrituras) | Suficiente para 2 sucursales; un pull o push grande puede acercarse al límite momentáneamente. |
| Transferencia de datos | Límite por **ventana móvil de 7 días**: 10 GB entrando y 10 GB saliendo | El `pull` envía existencias completas de la sucursal; con miles de variantes y fotos puede ser pesado. Mantener fotos pequeñas y pull incremental. |
| Pausa por inactividad | "Atlas automatically pauses Free clusters after **30 days of inactivity** where there are zero connections." Se puede reanudar manualmente. | Si la tienda cierra un mes (vacaciones) y nadie se conecta, el cluster se pausa. **Reanudarlo desde Atlas**. La documentación recomienda exportar una copia si no se usará por mucho tiempo. También: "Atlas may deactivate idle Free clusters as per the Terms of Service". |
| Clusters por proyecto | Máximo **uno** gratuito por proyecto de Atlas | Un solo cluster para todo. |
| Respaldos | La página dice: "You can enable backups on Free clusters… Atlas takes a **daily snapshot** and retains up to **four** snapshots." | ⚠ Esto **contradice la suposición habitual** de que el plan gratuito no tiene respaldos administrados. **No lo des por hecho**: confirma en tu consola si la opción de respaldos aparece y está activa. **Aun así, mantén un respaldo propio** con `mongodump`/`backup:mongo` ([RESPALDOS.md](RESPALDOS.md)): cuatro copias diarias dentro del mismo servicio no sustituyen una copia tuya fuera de él. |
| `mongodump`/`mongorestore` | Permitidos, con restricciones: no se puede usar sobre la base `admin`; no se admiten `--dumpDbUsersAndRoles` ni `--oplog` (y para restaurar, `--restoreDbUsersAndRoles`, `--oplogReplay`, `--preserveUUID`) | Nuestra base se llama `amara`, así que sirve. Los usuarios de Atlas no se respaldan con dump: se recrean a mano. |
| **Transacciones multi-documento** | **La página oficial no las menciona**: no las confirma ni las descarta. | **No se pudo confirmar su disponibilidad en este plan, por eso el diseño no depende de ellas** (identificadores únicos, `$inc` atómico, movimientos como fuente de verdad y recálculo de existencias). No agregues código que las requiera sin probarlo antes. |
| Aggregation | Sin escritura de archivos temporales (`allowDiskUse` se ignora); máximo 50 etapas por pipeline | Los informes deben ser ligeros. |
| Tarjeta bancaria | La página no lo trata. En general crear un cluster gratuito no exige tarjeta; **verifícalo al registrarte**. | No agregues una tarjeta sin autorización. |
| Cambios de nombre | La documentación ya los llama "Free clusters" (antes "M0"). Existe también el plan "Flex" (de pago por uso con tope) | **No cambiar a Flex ni a M10+** sin autorización: son de pago. |

## 2. Render — servicio web gratuito (para la API)

Fuente: <https://render.com/docs/free> (consultada 22/10/2026).

| Tema | Lo que dice la documentación oficial | Qué significa para Amara |
|---|---|---|
| Se duerme | Tras **15 minutos sin tráfico entrante** el servicio se "apaga" | La API no responde mientras duerme. |
| Despertar | Tarda **alrededor de 1 minuto** | La primera petición tras un rato inactivo es lenta. **Importante:** el cliente de sincronización (`HttpSyncApi`) tiene un tiempo máximo de **30 segundos** por petición, así que el primer intento tras dormir **puede expirar y verse como "sin conexión"**; el siguiente ciclo (cuando ya despertó) funciona. No es una pérdida de datos (todo sigue en la cola), pero el gerente puede ver "sin conexión" durante el primer minuto. |
| Horas | **750 horas de instancia por mes** por espacio de trabajo; las horas de un servicio dormido no cuentan; las no usadas no se acumulan. Si se agotan, se suspenden todos los servicios gratuitos hasta el mes siguiente | Un mes de 31 días tiene 744 h: un solo servicio encendido todo el mes cabe, con muy poco margen. **No agregues un segundo servicio gratuito** sin revisar el cálculo. |
| Tarjeta | La página **no indica que se requiera tarjeta** para crear un servicio gratuito. Sin método de pago, al agotar el ancho de banda se suspenden los servicios gratuitos por el resto del mes; al agotar minutos de compilación se deshabilitan nuevas compilaciones | **No agregar método de pago sin autorización.** |
| Disco | **Sin disco persistente**: los archivos locales se pierden en cada despliegue, reinicio o suspensión | La API **no debe guardar nada en disco** (tampoco respaldos): todo va a MongoDB. |
| Reinicios | Render "may restart the service at any time" | Es normal; la API debe arrancar limpia y las operaciones son idempotentes. |
| Otras restricciones | Una sola instancia; sin shell; puertos de salida 25, 465 y 587 bloqueados; puede suspender servicios con tráfico saliente inusual | No se envían correos desde la API. |
| Base de datos de Render | La base Postgres gratuita **expira a los 30 días** | **No se usa**; la base es MongoDB Atlas. |

Mitigaciones posibles (a decidir por la dueña): aceptar el arranque lento (lo más simple y sin riesgo de términos), o hacer un "ping" periódico para evitar que duerma, **revisando antes los términos de Render** y el efecto en las 750 horas.

## 3. GitHub Free

Fuente: <https://docs.github.com/en/get-started/learning-about-github/githubs-plans> (consultada 22/10/2026).

- Repositorios privados ilimitados "con un conjunto limitado de funciones".
- GitHub Actions: 2,000 minutos al mes (según la página).
- Packages: 500 MB. Codespaces: 120 horas-núcleo y 15 GB al mes.
- **Riesgos:** (a) subir por error contraseñas o archivos `.env` — ver [MANTENIMIENTO.md](MANTENIMIENTO.md) sección "Publicar en GitHub sin secretos"; (b) repositorios **públicos** muestran todo el código a cualquiera; usa uno **privado**; (c) la cuenta puede perderse o bloquearse: conserva una copia local del repositorio.

## 4. Expo y EAS (aplicación móvil)

Fuente: <https://expo.dev/pricing.md> (consultada 22/10/2026).

| Tema | Lo que dice | Implicación |
|---|---|---|
| Expo Go | Aplicación gratuita para probar proyectos Expo en el teléfono | Sirve para **pruebas**. Si la app usa módulos nativos que Expo Go no incluye, hará falta un *development build* (por confirmar al revisar `apps/mobile`). |
| EAS Build, plan gratuito | "Up to 15 Android and 15 iOS builds" (la página no precisa si es por mes; **verifícalo**) | Suficiente para generar el APK ocasionalmente. |
| Cola | Prioridad baja: puede haber esperas de **90 minutos o más** en horas pico | Planear con tiempo. |
| Tiempo máximo de compilación | 45 minutos | |
| Tarjeta | La página no la menciona | No agregar sin autorización. |
| Publicar en Google Play | **No es necesario** para este proyecto: se instala el APK directamente. Una cuenta de desarrollador de Google Play tiene un costo de registro (no evaluado aquí) | Instalar APK desde fuentes desconocidas es una decisión de seguridad; ver [INSTALACION_ANDROID.md](INSTALACION_ANDROID.md). |

## 5. Windows: instalador

- Compilar el instalador con las herramientas de código abierto (Electron/electron-builder) **no tiene costo**.
- Un instalador **sin firma de código** hace que Windows SmartScreen muestre "Windows protegió su PC". Se puede continuar con "Más información → Ejecutar de todos modos". Un certificado de firma tiene costo y **no se contrata sin autorización**.

## 6. Qué puede cambiar y cómo enterarse

| Riesgo | Señal | Qué hacer |
|---|---|---|
| El plan gratuito cambia sus límites | Correos del proveedor; páginas oficiales | Revisar este documento cada 6 meses. Tener lista la salida: exportar datos (ver [RESPALDOS.md](RESPALDOS.md)). |
| El cluster se pausa | La API devuelve errores de conexión a MongoDB | Reanudar desde la consola de Atlas. La tienda sigue vendiendo con el sistema local. |
| Se llena el almacenamiento | Alerta de Atlas / errores de escritura | Reducir fotos, archivar datos viejos con respaldo previo, o (con autorización) pasar a un plan de pago. |
| Render deja de ofrecer el plan | Aviso del proveedor | La API es Node.js estándar: puede desplegarse en otro proveedor (ver [DESPLIEGUE_API.md](DESPLIEGUE_API.md)). Otras opciones existen pero **no se evaluaron en este documento**. |

## 7. Costo mensual esperado

Con el uso descrito: **$0 MXN**, sujeto a que los proveedores mantengan estas condiciones y a que no se superen los límites. **No es una garantía.** Cualquier cobro requeriría que la dueña active la facturación; el sistema no lo hace por su cuenta.
