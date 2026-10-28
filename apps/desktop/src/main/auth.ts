/**
 * Sesión de usuario del escritorio (vive SOLO en el proceso principal).
 *
 *  - Solo entran los roles `gerente` y `vendedor` (DESKTOP_ROLES); `desarrollador` no.
 *  - Verificación EN LÍNEA contra la API (POST /auth/login) cuando hay conexión. Si responde
 *    que las credenciales son incorrectas, esa respuesta manda (no se cae al modo local).
 *  - Verificación LOCAL (sin internet): contra el verificador `scrypt$...` guardado en
 *    users_local tras un inicio de sesión en línea. NUNCA se guarda la contraseña.
 *  - Bloqueo temporal tras 5 intentos fallidos seguidos por usuario (60 s).
 *  - Cambiar de usuario exige cerrar la sesión (no existe "cambio rápido").
 *  - Las acciones sensibles (cancelar, devolver, corte) piden la contraseña otra vez: `reauth`.
 */
import { net } from 'electron';
import type { LocalStore } from '@amara/database';
import { StoreError } from '@amara/database';
import { DESKTOP_ROLES } from '@amara/shared';
import type { Role } from '@amara/shared';
import { hashPassword, verifyPassword } from '@amara/shared/password';
import type { Actor, DeviceInfo } from '@amara/database';
import type { SessionUser } from '../shared/ipc.ts';
import { ApiError, apiRequest, isNetworkFailure } from './api-client.ts';
import { auditLocal } from './audit.ts';
import { AppError } from './errors.ts';

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: { id: string; name: string; username: string; role: Role; branchIds: string[] };
}

interface Session {
  user: SessionUser;
  /** Token de sesión de la API (solo si el inicio de sesión fue en línea). */
  token: string | null;
}

const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export class AuthService {
  private session: Session | null = null;
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(private d: { store: LocalStore; getApiUrl: () => string; getDevice: () => Promise<DeviceInfo | undefined> }) {}

  current(): SessionUser | null {
    return this.session?.user ?? null;
  }

  /** Token de la API para acciones en línea (alta de productos), o null si se entró sin internet. */
  apiToken(): string | null {
    return this.session?.token ?? null;
  }

  actor(): Actor {
    if (!this.session) throw new AppError('sin_sesion', 'Inicia sesión para continuar.');
    return { userId: this.session.user.id, userName: this.session.user.name, role: this.session.user.role };
  }

  private checkLock(key: string): void {
    const f = this.failures.get(key);
    if (f && f.lockedUntil > Date.now()) {
      throw new AppError('bloqueado', `Demasiados intentos. Espera ${Math.ceil((f.lockedUntil - Date.now()) / 1000)} segundos e inténtalo de nuevo.`);
    }
  }

  private fail(key: string): void {
    const f = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILURES) {
      f.count = 0;
      f.lockedUntil = Date.now() + LOCK_MS;
    }
    this.failures.set(key, f);
  }

  async login(usernameRaw: string, password: string): Promise<SessionUser> {
    const username = usernameRaw.trim();
    if (!username || !password) throw new AppError('datos_faltantes', 'Escribe tu usuario y contraseña.');
    const key = username.toLowerCase();
    this.checkLock(key);
    const device = await this.d.getDevice();
    if (!device) throw new AppError('sin_activar', 'Esta terminal aún no está activada. Pide al gerente que la active.');

    let user: SessionUser | null = null;
    let token: string | null = null;

    // 1) En línea.
    const apiUrl = this.d.getApiUrl();
    if (apiUrl && net.isOnline()) {
      try {
        const res = await apiRequest<LoginResponse>(apiUrl, '/auth/login', { body: { username, password }, timeoutMs: 8000 });
        token = res.token;
        user = { id: res.user.id, username: res.user.username, name: res.user.name, role: res.user.role, branchIds: res.user.branchIds ?? [], onlineLogin: true };
        await this.rememberUser(user, password);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          this.fail(key);
          throw new AppError('credenciales', 'Usuario o contraseña incorrectos.');
        }
        if (e instanceof ApiError && e.status === 429) throw new AppError('limite', 'Demasiados intentos. Espera un momento.');
        if (!isNetworkFailure(e)) throw new AppError('api', e instanceof Error ? e.message : String(e));
        // Sin servidor: se continúa con la verificación local.
      }
    }

    // 2) Local (sin internet).
    if (!user) {
      const local = await this.d.store.getUserByUsername(username);
      if (!local || !local.verifier) {
        throw new AppError(
          'sin_credenciales_locales',
          'No hay credenciales guardadas para este usuario en esta terminal. La primera vez hay que iniciar sesión con internet.',
        );
      }
      if (!verifyPassword(password, local.verifier)) {
        this.fail(key);
        throw new AppError('credenciales', 'Usuario o contraseña incorrectos.');
      }
      user = { id: local.id, username: local.username, name: local.name, role: local.role, branchIds: local.branchIds, onlineLogin: false };
    }

    if (!DESKTOP_ROLES.includes(user.role)) {
      throw new AppError('rol_no_permitido', 'Este usuario no puede entrar al punto de venta (solo gerente y vendedor).');
    }
    if (user.branchIds.length > 0 && !user.branchIds.includes(device.branchId)) {
      throw new AppError('sucursal_no_permitida', 'Este usuario no tiene acceso a la sucursal de esta terminal.');
    }

    this.failures.delete(key);
    this.session = { user, token };
    await auditLocal(this.d.store, { userId: user.id, action: 'sesion.inicio', branchId: device.branchId, terminalId: device.terminalId, detail: { online: user.onlineLogin } });
    return user;
  }

  async logout(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (s) await auditLocal(this.d.store, { userId: s.user.id, action: 'sesion.cierre' });
  }

  /** Vuelve a pedir la contraseña del usuario actual para una acción sensible. */
  async reauth(password: string): Promise<void> {
    if (!this.session) throw new AppError('sin_sesion', 'Inicia sesión para continuar.');
    const key = `reauth:${this.session.user.username.toLowerCase()}`;
    this.checkLock(key);
    const local = await this.d.store.getUserByUsername(this.session.user.username);
    let ok = false;
    if (local?.verifier) {
      ok = verifyPassword(password, local.verifier);
    } else if (this.d.getApiUrl() && net.isOnline()) {
      try {
        await apiRequest(this.d.getApiUrl(), '/auth/login', { body: { username: this.session.user.username, password }, timeoutMs: 8000 });
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      this.fail(key);
      throw new AppError('credenciales', 'La contraseña no es correcta.');
    }
    this.failures.delete(key);
  }

  /** Guarda al usuario y su verificador local (hash scrypt) para poder entrar sin internet. */
  private async rememberUser(u: SessionUser, password: string): Promise<void> {
    let verifier: string | null = null;
    try {
      verifier = hashPassword(password);
    } catch {
      verifier = null; // contraseña de menos de 8 caracteres: solo podrá entrar con internet
    }
    try {
      await this.d.store.db.run(
        `INSERT INTO users_local (id, username, name, role, branch_ids_json, active, verifier, updated_at) VALUES (?,?,?,?,?,1,?,?)
         ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, role = excluded.role,
           branch_ids_json = excluded.branch_ids_json, active = 1,
           verifier = COALESCE(excluded.verifier, users_local.verifier), updated_at = excluded.updated_at`,
        [u.id, u.username, u.name, u.role, JSON.stringify(u.branchIds), verifier, new Date().toISOString()],
      );
    } catch (e) {
      if (!(e instanceof StoreError)) {
        /* conflicto de nombre de usuario con otro registro: se ignora, el inicio de sesión en línea ya fue válido */
      }
    }
  }
}
