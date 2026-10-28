// Punto de entrada personalizado.
// El orden importa: los polyfills deben ejecutarse ANTES de que se cargue cualquier
// módulo que use `crypto` (@noble/hashes lee globalThis.crypto al cargarse).
import './src/polyfills';
// v2: declara la tarea en segundo plano de existencias bajas. Debe ejecutarse al cargar la app (no dentro de un componente).
import './src/services/background-alerts';
import 'expo-router/entry';
