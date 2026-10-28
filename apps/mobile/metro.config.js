// Metro dentro de un monorepo npm workspaces.
// La configuracion por defecto de Expo detecta los workspaces (watchFolders y
// nodeModulesPaths) y sigue los enlaces simbolicos de node_modules/@amara/*.
// Los paquetes @amara/* se publican como codigo fuente .ts (main: ./src/index.ts);
// Metro los transpila con babel-preset-expo igual que el codigo de la app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Necesario para subrutas como '@amara/shared/password' y '@noble/hashes/scrypt'
// (campo "exports" de package.json). En SDK 53+ ya viene activo; se deja explicito.
config.resolver.unstable_enablePackageExports = true;

// La web y el escritorio usan React 18 (instalado en la raiz del proyecto) y la app movil usa
// React 19. Sin esto, librerias hoisted en la raiz cargan el React 18 y salen errores de
// "Invalid hook call". Aqui React y React Native se resuelven siempre desde apps/mobile.
const singletons = ['react', 'react-native'];
const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = singletons.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  const resolve = previousResolveRequest ?? context.resolveRequest;
  if (isSingleton) {
    return resolve(
      { ...context, originModulePath: path.join(__dirname, 'package.json') },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;