# Instalación en Android

> Revisión: 22/10/2026. **Nunca se ha probado en un teléfono real** (marcado **[hardware]**) ni se ha generado un APK (marcado **[servicio externo]**: requiere una cuenta de Expo). Datos tomados de `apps/mobile/package.json`, `app.json`, `eas.json` y `src/config.ts`.

## 1. Qué es la app móvil

Aplicación Expo / React Native (Expo SDK 54) para Android, con paquete `mx.esotericaamara.pos`. Sirve para:

- Escanear códigos (cámara) y consultar inventario.
- Hacer **ventas de emergencia** si la PC falla.
- Dar entradas de mercancía **solo** con permiso temporal del gerente.
- Servir de **escáner vinculado a la PC** (por red local).
- Para el gerente: **"Resumen de ventas de hoy"**.

Guarda su propia base SQLite (`expo-sqlite`) y sigue funcionando sin internet. Los permisos y verificadores de contraseña se guardan en `expo-secure-store` (almacenamiento seguro de Android).

## 2. Opción A: probar con Expo Go (para pruebas, no para el negocio) **[hardware]**

Expo Go es una aplicación gratuita de Play Store que abre el proyecto en modo desarrollo.

1. En el teléfono, instala **Expo Go** desde Google Play.
2. PC y teléfono deben estar en la **misma red Wi-Fi**.
3. En la PC:

```powershell
npm install
npm run dev:mobile
```

4. Aparece un **código QR** en la terminal. Ábrelo con Expo Go (o con la cámara, que te lleva a Expo Go).
5. La primera vez, la app te pide la **dirección del servidor** (campo "Servidor" en el inicio de sesión). **No uses `localhost`**: en el teléfono `localhost` es el propio teléfono. Usa la dirección pública de tu API (por ejemplo `https://tu-api.onrender.com`) o la IP de la PC en la red (`http://192.168.x.x:8080`).

Límites de Expo Go: es para **pruebas**. Si alguna librería nativa no viene incluida en Expo Go, hay que usar un *development build* (`eas build --profile development`, definido en `eas.json`). **[por confirmar al ejecutar]**. Para trabajar en la tienda, instala el APK (sección 3).

## 3. Opción B: generar e instalar el APK (perfil `preview`) **[servicio externo]**

El perfil `preview` de `apps/mobile/eas.json` genera un **APK** instalable directamente (`distribution: internal`, `buildType: apk`). No requiere publicar en Google Play.

### 3.1 Preparación (una sola vez)

1. Crea una cuenta gratuita en <https://expo.dev>. **No agregues tarjeta** ni cambies de plan sin autorización (ver [SERVICIOS_GRATUITOS.md](SERVICIOS_GRATUITOS.md)).
2. Instala la herramienta y entra con tu cuenta:

```powershell
npm install -g eas-cli
eas login
```

3. **Edita `apps/mobile/eas.json`** y reemplaza la dirección de ejemplo en el perfil `preview`:

```json
"env": { "EXPO_PUBLIC_API_URL": "https://CAMBIAR-por-la-url-de-la-api.ejemplo.mx" }
```

por la URL real de tu API (con `https://`, sin `/` al final). Mientras el valor contenga la palabra `CAMBIAR`, la app lo **ignora** (`src/config.ts`) y la dirección deberá escribirse a mano en la app. Esta URL **no es un secreto**; **no pongas contraseñas ni cadenas de MongoDB** en ese archivo.

4. Vincula el proyecto a tu cuenta (la primera vez):

```powershell
cd apps\mobile
eas init
```

### 3.2 Compilar

```powershell
cd apps\mobile
eas build --platform android --profile preview
```

- Se compila en los servidores de Expo. En el plan gratuito la cola es de **prioridad baja** y puede tardar bastante (la página oficial advierte de esperas de 90 minutos o más en horas pico). Hay un tope de 45 minutos por compilación y un número limitado de compilaciones gratuitas ("up to 15 Android and 15 iOS builds"; verifica si es mensual).
- Al terminar, EAS muestra un **enlace y un QR** para descargar el `.apk`.

### 3.3 Instalar en el teléfono **[hardware]**

1. Abre el enlace en el teléfono (o descarga el `.apk` en la PC y pásalo por USB).
2. Android pedirá permiso para **"instalar apps de origen desconocido"** para la aplicación desde la que abres el archivo (navegador o administrador de archivos). Actívalo **solo para ese paso** y desactívalo después.
3. Google Play Protect puede advertir que la app no es de Play Store. Es esperable con un APK propio.
4. Abre **Esotérica Amara**, escribe/confirma la dirección del servidor e inicia sesión **con internet la primera vez** (para descargar catálogo y crear el acceso sin conexión).

### 3.4 Actualizar la app

Instalar un APK nuevo **encima** del anterior conserva los datos **siempre que sea el mismo paquete y esté firmado con la misma llave** (EAS gestiona la llave por ti). Sube `android.versionCode` en `app.json` en cada versión nueva; si no, Android puede rechazar la actualización. **Antes de actualizar, sincroniza** para que no queden operaciones pendientes en el teléfono. Desinstalar la app **borra su base local**: lo no sincronizado se pierde.

## 4. Permisos de Android

La app declara **solo `CAMERA`** (`app.json`). El texto que se muestra al pedirlo:

> "Esotérica Amara usa la cámara para leer códigos de barras y códigos QR."

No se pide micrófono (`microphonePermission: false`, `recordAudioAndroid: false`). Si negaste el permiso por error: *Ajustes → Aplicaciones → Esotérica Amara → Permisos → Cámara → Permitir*.

Los formatos de código que la cámara reconoce realmente (Code 128, EAN-13, UPC, QR…) dependen de la librería y del dispositivo: **pruébalos con tus etiquetas reales** (escenario 4 de [PRUEBAS.md](PRUEBAS.md)).

## 5. Tráfico HTTP sin cifrar (por qué y qué riesgo tiene)

`app.json` activa `usesCleartextTraffic: true` para que el teléfono pueda hablar con la PC por la red local, que usa **HTTP sin cifrar** (las peticiones van firmadas, pero su contenido es visible en esa red). Consecuencia: Android **no bloquea** conexiones HTTP en general. Por eso:

- La URL de la **API en internet debe ser siempre `https://`**.
- Usa el enlace teléfono–PC solo en la **red Wi-Fi de la tienda**, protegida con contraseña; no en redes públicas.

## 6. Cómo funciona sin conexión (límites honestos)

- **Inicio de sesión sin internet:** solo si ya iniciaste sesión **con internet** antes en ese teléfono. El acceso sin conexión **caduca a los 30 días** de la última conexión (`OFFLINE_LOGIN_MAX_DAYS`) y la sesión sin conexión dura **12 horas** (`OFFLINE_SESSION_HOURS`). Tras **5 intentos fallidos** de contraseña sin conexión, la app se bloquea 1 minuto, luego 2, 4, 8… hasta 1 hora.
- **Datos viejos:** la app avisa cuando la última sincronización tiene más de **1 hora** (aviso) o **24 horas** (crítico).
- **Sincronización automática:** cada 3 minutos con la app abierta y con red; con un mínimo de 20 segundos entre intentos. El resumen del gerente se refresca cada 60 s mientras la pantalla está visible.
- **Entradas de mercancía sin conexión:** más restrictivas que en la PC (ver [PERMISOS.md](PERMISOS.md), sección 3).
- **Impresión desde el teléfono:** la app usa `expo-print` (impresión del sistema Android/PDF). **No se garantiza** impresión directa en cualquier impresora térmica ni que todos los modelos funcionen con todos los teléfonos **[hardware]**. Si no hay impresora, el ticket queda guardado y se puede imprimir después.
- **Si la PC está averiada**, el teléfono no puede imprimir por ella.

## 7. Vincular el teléfono a la PC (modo escáner)

1. En la PC, activa la vinculación y muestra el **QR de vinculación** (caduca; se usa una sola vez).
2. En el teléfono, abre la sección de vinculación y escanea ese QR. PC y teléfono deben estar en la misma red.
3. Comprueba con una lectura de prueba: el teléfono debe mostrar si la PC la recibió.
4. Para desvincular, **revoca** el dispositivo en la PC.

## 8. Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| "No se puede conectar al servidor" | URL con `https://`; que la API esté despierta (Render gratis tarda ~1 min tras dormir); internet del teléfono |
| El QR de Expo Go no abre | PC y teléfono en la misma red; firewall de Windows (permitir "Redes privadas" para Node) |
| No lee códigos | Permiso de cámara; luz; etiqueta impresa con buena calidad; formato soportado |
| No puedo entrar sin internet | Debes haber iniciado sesión con internet en ese teléfono en los últimos 30 días; el usuario no debe estar bloqueado |
| No puedo dar entradas | Falta permiso temporal vigente, falta sincronizar, reloj atrasado o permisos con más de 24 h |
| La APK no se instala | Permiso de "orígenes desconocidos"; `versionCode` mayor; misma firma que la instalada |
