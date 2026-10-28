/** /auth: inicio de sesión, reautenticación y datos de la sesión. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DESKTOP_ROLES, ROLE_PERMISSIONS } from '@amara/shared';
import { hashPassword, verifyPassword } from '@amara/shared/password';
import { loginSchema } from '@amara/shared/schemas';
import { audit } from '../audit.ts';
import { authenticate, requireUser, signReauth, signSession } from '../auth.ts';
import { col } from '../db.ts';
import { ah, HttpError, parse } from '../http.ts';
import { publicUser } from '../serialize.ts';
import { sessionUser } from '../util.ts';

/** Límite por IP para contraseñas (login y reautenticación). Además hay bloqueo por cuenta. */
export const passwordLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

let dummyHash: string | undefined;

/**
 * Verifica la contraseña. Si el usuario no existe se verifica contra un hash falso para que la
 * respuesta tarde lo mismo y no se pueda averiguar qué usuarios existen. (scrypt es síncrono: el
 * límite de tasa evita que se use para saturar el servidor.)
 */
export function checkPassword(user: { passwordHash?: string } | null, password: string): boolean {
  if (!user?.passwordHash) {
    dummyHash ??= hashPassword('contrasena-ficticia-0000');
    verifyPassword(password, dummyHash);
    return false;
  }
  try {
    return verifyPassword(password, user.passwordHash);
  } catch {
    return false; // hash corrupto
  }
}

async function registerFailure(userId: string): Promise<void> {
  const upd = await col('users').findOneAndUpdate({ _id: userId }, { $inc: { failedLogins: 1 } }, { returnDocument: 'after' });
  if ((upd?.failedLogins ?? 0) >= MAX_FAILS) {
    await col('users').updateOne({ _id: userId }, { $set: { lockedUntil: new Date(Date.now() + LOCK_MS).toISOString(), failedLogins: 0 } });
  }
}

const isLocked = (u: { lockedUntil?: string | null } | null) => !!u?.lockedUntil && u.lockedUntil > new Date().toISOString();

export const authRouter = Router();

authRouter.post(
  '/login',
  passwordLimiter,
  ah(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const username = body.username.toLowerCase();
    const user = await col('users').findOne({ username });
    if (isLocked(user)) throw new HttpError(429, 'Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo más tarde.');

    // Siempre se verifica la contraseña (mismo tiempo exista o no el usuario).
    const passwordOk = checkPassword(user, body.password);
    if (!user || !user.active || !passwordOk) {
      if (user) await registerFailure(user._id);
      await audit({ userId: user?._id ?? null, action: 'auth.login_fallido', entity: 'user', entityId: user?._id, detail: { username: username.slice(0, 40), ip: req.ip } });
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    // El punto de venta (terminal) solo admite gerente y vendedor; el desarrollador no vende.
    if (body.terminalId && !DESKTOP_ROLES.includes(user.role)) throw new HttpError(403, 'Este usuario no puede iniciar sesión en el punto de venta');

    const now = new Date().toISOString();
    await col('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: now, failedLogins: 0, lockedUntil: null } });
    const { token, expiresAt } = await signSession(user._id);
    await audit({ userId: user._id, action: 'auth.login', entity: 'user', entityId: user._id, detail: { terminalId: body.terminalId ?? null, ip: req.ip } });
    res.json({ token, expiresAt, user: { id: user._id, name: user.name, username: user.username, role: user.role, branchIds: user.branchIds ?? [] } });
  }),
);

authRouter.post(
  '/reauth',
  authenticate,
  requireUser,
  passwordLimiter,
  ah(async (req, res) => {
    const me = sessionUser(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const user = await col('users').findOne({ _id: me.id });
    if (isLocked(user)) throw new HttpError(429, 'Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo más tarde.');
    if (!user || !checkPassword(user, password)) {
      if (user) await registerFailure(user._id);
      await audit({ userId: me.id, action: 'auth.reauth_fallido', entity: 'user', entityId: me.id, detail: { ip: req.ip } });
      throw new HttpError(401, 'Contraseña incorrecta');
    }
    await col('users').updateOne({ _id: user._id }, { $set: { failedLogins: 0 } });
    res.json({ token: await signReauth(me.id), expiresInSeconds: 300 });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  requireUser,
  ah(async (req, res) => {
    const me = sessionUser(req);
    const [user, branches] = await Promise.all([
      col('users').findOne({ _id: me.id }),
      col('branches').find({ _id: { $in: me.branchIds } }).toArray(),
    ]);
    res.json({
      user: user ? publicUser(user) : null,
      branches: branches.map((b) => ({ id: b._id, code: b.code, name: b.name, status: b.status ?? 'activa', locations: b.locations ?? [] })),
    });
  }),
);

/** Solo para mostrar u ocultar opciones en la interfaz: la autorización real se hace en cada ruta. */
authRouter.get(
  '/permissions',
  authenticate,
  requireUser,
  ah(async (req, res) => {
    res.json({ permissions: [...ROLE_PERMISSIONS[sessionUser(req).role]] });
  }),
);
