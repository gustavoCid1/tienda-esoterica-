# MongoDB Atlas: crear la base de datos central

> Revisión: 22/10/2026. **[servicio externo]** Estos pasos requieren una cuenta real de MongoDB Atlas; **no se han ejecutado** desde este repositorio. La interfaz de Atlas cambia con frecuencia: si un nombre de botón no coincide, busca el equivalente. Los límites del plan gratuito están en [SERVICIOS_GRATUITOS.md](SERVICIOS_GRATUITOS.md).

## Qué vas a lograr

Una base llamada **`amara`** en un cluster gratuito, un usuario con permisos **mínimos** solo sobre esa base, y una **cadena de conexión** que solo conocerá el servidor (API). Ninguna app de escritorio, móvil o web recibe jamás esa cadena.

## Paso 1. Crear la cuenta y el proyecto

1. Entra a <https://www.mongodb.com/cloud/atlas> y crea una cuenta (con correo y contraseña fuerte; activa la verificación en dos pasos).
2. Crea una **organización** y un **proyecto** (por ejemplo "Esoterica Amara").
3. Si en algún momento te pide **tarjeta, plan de pago o facturación, detente**: no la agregues sin autorización de la dueña. El plan gratuito se puede crear sin pagar; compruébalo al registrarte.

## Paso 2. Crear el cluster gratuito

1. **Create a cluster** (o *Build a Database*) y elige la opción **Free** (antes "M0"). **No elijas Flex ni M10 o superiores**: son de pago.
2. Proveedor y región: elige la opción gratuita **más cercana** a México que Atlas te ofrezca (la oferta de regiones del plan gratuito puede cambiar). Esto afecta la velocidad.
3. Nombre: por ejemplo `Cluster0` (el predeterminado).
4. Crear. Tarda unos minutos.

Límites que debes conocer (detalle en [SERVICIOS_GRATUITOS.md](SERVICIOS_GRATUITOS.md)): **512 MB**, pausa tras **30 días sin conexiones**, un cluster gratuito por proyecto, tope de transferencia por 7 días, y un límite de conexiones (la documentación de hoy dice 500; otras fuentes dicen 100: **verifícalo** en la documentación oficial).

## Paso 3. Crear el usuario con permisos mínimos

1. Menú **Database Access** (Acceso a la base) → **Add New Database User**.
2. Método: **Password**. Usuario sugerido: `amara_api`.
3. **Contraseña:** usa **Autogenerate Secure Password** y cópiala a un gestor de contraseñas. Si la inventas, que sea larga y sin palabras. Evita en lo posible caracteres especiales; si los tiene, ver Paso 5.
4. **Database User Privileges:** elige **Specific Privileges** (privilegios específicos) y agrega:
   - Rol: **`readWrite`**
   - Base de datos: **`amara`**
   - Colección: déjala vacía (todas las de esa base).
5. **No uses** los roles "Atlas admin" ni "Read and write to any database".
6. Opcional: **Restrict Access to Specific Clusters** → tu cluster.
7. Guardar (*Add User*).

> `readWrite` incluye crear colecciones e índices, que la API necesita al arrancar (`ensureIndexes`). No necesita ser administrador.

## Paso 4. Lista de IP permitidas (Network Access)

Atlas rechaza conexiones desde direcciones no autorizadas.

- **Para desarrollar en tu PC:** *Network Access → Add IP Address → Add Current IP Address*.
- **Para una API en Render (plan gratuito):** las direcciones de salida de Render **pueden cambiar** y no son fijas en el plan gratuito. La opción práctica es permitir **`0.0.0.0/0`** ("Allow access from anywhere").

**Riesgo de `0.0.0.0/0`, dicho claramente:** cualquiera en internet puede *intentar* conectarse a tu base. Lo único que lo impide es la contraseña del usuario y el cifrado de la conexión. Por eso: (1) contraseña larga y aleatoria, (2) usuario con permisos mínimos solo sobre `amara`, (3) nunca publicar la cadena de conexión, (4) revisar de vez en cuando *Database Access* y los registros de acceso de Atlas. Si más adelante consigues direcciones de salida fijas, sustituye `0.0.0.0/0` por esas direcciones.

## Paso 5. Obtener la cadena de conexión

1. En *Database* (Clusters), botón **Connect** de tu cluster → **Drivers** → **Node.js**.
2. Copia la cadena. Se parece a:

```text
mongodb+srv://amara_api:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

3. Reemplaza `<password>` por la contraseña real (sin los símbolos `<` `>`).
4. **Si la contraseña tiene caracteres especiales** como `@ : / ? # [ ] % + ` debes **codificarlos** (por ejemplo `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `%` → `%25`). Si no, la conexión falla con errores confusos. Es más fácil generar una contraseña solo con letras y números.

## Paso 6. Configurar la API

```powershell
Copy-Item apps\api\.env.example apps\api\.env
notepad apps\api\.env
```

Completa (explicación completa en el [README](../README.md), sección 6):

```ini
MONGODB_URI=mongodb+srv://amara_api:TU_CONTRASENA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=amara
JWT_SECRET=<48 bytes aleatorios>
PORT=8080
CORS_ORIGINS=http://localhost:5173
```

Genera el `JWT_SECRET` con:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**`apps/api/.env` nunca se sube a GitHub** (`.gitignore` ya lo excluye, salvo `.env.example`). La API se niega a arrancar si falta `MONGODB_URI` o `JWT_SECRET`, o si este último tiene menos de 32 caracteres.

## Paso 7. Crear el primer gerente (seed)

La base nace vacía y no hay usuarios. El script `seed` crea el **primer gerente**.

1. En `apps/api/.env` completa temporalmente:

```ini
SEED_MANAGER_USERNAME=gerente
SEED_MANAGER_NAME=Nombre de la dueña
SEED_MANAGER_PASSWORD=UnaContrasenaLargaYUnica
```

2. Ejecuta (una sola vez):

```powershell
npm run seed
```

3. **Borra `SEED_MANAGER_PASSWORD` del `.env`** después y cambia la contraseña desde la aplicación si es posible.

Reglas del código: el usuario tiene entre 3 y 40 caracteres (letras, números, `.`, `_`, `-`); la contraseña, al menos 8 caracteres; se guarda **solo como hash scrypt**. **[por confirmar]** `apps/api/src/seed.ts` se está escribiendo en paralelo: revisa en ese archivo qué más crea (primera sucursal, terminal, etc.) y si exige la sucursal.

## Paso 8. Verificar

1. Arranca la API: `npm run dev:api`.
2. Abre <http://localhost:8080/health>: debe responder `{ ok, time, version }`.
3. En Atlas → *Browse Collections* debe aparecer la base `amara` con colecciones e índices (los crea `ensureIndexes()` al arrancar).
4. Inicia sesión en la web o en la app con el gerente creado.

Si falla: *"MongoServerSelectionError"* suele ser IP no permitida (Paso 4), cadena mal escrita o contraseña sin codificar (Paso 5); *"Authentication failed"* es usuario/contraseña.

## Operación del día a día

- **Almacenamiento:** *Metrics* o la tarjeta del cluster muestra el uso frente a 512 MB. Con fotos grandes se llena rápido.
- **Cluster pausado:** si pasaron 30 días sin conexiones, Atlas lo pausa. Entra a Atlas y pulsa **Resume**. La tienda sigue vendiendo con su base local mientras tanto.
- **Respaldos:** ver [RESPALDOS.md](RESPALDOS.md). No dependas solo de la función de respaldo de Atlas.
- **Rotar la contraseña del usuario:** cambia la contraseña en *Database Access*, actualiza `MONGODB_URI` en el servidor (Render) y reinicia.
- **Si se filtró la cadena de conexión:** cambia de inmediato la contraseña del usuario en Atlas.
