# Pendientes de apps/desktop

Este documento lista lo que `apps/desktop` necesita de otras partes del monorepo y lo que quedó sin verificar.
Nada de esto se pudo compilar ni ejecutar: el entorno de desarrollo no permite `npm install`.

## 1. Datos en Windows

Ruta fija (la app fuerza `userData` a esta carpeta): `%APPDATA%\Esoterica Amara\`
(normalmente `C:\Users\<usuario>\AppData\Roaming\Esoterica Amara\`). Está FUERA de la carpeta de instalación,
así que actualizar o desinstalar no borra datos (el desinstalador NSIS no toca esta carpeta).

| Archivo / carpeta | Contenido |
| --- | --- |
| `amara.sqlite` (+ `-wal`, `-shm`) | Base de datos local |
| `config.json` | Ajustes (impresora, papel, URL de API, carpetas de respaldo) |
| `terminal-token.bin` | Token de terminal cifrado con safeStorage (DPAPI) |
| `lan-devices.json` | Teléfonos vinculados (claves cifradas) |
| `etiquetas.json` | Historial de lotes de etiquetas |
| `respaldos-internos\` | Respaldo de último recurso si la carpeta configurada falla |
| `antes-de-restaurar\` | Copias de la base previa creadas por `restaurar-respaldo.ps1` |
| `logs\` | Registros de la app, respaldos y restauración |

Respaldos configurables: por omisión `Documentos\Esoterica Amara\Respaldos` (`amara_AAAA-MM-DD_HH-mm-ss.sqlite`).

## 2. Cambios necesarios en packages (no se hicieron)

1. `@amara/shared/password` y `/schemas` dependen de `@noble/hashes` y `zod`. El renderer/main de escritorio las empaqueta;
   hay que declararlas como dependencias resolubles desde `apps/desktop` (o confirmar que el hoisting del workspace las encuentra).
2. Verificar que `@amara/database` exporte `OPEN_PRAGMAS`, `SCHEMA_VERSION`, `createDb`, `fromSyncSqlite` y `LocalStore`
   con las firmas que usa `src/main/database.ts`, y que `@amara/sync` exporte `runSyncCycle`, `HttpSyncApi`,
   `verifyLanRequest`, `verifyPairing`, `NonceCache`.
3. Pantalla de resolución de conflictos de sincronización: el escritorio solo muestra el resumen de pendientes y conflictos;
   resolverlos se hace en el panel web.

## 3. Suposiciones sobre la API (sin confirmar contra `apps/api`)

- `POST /auth/login` devuelve usuario, rol y token en la forma que consume `AuthService`.
- `/admin/branches`, `/admin/terminals` y `POST /admin/terminals/:id/token` (emisión del token de terminal) con las formas de respuesta
  asumidas en `src/main/activation.ts`. Si difieren, ajustar solo ese archivo.
- Crear productos nuevos desde el escritorio exige haber iniciado sesión EN LÍNEA al menos una vez en esa sesión.
- `GET /health` existe (lo usa "probar conexión" en Ajustes).

## 4. Contrato con la app del teléfono (servidor LAN)

Servidor HTTP en `LAN_PORT`. Endpoints: `/pair`, `/ping`, `/scan`, `/replicate`, `/print`.
Cada petición firmada con HMAC (`verifyLanRequest`) y nonce anti-repetición (`NonceCache`). El QR de vinculación caduca
a los 5 minutos y es de un solo uso; los dispositivos se pueden revocar desde Ajustes.
La app móvil debe implementar exactamente este contrato; no se probó con ella. Windows Firewall debe permitir el puerto
(el instalador no crea la regla; ver riesgos).

## 5. Riesgos sin verificar

- Impresión térmica real: `webContents.print({ silent: true, deviceName, pageSize })` no se probó con ninguna impresora.
  Los controladores térmicos suelen ignorar o deformar `pageSize`; probar 58 y 80 mm con la impresión de prueba.
- `better-sqlite3` con Electron: requiere `electron-rebuild` y estar desempaquetado de asar (`asarUnpack`). No se compiló.
- `safeStorage` (DPAPI) cifra por usuario de Windows: cambiar de usuario de Windows invalida el token y las claves LAN.
- Ganchos NSIS (`build/installer.nsh`) y los scripts PowerShell no se ejecutaron en Windows.
- `statfs` para el espacio libre en Windows y las unidades USB desconectadas.
- `package.json`, `electron-builder.yml` y las configuraciones de vite/tsconfig sin validar contra las versiones reales.
- Las pruebas de vitest (escáner, ticket, rotación de respaldos, ajustes, recuperación) solo se corrieron con un shim sobre `node:test`, no con vitest.
- Verificación estática realizada: análisis sintáctico de todos los .ts/.tsx y `tsc` con tipos falsos. NO equivale a compilar con las dependencias reales.
