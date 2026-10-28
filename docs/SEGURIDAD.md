# Seguridad

> Revisión: 22/10/2026. Todo lo descrito como "implementado" está leído en el código (`apps/api/src/auth.ts`, `http.ts`, `config.ts`, `packages/shared/src/password.ts`, `lan-auth.ts`, `packages/database/src/schema.ts`, `apps/mobile/src/lib/*`). **Nada se ha ejecutado ni auditado por terceros.** Esto es un resumen honesto de qué protege el diseño y qué NO.

## 1. Mapa de protecciones

| Qué se protege | Cómo | Dónde |
|---|---|---|
| Contraseñas | Hash **scrypt** (N=32768, r=8, p=1, sal aleatoria de 16 bytes, clave de 32 bytes), comparación en tiempo constante. Mínimo 8 caracteres. **Nunca** se guarda ni se devuelve la contraseña | `packages/shared/src/password.ts` |
| Sesiones | JWT HS256 firmado con `JWT_SECRET`; dura **12 horas**. El token solo identifica: **rol, estado activo y sucursales se leen de MongoDB en cada petición** | `apps/api/src/auth.ts` |
| Acciones sensibles | **Reautenticación**: token aparte (`x-reauth`) que vale **5 minutos** y debe ser del mismo usuario | `auth.ts` |
| Terminales | Token de terminal (400 días), solo para `/sync/*`, revocable (campo `revoked` y `tokenVersion`) | `auth.ts` |
| Permisos | Lista de permisos por rol en un único archivo; la API **autoriza**, los clientes solo muestran | `packages/shared/src/permissions.ts`, [PERMISOS.md](PERMISOS.md) |
| Entrada de datos | Todo se valida con **Zod** en el servidor (formularios y cada tipo de operación sincronizada) | `schemas.ts`, `apps/api/src/sync-payloads.ts` |
| Fuerza bruta (en línea) | Límite de intentos con `express-rate-limit` en el login (declarado como dependencia; **[por confirmar]** la configuración exacta en las rutas) | `apps/api` |
| Cabeceras HTTP | `helmet` y `cors` con lista de orígenes (`CORS_ORIGINS`) | `apps/api` |
| Fuerza bruta (sin conexión, teléfono) | Bloqueo escalonado tras 5 fallos: 1, 2, 4, 8… hasta 60 min | `apps/mobile/src/lib/lockout.ts` |
| Acceso sin conexión | Se crea **solo tras un inicio de sesión en línea**, guarda un **verificador scrypt** (no la contraseña) en `expo-secure-store`; caduca a los 30 días; sesión de 12 h | `apps/mobile/src/lib/offline-login.ts` |
| Historial financiero | Triggers de SQLite impiden borrar/modificar ventas, partidas, pagos, tickets, movimientos, cortes cerrados y auditoría | `schema.ts` ([DICCIONARIO_DATOS.md](DICCIONARIO_DATOS.md)) |
| Auditoría | Registro de solo-agregar en SQLite y MongoDB (quién, qué, cuándo, sucursal, terminal) | `audit.ts`, tabla `audit_log` |
| Operaciones duplicadas | `opId` único, `saleId` generado antes de cobrar, índices únicos | [SINCRONIZACION.md](SINCRONIZACION.md) |
| Teléfono ↔ PC | QR de un solo uso con caducidad; el secreto no viaja por la red; firma **HMAC** por petición; ventana de 60 s; nonce anti-repetición; revocación | `packages/shared/src/lan-auth.ts`, `packages/sync/src/lan.ts` |
| Secretos en el código | `.env` excluido en `.gitignore`; ninguna app cliente contiene credenciales de MongoDB | `.gitignore`, [MANTENIMIENTO.md](MANTENIMIENTO.md) |
| QR de productos | Contiene solo `amara:v1:<id>`: identifica, no autentica y no lleva credenciales | `packages/shared/src/ids.ts` |

## 2. Roles

- **Gerente:** todo lo operativo y financiero.
- **Vendedor:** vende; no ve acumulados, gráficas, cortes ni informes.
- **Desarrollador:** diagnóstico técnico; **sin permisos financieros** ni forma de saltarse los del gerente.
- No existe contraseña universal. No existe usuario "super" que ignore permisos.

Detalle en [PERMISOS.md](PERMISOS.md).

## 3. Riesgos que quedan (dichos sin adornos)

| Riesgo | Por qué existe | Qué hacer |
|---|---|---|
| **El archivo SQLite no está cifrado** | Cualquiera con acceso a tu usuario de Windows o al disco puede leer ventas y costos (y, con herramientas, alterarlos) | Usa **cuenta de Windows con contraseña**, bloquea la sesión al irte, activa **BitLocker** (o cifrado de dispositivo) si tu Windows lo permite, y no compartas la cuenta |
| Los triggers no son una caja fuerte | Quien tenga el archivo y una herramienta SQLite puede quitarlos o cambiar datos | Los respaldos fuera de la PC y la copia en la nube permiten **detectar** cambios al comparar |
| **Reloj del dispositivo** | La hora de las operaciones y la vigencia local de permisos temporales se basan en el reloj del equipo | El teléfono bloquea entradas si el reloj parece atrasado; mantener el reloj en automático; el servidor vuelve a validar |
| Revocación tardía de permisos temporales | Un teléfono sin conexión no se entera de la revocación hasta sincronizar | Permisos de corta duración |
| **HTTP sin cifrar en la red local** | El enlace teléfono–PC va en HTTP firmado; el contenido es visible en esa red | Solo en la red de la tienda con contraseña; no enviar secretos por ahí; Android tiene `usesCleartextTraffic` activo |
| **`0.0.0.0/0` en Atlas** | Render gratuito no tiene IP fija | Contraseña larga, usuario de permisos mínimos; ver [MONGODB_ATLAS.md](MONGODB_ATLAS.md) |
| `JWT_SECRET` filtrado | Con él alguien podría fabricar tokens | Cambiarlo de inmediato (cierra todas las sesiones y obliga a re-activar terminales) |
| Un rol cambiado en el SQLite local | El rol local se usa para operar sin conexión | El servidor **revalida** los permisos al sincronizar (regla de diseño; **[por confirmar]** en el código de `/sync/push`); las operaciones que no correspondan al rol real deberían rechazarse o marcarse como conflicto |
| La app de escritorio sin firma | Windows muestra advertencias de SmartScreen | Instalar solo instaladores que tú generaste o recibiste de confianza |
| APK sin Google Play | Requiere permitir "orígenes desconocidos" | Activarlo solo para instalar; instalar solo APK propios |
| Phishing / robo de contraseñas | Factor humano | Contraseñas únicas y largas; el gerente no comparte su cuenta |
| Sin cifrado de la base del teléfono | `expo-sqlite` no cifra por omisión | Bloqueo de pantalla del teléfono y cifrado del almacenamiento de Android (activo por omisión en teléfonos modernos) |

## 4. Reglas prácticas para la dueña

1. **Una persona = una cuenta.** No compartas el usuario de gerente.
2. Quita el acceso (desactiva al usuario) cuando alguien deje de trabajar contigo. Surte efecto de inmediato en la API; en un equipo desconectado, al siguiente sincronización o cuando caduque su acceso sin conexión (30 días).
3. Al cambiar de persona en una terminal compartida, **cierra o bloquea la sesión**.
4. Nunca envíes por WhatsApp/correo: `.env`, cadena de MongoDB, `JWT_SECRET`, respaldos.
5. Los respaldos contienen **todo** (ventas y costos): trátalos como dinero.
6. Si un equipo se pierde o roban: **revoca su terminal** desde la administración y cambia las contraseñas que se usaban en él.

## 5. Qué hacer ante una sospecha

| Sospecha | Pasos |
|---|---|
| Se filtró la cadena de MongoDB | Cambiar la contraseña del usuario de Atlas → actualizar `MONGODB_URI` en Render → reiniciar la API |
| Se filtró `JWT_SECRET` | Generar uno nuevo, actualizarlo en Render, reiniciar; todos inician sesión de nuevo y las terminales se activan otra vez |
| Se subió un `.env` a GitHub | Tratarlo como filtrado (los dos pasos anteriores); **borrar el archivo del repositorio no basta**, el historial de Git lo conserva |
| Una venta aparece "modificada" | Compara con la nube y con el último respaldo; revisa la auditoría (`auditoria.ver`) |
| Un teléfono desconocido aparece vinculado | Revocar el dispositivo en la PC; generar un nuevo QR |

## 6. Lo que falta revisar cuando existan las rutas completas de la API

- Que **todas** las rutas administrativas usen `requirePerm(...)` y las sensibles `requireReauth`.
- Que `/stats/*` devuelva **403** al vendedor y al desarrollador.
- Que `/sync/push` rechace o marque como conflicto operaciones cuyo usuario no tenga el permiso correspondiente y que ignore `grantId`/`authorizedBy` del dispositivo (el esquema ya lo indica).
- Configuración real del limitador de intentos del login.
- Que ninguna respuesta incluya el hash de contraseña.
