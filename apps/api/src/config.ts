/** Configuración desde variables de entorno. Falla al arrancar si falta algo crítico. */
try {
  // Node >= 20.12: carga .env sin dependencias. Si no existe el archivo, se usan las variables del sistema.
  (process as any).loadEnvFile?.();
} catch {
  /* sin .env */
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (revisa apps/api/.env)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  mongoUri: required('MONGODB_URI'),
  dbName: process.env.MONGODB_DB ?? 'amara',
  jwtSecret: (() => {
    const s = required('JWT_SECRET');
    if (s.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
    return s;
  })(),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  version: '1.0.0',
};
