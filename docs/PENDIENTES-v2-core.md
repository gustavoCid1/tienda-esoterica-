# Pendientes y riesgos: núcleo v2 (shared, database, sync, api)

Alcance: `packages/shared`, `packages/database`, `packages/sync` y `apps/api`, según `docs/CAMBIOS-v2.md` secciones 1 a 3. No se tocó `apps/web`, `apps/desktop` ni `apps/mobile`.

## Qué se verificó de verdad y qué no

Entorno sin `npm install`: no hay `express`, `mongodb`, `jose`, `supertest` ni `vitest` instalados.

| Verificación | Resultado |
|---|---|
| Pruebas de `packages/shared`, `packages/database`, `packages/sync` y las puras de `apps/api` (con el cargador de pruebas del entorno: `vitest` reemplazado por una versión mínima y `zod` tomado de una copia global) | Se ejecutaron y pasaron |
| `tsc` sobre `apps/api` con *stubs* de los módulos que faltan (express, mongodb, jose, zod) | Sin errores distintos de los módulos ausentes; **no es una compilación real** (al no haber tipos de `zod`, los cuerpos validados quedan como `any`) |
| Sintaxis de todos los `.ts` de los cuatro paquetes (esbuild) y carga con *type stripping* de Node | Sin errores |
| `apps/api/test/route-permissions.test.ts` (supertest) | **Escrito y ampliado, NO ejecutado** (falta `supertest`/`express`) |
| Rutas, `sync-repo.ts` (MongoDB), `pull.ts`, `db.ts` (índices, incluido el TTL de `security_verifications`) | **Nunca corrieron contra una base real** |

Correr `npm install && npm test` en cada paquete es lo primero que falta.

## Auditoría: por qué la página no cargaba

Causa (leyendo `apps/api/src/audit.ts`, `routes/admin.ts` y la página de la web): el servidor devolvía `{total, items:[{id, at, userId, action, entity, entityId, branchId, terminalId, detail}]}` con `detail` **objeto**, y la web esperaba `createdAt`, `userName` y un `detail` de **texto**. Pintar un objeto como hijo de React lanza un error, el árbol se desmontaba y, sin límite de errores, la pantalla quedaba en blanco; además `createdAt` inexistente daba fechas inválidas.

Corrección en el servidor (`apps/api/src/audit-view.ts`, `GET /admin/audit`): cada fila conserva `at` y `detail` (objeto) y agrega `createdAt`, `userName` (resuelto de `users`) y `summary` (texto de una línea). Además:
- los parámetros vacíos (`entity=`, `from=`) ya no dan 400;
- `entity` acepta nombres en español (`usuario`, `venta`, `caja`...);
- se filtran llaves sensibles (`password`, `hash`, `salt`, `verifier`) por si alguna vez entraran a un `detail`.

Del lado del cliente: la página de la web (`apps/web/src/pages/System.tsx` con `lib/audit.ts`) **ya normaliza ambas formas** (la que manda el servidor y la que antes esperaba), así que con esta respuesta funciona con o sin los campos nuevos. No hace falta cambiar nada más en `apps/web`. Si un cliente viejo sigue leyendo `r.detail` como texto, debe usar `r.summary`.

## Decisiones y supuestos

1. **Sin permisos nuevos.** Crear/ver/revocar tokens y editar las categorías de extras usan `config.editar` (solo gerente); el resumen de hoy usa `tickets.archivo`. Así `ROLE_PERMISSIONS` y la interfaz no cambian.
2. **Verificación en línea de un solo uso.** El contrato dice que `/cash/close`, cancelar y devolver "aceptan `authorization`". Para que el vendedor no pueda declarar un `adminUserId` cualquiera, la ruta exige una verificación previa (`POST /security/verify`, 10 minutos, un solo uso, ligada a usuario + propósito + sucursal + autorización exacta) en la colección `security_verifications`, y además vuelve a validar (token vigente con usos, gerente activo de la sucursal). Si algo de eso falla, la ruta **rechaza** (403); solo `sync/push` aplica-y-avisa con `autorizacion_invalida`, porque ahí la operación ya ocurrió.
3. **Extensión de `POST /security/verify`:** además de `{code, purpose, branchId}` acepta `{adminPassword, adminUserId? | adminUsername?}` para verificar la contraseña de un gerente en línea (el contrato solo mencionaba el código). Una denegación responde **200** `{ok:false, reason, message}` (no 4xx, para no confundirla con "sin conexión"); el límite de 5 fallos/min responde 429.
4. **Gerente implícitamente autorizado:** no manda `authorization`; su identidad queda como `authorizedBy`/`closeAuthorizedBy`.
5. **Terminales:** la respuesta de `POST/PATCH /admin/terminals` trae el terminal completo en la raíz **y** dentro de `terminal` (la forma v1) para no romper a ningún cliente. Código automático `P1, P2…` / `M1, M2…` (máx. 99 por tipo, con el formato de 1 a 3 caracteres del esquema) y nombre "PC de Ana" / "Móvil de Ana", igual que sugiere la web.
6. **Existencias bajas:** `GET /stats/low-stock` incluye las variantes activas con mínimo > 0 y `qty <= minStock` y TAMBIÉN cualquier existencia negativa heredada (aunque no tenga mínimo). No incluye las agotadas sin mínimo configurado (son la mayoría del catálogo sin existencia; siguen en `/stats/dashboard.outOfStock`).
7. **Series por producto:** agrupan por `productId` (todas las variantes juntas) usando el catálogo actual; si la variante ya no existe, usan el id de la variante y el nombre guardado en la venta. Son netas de devoluciones en la fecha de la devolución, igual que `summarizeSales`. Un extra suma importe y no unidades.
8. **Tokens en el `pull`:** se envían los de la sucursal y los generales que sigan vigentes o hayan vencido hace menos de 24 h (incluidos los revocados, para que el dispositivo los rechace). Se reemplaza toda la caché local en cada `pull`.
9. **Reloj:** el servidor evalúa tokens a `min(hora local de la operación, ahora)`. Un dispositivo con el reloj atrasado podría "caer" dentro de la vigencia de un token ya vencido; es la misma limitación que ya tienen los permisos temporales (se mitiga con `hora_futura` y con la revisión del gerente).

## Riesgos conocidos

- **Verificadores de gerente en el `pull`.** Para autorizar SIN internet con contraseña de admin, el `pull` entrega a cada dispositivo de la sucursal el hash scrypt (`verifier`) de los **gerentes**. Un dispositivo robado y abierto expone esos hashes a un ataque de fuerza bruta fuera de línea. Mitigaciones existentes: scrypt, contraseña mínima de 8 caracteres, el token de terminal es revocable. Si el riesgo no es aceptable, quitar `verifiers: true` en `routes/sync.ts` (entonces solo se autoriza con token o con internet) o usar un verificador distinto de la contraseña de inicio de sesión (p. ej. un PIN de autorización con su propio hash).
- **El límite de 5 fallos/min vive en memoria del proceso** (`FailureLimiter`). Con varias instancias del servidor cada una cuenta aparte, y se reinicia al reiniciar. Suficiente para una sola instancia; para varias hay que moverlo a la base.
- **Fuerza bruta de un token:** el código es de 8 caracteres de un alfabeto de 32 símbolos (≈ 1.1 × 10¹² combinaciones) y hay límite de 5 fallos/min por usuario/terminal, pero no hay un bloqueo global por token.
- **Conteo de usos de un token:** el uso se cuenta cuando la operación se **aplica** en el servidor, no cuando se verifica. Un token con `maxUses: 1` usado sin conexión en dos dispositivos produce una operación aplicada y otra con `autorizacion_invalida` al sincronizar.
- **Verificación consumida antes de ejecutar:** si la acción en línea falla después de validar (p. ej. 409 por caja ya cerrada), la verificación ya se gastó y hay que verificar de nuevo.
- **Mongo sin transacciones:** el conteo de usos de un token usa una marca única `(token, operación)` más un `$inc` condicional; ante una caída entre ambos pasos, el reproceso es seguro (la marca evita contar dos veces) pero un uso podría quedar sin contar si la marca se borra y el incremento falla.
- **TTL de `security_verifications`:** depende del hilo de limpieza de MongoDB (corre cada ~60 s); por eso la ruta también filtra por `expireAt > ahora`.

## No se hizo

- `POST /limpias` (opcional en el contrato): las Limpias viajan como `sale.create` con `type:'limpia'` por `sync/push`; no hay ruta HTTP aparte.
- Pruebas de las rutas contra MongoDB y de `sync-repo.ts` (hace falta una base de pruebas o `mongodb-memory-server`).
- Migración de datos: no hay (las ventas V1 se interpretan con `type:'venta'`, vendedor = cajero, partidas `producto`).
- Interfaz de las tres aplicaciones (otros agentes). Contrato que deben respetar: ver `docs/API.md`.
- Reconciliación automática de conflictos `autorizacion_invalida`: queda como conflicto abierto para el gerente (`POST /admin/conflicts/:id/resolve`).
- Reporte de ventas por vendedor (`sellerId`) en `/stats`: los datos ya se guardan pero no hay agregación por vendedor.
