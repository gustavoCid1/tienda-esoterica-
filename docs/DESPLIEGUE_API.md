# Desplegar la API (servidor)

> Revisión: 22/10/2026. **[servicio externo]** Requiere cuentas de GitHub, Render y MongoDB Atlas. Nada se ha desplegado todavía. Los comandos de compilación están tomados de `apps/api/package.json`; los **valores concretos de Render están por verificar** al hacer el despliegue real (la consola de Render cambia con frecuencia).

## 1. Qué hace la API y qué necesita

- Es un servidor **Node.js + Express** (`apps/api`). Valida permisos, guarda en MongoDB y recibe la sincronización de las apps.
- Necesita: **Node.js ≥ 20** (recomendado 22), una base MongoDB Atlas ([MONGODB_ATLAS.md](MONGODB_ATLAS.md)) y cuatro variables de entorno.
- **No guarda archivos en disco**: todo va a MongoDB. Esto es esencial en Render gratuito, donde el disco se pierde en cada reinicio.
- Las apps de escritorio y móvil **no dependen de que la API esté encendida** para vender.

## 2. Variables de entorno

| Variable | Obligatoria | Valor |
|---|---|---|
| `MONGODB_URI` | Sí | Cadena de Atlas (usuario con permisos mínimos) |
| `MONGODB_DB` | No | `amara` |
| `JWT_SECRET` | Sí | ≥ 32 caracteres aleatorios (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). **Distinto del de desarrollo** |
| `CORS_ORIGINS` | Para la web | Dirección exacta de la web, p. ej. `https://amara-web.onrender.com` (varias separadas por coma). Las apps móvil y de escritorio no usan CORS |
| `PORT` | No | Render lo define solo; la API lo lee. Por omisión 8080 |

Si falta una obligatoria, la API **no arranca** y el error dice cuál (`config.ts`). No hace falta archivo `.env` en el servidor: se usan las variables del panel de Render (la API intenta cargar `.env` y, si no existe, usa las del sistema).

## 3. Probar primero en tu PC

```powershell
npm install
npm run build -w @amara/api
npm run start -w @amara/api
```

Abre <http://localhost:8080/health>. Si funciona así, funcionará en Render (mismo proceso). `build` usa `tsup` y **incluye** los paquetes internos (`@amara/shared`, `sync`, `database`) en el archivo final; `mongodb`, `express`, etc. quedan como dependencias normales, por lo que el servidor sí necesita `node_modules` instalado.

## 4. Desplegar en Render (plan gratuito) **[servicio externo]**

Antes lee [SERVICIOS_GRATUITOS.md](SERVICIOS_GRATUITOS.md), sección 2: se **duerme a los 15 minutos** sin tráfico, tarda **~1 minuto** en despertar y tiene **750 horas/mes**. Un cliente de sincronización con tiempo máximo de 30 s puede reportar "sin conexión" en la primera petición tras dormir; los datos no se pierden.

1. **Sube el repositorio a GitHub** (privado) sin secretos: ver [MANTENIMIENTO.md](MANTENIMIENTO.md), sección "Publicar en GitHub sin secretos".
2. En <https://render.com> crea una cuenta (con GitHub). **No agregues método de pago** sin autorización.
3. **New → Web Service** → conecta tu repositorio.
4. Configura (valores sugeridos; **verificar** contra la consola):

| Campo | Valor |
|---|---|
| Name | `amara-api` |
| Region | La disponible más cercana |
| Branch | `main` |
| Root Directory | *(vacío: la raíz del monorepo, porque los paquetes compartidos están fuera de `apps/api`)* |
| Runtime | Node |
| Build Command | `npm install && npm run build -w @amara/api` |
| Start Command | `npm run start -w @amara/api` |
| Instance Type | **Free** |
| Health Check Path | `/health` |

5. En **Environment** agrega `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGINS`, y `NODE_VERSION` = `22` (Render usa esa variable para elegir la versión de Node; **verificar** en su documentación).
6. **Create Web Service**. La primera compilación puede tardar varios minutos.
7. Cuando diga *Live*, abre `https://<tu-servicio>.onrender.com/health`.
8. Si es la primera vez, ejecuta el **seed** del gerente. Como el plan gratuito no da shell, hazlo **desde tu PC** apuntando a la misma base (es solo escribir en Atlas): pon el `MONGODB_URI` de producción en tu `apps/api/.env` **temporalmente**, ejecuta `npm run seed`, y luego restaura tu `.env` de desarrollo. Revisa antes `apps/api/src/seed.ts`.
9. Autoriza tu API en Atlas: en *Network Access* debe haber una regla que permita a Render conectarse (ver [MONGODB_ATLAS.md](MONGODB_ATLAS.md), Paso 4).

### Actualizar

Cada `git push` a la rama configurada vuelve a desplegar (si dejaste el despliegue automático). Los datos están en Atlas, así que reiniciar o redesplegar no pierde información. Las migraciones de MongoDB no existen como tal: los índices se crean al arrancar (`ensureIndexes`, idempotente).

## 5. Publicar la web administrativa **[servicio externo]**

1. En `apps/web`, la variable `VITE_API_URL` es la URL que usa el navegador. En producción ponla **completa**, por ejemplo `https://amara-api.onrender.com`, **al compilar**:

```powershell
$env:VITE_API_URL = "https://amara-api.onrender.com"
npm run build:web
```

2. El resultado queda en `apps/web/dist` (archivos estáticos). Puedes alojarlo como **sitio estático** (Render permite sitios estáticos; confirma las condiciones y el cómputo de ancho de banda), en GitHub Pages u otro hosting estático. La web usa rutas de `react-router-dom`: el hosting debe devolver `index.html` para rutas desconocidas (regla "rewrite/SPA"). **[por verificar]**
3. Agrega la dirección final de la web a `CORS_ORIGINS` de la API y reinicia.

> **Inconsistencia detectada:** `apps/web/.env.example` apunta el proxy de desarrollo a `http://localhost:3000`, pero la API escucha por omisión en el puerto **8080**. Para desarrollar, pon `VITE_API_PROXY_TARGET=http://localhost:8080` en `apps/web/.env` (o cambia `PORT`).

## 6. Después de desplegar: lista de comprobación

- [ ] `/health` responde.
- [ ] Puedes iniciar sesión con el gerente desde la web.
- [ ] Una PC con `apiUrl` configurada sincroniza una venta de prueba.
- [ ] El teléfono muestra el "Resumen de ventas de hoy" con esa venta.
- [ ] El vendedor recibe **403** al pedir `/stats/today` (ver [PRUEBAS.md](PRUEBAS.md), escenario 10).
- [ ] `JWT_SECRET` y `MONGODB_URI` no aparecen en el repositorio.

## 7. Si la API no responde

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Tarda ~1 min y luego responde | Render la despertó | Normal en el plan gratuito |
| 502/503 persistente | Falló el arranque | Revisa los *Logs* en Render: variable faltante, `JWT_SECRET` corto, Atlas pausado o IP no permitida |
| Error de conexión a MongoDB | Cluster pausado o IP bloqueada | Reanuda el cluster; revisa Network Access |
| Todas las sesiones dejaron de servir | Cambiaste `JWT_SECRET` | Es esperado: cada usuario debe iniciar sesión de nuevo; los tokens de terminal (400 días) también se invalidan y hay que **volver a activar las terminales** |
| Se acabaron las 750 horas | Demasiados servicios o mes largo | La API se suspende hasta el mes siguiente; las apps siguen vendiendo en local |

## 8. Cambiar de proveedor

La API es Node.js estándar (sin disco, sin funciones propias de Render): se puede mover a otro proveedor que ejecute Node. Solo cambian el **comando de compilación/arranque**, las **variables de entorno** y la **URL**, que hay que actualizar en `apiUrl` del escritorio, `EXPO_PUBLIC_API_URL` del móvil (nuevo APK) y `VITE_API_URL` de la web. Otros proveedores **no se evaluaron** en este proyecto.
