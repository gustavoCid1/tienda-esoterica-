// Punto de entrada personalizado.
// El orden importa: los polyfills deben ejecutarse ANTES de que se cargue cualquier
// módulo que use `crypto` (@noble/hashes lee globalThis.crypto al cargarse).
import './src/polyfills';
import 'expo-router/entry';
