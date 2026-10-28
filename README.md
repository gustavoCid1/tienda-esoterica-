# Esotérica Amara — Sistema de inventario, punto de venta y caja

Sistema para la tienda **Esotérica Amara**: vender, controlar el inventario de dos o más sucursales, imprimir tickets y hacer el corte de caja, **incluso cuando no hay internet**.

> Última revisión de esta documentación: 22 de octubre de 2026.

---

## 0. ESTADO REAL DEL PROYECTO (léelo primero)

Este repositorio **se escribió en un entorno sin acceso a npm**. Eso significa, de forma muy concreta:

| Pregunta | Respuesta honesta |
|---|---|
| ¿Se han instalado las dependencias (`npm install`)? | **No.** |
| ¿Se ha compilado o revisado el código con TypeScript (`npm run typecheck`)? | **No.** Puede haber errores de tipos. |
| ¿Se han ejecutado las pruebas automatizadas (`npm test`)? | **No.** Las pruebas están escritas pero **nunca se han ejecutado**. Ver la nota sobre `npm test` más abajo. |
| ¿Se ha probado con una impresora térmica real? | **No.** Depende de hardware. |
| ¿Se ha probado en un teléfono Android real? | **No.** Depende de hardware. |
| ¿Se ha conectado a un MongoDB Atlas real? | **No.** Depende de un servicio externo. |
| ¿Se ha construido el instalador de Windows? | **No.** |

**Nada de lo que dice esta documentación debe tomarse como "probado".** Dice cómo está diseñado y cómo se debe verificar. Antes de usar el sistema con ventas reales hay que hacer, en este orden:

1. `npm install`
2. `npm run typecheck` y corregir lo que aparezca.
3. Ejecutar las pruebas automatizadas y corregir lo que falle (ver sección 7).
4. Recorrer los 27 escenarios de [docs/PRUEBAS.md](docs/PRUEBAS.md); todos están marcados **"sin ejecutar"**.
5. Hacer una semana de pruebas en paralelo con el método actual de la tienda antes de depender del sistema.

Qué existe en el código a la fecha de esta revisión (verificado leyendo los archivos):

- `packages/shared`: reglas de negocio (cálculo de ventas, caja, informes, permisos, fechas de México, folios, enlace seguro teléfono–PC). Con pruebas escritas.
- `packages/database`: esquema SQLite local, migraciones, protecciones contra borrado y el almacén local (`LocalStore`) con ventas, caja, inventario, cola de sincronización y respaldos. Con pruebas escritas.
- `packages/sync`: protocolo de sincronización, ciclo "enviar y luego bajar", enlace LAN. Con pruebas escritas (con un servidor simulado).
- `apps/api`: configuración, conexión y índices de MongoDB, autenticación, auditoría. **Las rutas del servidor las escribe otro proceso en paralelo**; el contrato está en [docs/API.md](docs/API.md).
- `apps/desktop`, `apps/mobile`, `apps/web`: **en elaboración por otros procesos**. Si una carpeta solo tiene `assets`, esa aplicación todavía no existe.

> Si algo de esta documentación contradice al código, **manda el código**; avisa para corregir el documento.

---

## 1. ¿Qué es?

Tres aplicaciones conectadas a una API central:

| Aplicación | Para qué sirve | Tecnología |
|---|---|---|
| **Escritorio (Windows)** | Punto de venta en el mostrador: escáner USB, ticket en impresora térmica, caja, inventario. Sigue vendiendo sin internet. | Electron + React + SQLite |
| **Móvil (Android)** | Escáner, consulta de inventario, ventas de emergencia, y para la dueña/gerente: **"Resumen de ventas de hoy"**. | Expo + React Native + SQLite |
| **Web administrativa** | Dashboard, catálogo, usuarios, sucursales, informes, tickets, cortes, auditoría. | React + Vite |
| **API central** | Valida todo y guarda en la nube. Es la única que habla con la base de datos central. | Node.js + Express + MongoDB Atlas |

Idea clave: **cada venta se guarda primero en el equipo donde se hizo (SQLite)** y después se envía a la nube. Por eso una caída de internet no detiene la tienda.

## 2. Arquitectura en una imagen

```mermaid
flowchart LR
  subgraph Tienda
    PC["PC Windows<br/>App de escritorio<br/>SQLite local"]
    IMP["Impresora térmica"]
    ESC["Escáner USB"]
    TEL["Teléfono Android<br/>App móvil<br/>SQLite local"]
    ESC --> PC
    PC --> IMP
    PC <-- "Wi-Fi de la tienda<br/>(sin internet)" --> TEL
  end
  subgraph Nube
    API["API (Render u otro)"]
    DB[("MongoDB Atlas")]
    API --> DB
  end
  WEB["Página web<br/>administrativa"] --> API
  PC <-- "cuando hay internet" --> API
  TEL <-- "cuando hay internet" --> API
```

Más detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## 3. Estructura del repositorio

```text
esoterica-amara/
├── apps/
│   ├── api/        Servidor (Express + MongoDB). Aquí se validan permisos y se guarda en la nube.
│   ├── web/        Página web administrativa (React + Vite).
│   ├── desktop/    Punto de venta de Windows (Electron).
│   └── mobile/     App Android (Expo).
├── packages/
│   ├── shared/     Reglas de negocio compartidas: dinero, ventas, caja, informes, permisos, fechas, folios.
│   ├── database/   Esquema SQLite, migraciones y almacén local (ventas, caja, cola de sincronización).
│   └── sync/       Protocolo de sincronización y enlace teléfono–PC.
├── docs/           Toda la documentación (ver sección 9).
├── assets/brand/   Logotipo de la tienda.
├── package.json    Raíz del monorepo (npm workspaces).
└── .gitignore      Evita subir contraseñas, bases de datos y respaldos.
```

## 4. Requisitos

| Qué | Versión recomendada | Para qué |
|---|---|---|
| Windows 10/11 | — | PC del mostrador |
| **Node.js** | **22 LTS, versión 22.18 o mayor** (o 24 LTS). El `package.json` dice `>=20`, pero las pruebas usan `node:sqlite` y ejecutan TypeScript directamente; ver nota en la sección 7. | Instalar y ejecutar todo |
| npm | el que trae Node | Instalar dependencias |
| Git | cualquiera reciente | Descargar y versionar el código |
| Cuenta de MongoDB Atlas (gratis) | M0 | Base central. [docs/MONGODB_ATLAS.md](docs/MONGODB_ATLAS.md) |
| Android 8 o superior (sugerido) | — | Teléfono. **No verificado**; depende del hardware |
| Impresora térmica de 58 u 80 mm instalada en Windows | — | Tickets. **Depende de hardware; no probado** |
| Escáner USB que funcione como teclado | — | Lectura de códigos |

## 5. Instalación paso a paso (Windows / PowerShell)

Abre **PowerShell** (menú Inicio, escribe "PowerShell"). No hace falta "como administrador" para estos pasos.

### 5.1 Instalar Node.js y Git

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Cierra y vuelve a abrir PowerShell, y comprueba:

```powershell
node -v    # debe mostrar v22.18.0 o mayor
npm -v
git --version
```

Si `winget` no existe, descarga Node.js LTS desde <https://nodejs.org> y Git desde <https://git-scm.com>.

### 5.2 Descargar el proyecto

```powershell
cd $HOME\Documents
git clone <URL-DE-TU-REPOSITORIO> esoterica-amara
cd esoterica-amara
```

### 5.3 Instalar las dependencias

```powershell
npm install
```

> Primera vez que se ejecuta en este proyecto: **pueden aparecer errores** (versiones, módulos nativos como `better-sqlite3` para Electron, etc.). Anótalos y corrígelos antes de seguir; es parte del trabajo pendiente descrito en la sección 0.

### 5.4 Revisar que el código compila y que las pruebas pasan

```powershell
npm run typecheck
```

Para las pruebas ver la sección 7.

### 5.5 Configurar el servidor (API)

1. Crea la base en MongoDB Atlas siguiendo [docs/MONGODB_ATLAS.md](docs/MONGODB_ATLAS.md).
2. Copia el archivo de ejemplo:

```powershell
Copy-Item apps\api\.env.example apps\api\.env
notepad apps\api\.env
```

3. Rellena los valores (ver sección 6). **Nunca subas `.env` a GitHub** (ya está en `.gitignore`).
4. Crea el primer usuario gerente (solo la primera vez):

```powershell
npm run seed
```

## 6. Variables de entorno

Archivo `apps/api/.env` (el modelo está en `apps/api/.env.example`):

| Variable | Obligatoria | Qué es | Ejemplo / nota |
|---|---|---|---|
| `MONGODB_URI` | Sí | Cadena de conexión de Atlas con un usuario de permisos mínimos (solo la base `amara`). | `mongodb+srv://USUARIO:CONTRASENA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority` |
| `MONGODB_DB` | No (por defecto `amara`) | Nombre de la base. | `amara` |
| `JWT_SECRET` | Sí | Secreto para firmar sesiones. **Mínimo 32 caracteres**, aleatorio. La API no arranca si es más corto. | Generar con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `PORT` | No (por defecto 8080) | Puerto de la API. | `8080` |
| `CORS_ORIGINS` | No | Direcciones web permitidas, separadas por coma. Las apps móvil y de escritorio no lo usan. | `http://localhost:5173` |
| `SEED_MANAGER_USERNAME` | Solo para `npm run seed` | Usuario del primer gerente. | `gerente` |
| `SEED_MANAGER_NAME` | Solo para `npm run seed` | Nombre mostrado. | `Gerente` |
| `SEED_MANAGER_PASSWORD` | Solo para `npm run seed` | Contraseña inicial (mínimo 8 caracteres según las reglas de `packages/shared`). Cámbiala después y bórrala del archivo. | — |

Las variables de las apps cliente (dirección de la API, etc.) las define cada aplicación; consulta el README de su carpeta cuando exista.

## 7. Cómo arrancar cada parte

Todos los comandos se ejecutan en la carpeta raíz del proyecto.

| Qué | Comando | Notas |
|---|---|---|
| API (desarrollo) | `npm run dev:api` | Necesita `apps/api/.env`. Comprobar: abrir <http://localhost:8080/health>. |
| Web (desarrollo) | `npm run dev:web` | Normalmente en <http://localhost:5173>. |
| Escritorio (desarrollo) | `npm run dev:desktop` | Abre la ventana de Electron. |
| Móvil (desarrollo) | `npm run dev:mobile` | Muestra un QR para abrir con **Expo Go**. Ver [docs/INSTALACION_ANDROID.md](docs/INSTALACION_ANDROID.md). |
| Primer gerente | `npm run seed` | Una sola vez. |
| Respaldo de MongoDB | `npm run backup:mongo -w @amara/api` | Ver [docs/RESPALDOS.md](docs/RESPALDOS.md). |
| Compilar web | `npm run build:web` | |
| Instalador de Windows | `npm run build:desktop` | Ver [docs/INSTALACION_WINDOWS.md](docs/INSTALACION_WINDOWS.md). |
| Revisar tipos | `npm run typecheck` | |
| Pruebas | ver abajo | |

### Nota importante sobre `npm test`

El `package.json` raíz define `npm test` como `npm run test --workspaces --if-present`. **Los paquetes `shared`, `database` y `sync` NO tienen un script `test` en su `package.json`**, así que, tal como está, `npm test` **no ejecuta ninguna de las pruebas** y termina "bien" sin haber probado nada. Es una inconsistencia detectada al escribir esta documentación.

Mientras no se corrija, las pruebas existentes (usan el ejecutor integrado de Node, `node:test`) se lanzan a mano desde la raíz:

```powershell
node --test packages/shared/test/sales.test.ts packages/shared/test/cash-reports.test.ts packages/database/test/local-store.test.ts packages/sync/test/sync.test.ts
```

Requisitos de ese comando (por lectura de la documentación de Node, **no verificado ejecutándolo**): Node 22.18 o superior (ejecuta archivos `.ts` sin configuración) y `node:sqlite` (incluido en Node 22.13+). Antes hay que haber corrido `npm install` para que `@amara/shared` y los demás paquetes se encuentren entre sí. Cuando alguna prueba falle, corrige el código o la prueba y documenta qué pasó; **no marques nada como aprobado sin haberlo visto pasar**.

## 8. Estado de verificación por tema

| Tema | Estado |
|---|---|
| Compilación de tipos | Sin ejecutar |
| Pruebas automatizadas de `shared`, `database`, `sync` | Escritas, sin ejecutar |
| Pruebas de la API, web, escritorio y móvil | No existen todavía (a la fecha de esta revisión) |
| Los 27 escenarios obligatorios | Sin ejecutar ([docs/PRUEBAS.md](docs/PRUEBAS.md)) |
| Impresión de dos copias | Requiere impresora física; sin probar |
| App Android / cámara / APK | Requiere teléfono; sin probar |
| MongoDB Atlas / Render | Requiere cuentas externas; sin probar |
| Respaldos y restauración | La copia consistente de SQLite tiene prueba escrita (sin ejecutar); el resto sin probar |

## 9. Documentación

| Documento | Para qué |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Cómo encajan las piezas, con diagramas |
| [docs/DICCIONARIO_DATOS.md](docs/DICCIONARIO_DATOS.md) | Todas las tablas SQLite y colecciones MongoDB |
| [docs/API.md](docs/API.md) | Contrato de la API |
| [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md) | Cómo viajan los datos y qué pasa en cada conflicto |
| [docs/SERVICIOS_GRATUITOS.md](docs/SERVICIOS_GRATUITOS.md) | Qué es gratis, qué no, y los riesgos |
| [docs/INSTALACION_WINDOWS.md](docs/INSTALACION_WINDOWS.md) | PC del mostrador, impresora, escáner, actualizaciones |
| [docs/INSTALACION_ANDROID.md](docs/INSTALACION_ANDROID.md) | Teléfono |
| [docs/MONGODB_ATLAS.md](docs/MONGODB_ATLAS.md) | Base de datos en la nube |
| [docs/DESPLIEGUE_API.md](docs/DESPLIEGUE_API.md) | Poner el servidor en internet |
| [docs/RESPALDOS.md](docs/RESPALDOS.md) | Copias de seguridad y restauración |
| [docs/SEGURIDAD.md](docs/SEGURIDAD.md) | Cómo se protegen los datos |
| [docs/CONTINGENCIA.md](docs/CONTINGENCIA.md) | Qué hacer cuando algo falla |
| [docs/PERMISOS.md](docs/PERMISOS.md) | Quién puede hacer qué |
| [docs/PRUEBAS.md](docs/PRUEBAS.md) | Los 27 escenarios de prueba |
| [docs/MANTENIMIENTO.md](docs/MANTENIMIENTO.md) | Cambios futuros, migraciones, publicar en GitHub |

## 10. Reglas que el sistema siempre respeta

- **El dinero siempre son centavos enteros** (nunca decimales), para que las sumas no se descuadren.
- **Las fechas se guardan en UTC** y se muestran en hora de México (`America/Mexico_City`).
- **Una venta no se borra ni se edita**: se cancela o se devuelve, y eso crea un registro nuevo. La base local lo impone con "triggers" (ver diccionario de datos).
- **El inventario solo cambia con movimientos registrados.**
- **Reenviar una operación nunca la duplica** (cada operación tiene un identificador único).
- **Una venta que ya ocurrió en el mostrador nunca se rechaza** por falta de existencias: se registra y, si deja inventario negativo, se avisa al gerente.
- **El ticket es un comprobante interno**, no una factura (no es CFDI).
- **Ninguna aplicación cliente contiene credenciales de MongoDB.**

## 11. Si algo falla

Empieza por [docs/CONTINGENCIA.md](docs/CONTINGENCIA.md). Para dudas de instalación, la sección "Problemas frecuentes" de [docs/INSTALACION_WINDOWS.md](docs/INSTALACION_WINDOWS.md).
