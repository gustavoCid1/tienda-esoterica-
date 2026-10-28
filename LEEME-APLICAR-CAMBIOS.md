# Esotérica Amara — Actualización v2 (cambios)

Este ZIP trae SOLO los archivos nuevos o modificados. No incluye `node_modules`.
No incluye ni modifica tus archivos de colores: `apps/web/src/styles.css`,
`apps/desktop/src/renderer/styles.css` y `apps/mobile/src/theme.ts`. Los estilos nuevos están
en archivos aparte (`styles-v2.css`).

IMPORTANTE: ESTE CÓDIGO NO SE HA COMPILADO NI PROBADO EN UN EQUIPO REAL. Primero haz la copia de
seguridad y luego sigue los pasos. Lo más probable es que `typecheck` muestre algunos errores
menores que hay que corregir; mándamelos.

## Antes de empezar
1. Cierra la app de escritorio y detén la API (Ctrl + C) y el servidor de la web si están corriendo.
2. Copia toda tu carpeta `esoterica-amara` completa a otro lugar como respaldo
   (por ejemplo `esoterica-amara-respaldo`). Si cambiaste archivos a mano además de los colores,
   este respaldo es lo que te permite recuperarlos.
3. Respalda también tu base local de escritorio (carpeta `%APPDATA%\Esoterica Amara`).
   La actualización agrega columnas y tablas sin borrar datos, pero conviene tener copia.

## Aplicar
1. Descomprime este ZIP dentro de tu carpeta `esoterica-amara`, aceptando "Reemplazar archivos".
   Cada archivo cae en su carpeta (`apps/...`, `packages/...`, `docs/...`).
2. En PowerShell, en la carpeta del proyecto (con Node 22):
   ```powershell
   npm install
   npm run typecheck
   npm test
   ```
   `npm install` es necesario: se agregaron dependencias (`jspdf` en la web y varias en el móvil).
3. Escritorio: si al abrirlo vuelve a salir el error de `better-sqlite3`, repite
   (con tu versión de Electron):
   ```powershell
   cd node_modules\better-sqlite3
   npx prebuild-install -r electron -t 33.4.11 --platform win32 --arch x64
   cd ..\..
   ```
   Importante: `npm install` puede reemplazar ese archivo y hace falta repetirlo.
4. Reinicia la API: `npm run dev:api`. La primera vez crea los índices nuevos en MongoDB.
5. Abre el escritorio (`npm run dev:desktop`): migra tu base local a la versión 2 al arrancar.

## Móvil
Las notificaciones, la tarea en segundo plano y la vista web del PDF NO funcionan completas en Expo Go;
necesitan un build de desarrollo o una APK con EAS. Después de `npm install`, dentro de `apps/mobile`:
```powershell
npx expo install --fix
```

## Qué cambia para ti
- Después de actualizar, entra a la web → Configuración y elige las categorías con botón Extra.
- Crea tokens en la web → Tokens de seguridad (o en el escritorio / móvil de administrador).
- La existencia negativa que ya tenías (por ejemplo -2) no se corrige sola: regístrala con una
  entrada o un conteo físico.

Lista completa de archivos en `ARCHIVOS.txt`. Detalles técnicos en `docs/CAMBIOS-v2.md` y en los
`docs/PENDIENTES-v2-*.md`.
