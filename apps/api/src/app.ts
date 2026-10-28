/**
 * Construcción de la aplicación Express (sin abrir el puerto ni conectar a la base),
 * para poder reutilizarla en pruebas.
 *
 * Seguridad de montaje:
 *  - TODO excepto /health y /auth/login exige token (`authenticate`).
 *  - Los tokens de TERMINAL solo pasan en /sync/*: el resto monta `requireUser`.
 *  - Cada router aplica además su permiso por ruta (`requirePerm`), leído del rol en la base.
 */
import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { authenticate, requireUser } from './auth.ts';
import { config } from './config.ts';
import { errorHandler, HttpError } from './http.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { cashRouter } from './routes/cash.ts';
import { catalogRouter } from './routes/catalog.ts';
import { inventoryRouter } from './routes/inventory.ts';
import { prefsRouter } from './routes/prefs.ts';
import { salesRouter } from './routes/sales.ts';
import { statsRouter } from './routes/stats.ts';
import { syncRouter } from './routes/sync.ts';

export interface AppOptions {
  /** Solo pruebas: sustituye la autenticación real (que consulta la base). */
  authenticate?: RequestHandler;
  corsOrigins?: string[];
}

/** Errores de lectura del cuerpo (JSON inválido o demasiado grande) → 400/413 en vez de 500. */
const bodyErrors: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err?.type === 'entity.parse.failed') return next(new HttpError(400, 'El cuerpo de la petición no es JSON válido'));
  if (err?.type === 'entity.too.large') return next(new HttpError(413, 'La petición es demasiado grande'));
  next(err);
};

export function createApp(opts: AppOptions = {}) {
  const auth: RequestHandler = opts.authenticate ?? authenticate;
  const origins = opts.corsOrigins ?? config.corsOrigins;
  const app = express();

  // Detrás de un proxy (Render, Railway, Fly...) hay que indicar cuántos saltos confiar para ver la IP real.
  const trust = Number(process.env.TRUST_PROXY ?? 0);
  if (trust > 0) app.set('trust proxy', trust);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      // Sin cabecera Origin (apps de escritorio/móvil, curl) se permite; los navegadores solo desde CORS_ORIGINS.
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      allowedHeaders: ['authorization', 'content-type', 'x-reauth'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Demasiadas peticiones' } }));

  // La foto del producto llega como data URL (hasta ~2 MB); el resto de rutas usa un límite más estricto.
  app.use('/catalog', express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(bodyErrors);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), version: config.version });
  });

  app.use('/auth', authRouter); // /auth/login es pública; el resto autentica dentro del router
  app.use('/sync', auth, syncRouter); // única zona donde se acepta token de terminal
  for (const [path, router] of [
    ['/catalog', catalogRouter],
    ['/inventory', inventoryRouter],
    ['/sales', salesRouter],
    ['/cash', cashRouter],
    ['/stats', statsRouter],
    ['/prefs', prefsRouter],
    ['/admin', adminRouter],
  ] as const) {
    app.use(path, auth, requireUser, router);
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use(errorHandler);
  return app;
}
