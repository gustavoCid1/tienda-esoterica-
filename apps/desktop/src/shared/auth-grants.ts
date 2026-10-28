/**
 * Autorizaciones de acciones sensibles del escritorio (v2). Lógica PURA (sin Electron) y probada.
 *
 * Flujo: el vendedor escribe la contraseña de un administrador o el código de un token; el proceso principal la
 * valida (LocalStore.verifyActionAuthorization o /security/verify) y entrega a la pantalla un "boleto" opaco. Ese
 * boleto solo viaja de regreso en la siguiente acción (cerrar caja, cancelar, devolver, Limpias): la contraseña o el
 * código NUNCA se guardan ni se repiten. El boleto:
 *  - vive en memoria del proceso principal (la pantalla no puede fabricarlo),
 *  - es de UN usuario y UN propósito,
 *  - caduca (10 min) y se quema SOLO cuando la acción termina bien (si falla por otro motivo, se reintenta sin volver a teclear).
 */
import { newId } from '@amara/shared';
import type { ActionAuthorization, TokenPurpose } from '@amara/shared';

export interface AuthGrant {
  authorization: ActionAuthorization;
  /** true = el servidor la validó en línea hace instantes (el token puede no estar aún en la caché local). */
  trusted: boolean;
  purpose: TokenPurpose;
  userId: string;
  /** Nombre de quien autorizó (gerente o quien emitió el token), si se conoce. */
  byName: string | null;
  via: 'token' | 'admin_password';
  tokenLabel: string | null;
}

interface Stored extends AuthGrant {
  expiresAtMs: number;
}

export const GRANT_TTL_MS = 10 * 60_000;

export class AuthGrantStore {
  private grants = new Map<string, Stored>();

  constructor(private now: () => number = () => Date.now(), private ttlMs: number = GRANT_TTL_MS) {}

  issue(g: AuthGrant): string {
    this.sweep();
    const id = newId();
    this.grants.set(id, { ...g, expiresAtMs: this.now() + this.ttlMs });
    return id;
  }

  /** Devuelve la autorización si el boleto existe, no caducó y es de este usuario y propósito. NO lo consume. */
  peek(id: unknown, purpose: TokenPurpose, userId: string): AuthGrant | null {
    if (typeof id !== 'string') return null;
    const g = this.grants.get(id);
    if (!g) return null;
    if (g.expiresAtMs <= this.now()) {
      this.grants.delete(id);
      return null;
    }
    if (g.purpose !== purpose || g.userId !== userId) return null;
    return g;
  }

  /** Consume el boleto (la acción ya se guardó). */
  burn(id: unknown): void {
    if (typeof id === 'string') this.grants.delete(id);
  }

  /** Al cerrar sesión se olvidan los boletos de ese usuario. */
  clearUser(userId: string): void {
    for (const [id, g] of this.grants) if (g.userId === userId) this.grants.delete(id);
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, g] of this.grants) if (g.expiresAtMs <= t) this.grants.delete(id);
  }

  get size(): number {
    return this.grants.size;
  }
}

/**
 * Límite de fallos por llave (usuario): `max` fallos dentro de `windowMs` bloquean la llave el resto de la ventana.
 * Evita probar contraseñas o códigos de token a golpe de teclado.
 */
export class AttemptLimiter {
  private fails = new Map<string, number[]>();

  constructor(private max = 5, private windowMs = 60_000, private now: () => number = () => Date.now()) {}

  /** Segundos que faltan para poder intentar de nuevo (0 = puede intentar). */
  blockedFor(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[0]! + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.fails.set(key, list);
  }

  reset(key: string): void {
    this.fails.delete(key);
  }

  private recent(key: string): number[] {
    const t = this.now();
    const list = (this.fails.get(key) ?? []).filter((x) => x > t - this.windowMs);
    this.fails.set(key, list);
    return list;
  }
}
