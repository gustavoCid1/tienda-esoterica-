/**
 * Tokens de seguridad y autorizaciones de acciones sensibles (v2). Lógica PURA: todo acceso a datos
 * entra por interfaces pequeñas, así se prueba sin MongoDB.
 *
 *  - El código del token solo existe en la respuesta de POST /security/tokens; en la base van `salt` + `hash`.
 *  - `checkAuthorization` es lo que usan sync-apply (operaciones ya ocurridas sin conexión) y las rutas en línea.
 *  - Una autorización inválida de una operación YA OCURRIDA nunca la borra: se aplica y queda un conflicto
 *    `autorizacion_invalida` para el gerente.
 */
import { generateTokenCode, generateTokenSalt, hashTokenCode, safeEqual, tokenExpiresAt, tokenStatus, whyTokenInactive } from '@amara/shared';
import type { ActionAuthorization, CachedSecurityToken, Role, SecurityToken, TokenPurpose } from '@amara/shared';
import { actionAuthorizationSchema } from '@amara/shared/schemas';

// ───────────────────────────── Creación ─────────────────────────────

export interface NewTokenInput {
  label: string;
  purposes: TokenPurpose[];
  durationMinutes: number;
  branchId?: string | null;
  forUserId?: string | null;
  maxUses?: number | null;
  length?: number;
}

/** Arma el documento a guardar y el código en claro (que se muestra UNA sola vez). */
export function buildToken(input: NewTokenInput, ctx: { id: string; createdBy: string; nowIso: string }): { doc: CachedSecurityToken; code: string } {
  const code = generateTokenCode(input.length ?? 8);
  const salt = generateTokenSalt();
  const doc: CachedSecurityToken = {
    id: ctx.id,
    label: input.label.trim(),
    purposes: [...new Set(input.purposes)],
    branchId: input.branchId ?? null,
    forUserId: input.forUserId ?? null,
    createdBy: ctx.createdBy,
    createdAt: ctx.nowIso,
    expiresAt: tokenExpiresAt(ctx.nowIso, input.durationMinutes),
    revokedAt: null,
    maxUses: input.maxUses ?? null,
    usedCount: 0,
    salt,
    hash: hashTokenCode(code, salt),
  };
  return { doc, code };
}

/** Forma pública (sin sal ni hash) con el estado calculado a la hora indicada. */
export function tokenView(t: CachedSecurityToken & Record<string, any>, nowIso: string) {
  const { _id, salt: _s, hash: _h, revokedBy, ...rest } = t;
  const pub = rest as SecurityToken & Record<string, any>;
  return { ...pub, id: t.id ?? _id, status: tokenStatus(t, nowIso), revokedBy: revokedBy ?? null };
}

// ───────────────────────────── Verificación de un código ─────────────────────────────

export type VerifyDeny = 'no_coincide' | 'proposito' | 'sucursal' | 'usuario' | 'vencido' | 'revocado' | 'agotado' | 'pendiente';

/** Busca entre `candidates` el token cuyo hash coincide con el código y valida su vigencia para la acción. */
export function matchTokenCode(
  code: string,
  candidates: CachedSecurityToken[],
  p: { purpose: TokenPurpose; branchId: string; userId: string; atIso: string },
): { ok: true; token: CachedSecurityToken } | { ok: false; reason: VerifyDeny } {
  let first: VerifyDeny | null = null;
  for (const t of candidates) {
    if (!safeEqual(hashTokenCode(code, t.salt), t.hash)) continue;
    const why = whyTokenInactive(t, p.purpose, p.branchId, p.atIso, p.userId);
    if (why === null) return { ok: true, token: t };
    first ??= why;
  }
  return { ok: false, reason: first ?? 'no_coincide' };
}

// ───────────────────────────── Límite de fallos ─────────────────────────────

/**
 * Límite por ventana deslizante: máximo `max` fallos por `windowMs` para una llave (usuario o terminal).
 * Vive en memoria del proceso (suficiente para una sola instancia del servidor). Solo cuentan los FALLOS:
 * un código correcto no consume cupo, pero tampoco "perdona" los fallos anteriores.
 */
export class FailureLimiter {
  private fails = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  private now: () => number;
  constructor(max = 5, windowMs = 60_000, now: () => number = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  private prune(key: string): number[] {
    const t = this.now();
    const list = (this.fails.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  /** Segundos que faltan para poder intentar de nuevo, o 0 si puede intentar. */
  blockedFor(key: string): number {
    const list = this.prune(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[0]! + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    const list = this.prune(key);
    list.push(this.now());
    this.fails.set(key, list);
    // Memoria acotada: si hay demasiadas llaves, se limpian las vencidas.
    if (this.fails.size > 5000) for (const k of [...this.fails.keys()]) this.prune(k);
  }

  reset(key: string): void {
    this.fails.delete(key);
  }
}

// ───────────────────────────── Autorización de una operación ─────────────────────────────

export interface AdminRec {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  branchIds: string[];
}

export interface AuthzDeps {
  getUser(id: string): Promise<AdminRec | null>;
  getSecurityToken(id: string): Promise<CachedSecurityToken | null>;
  /** ¿Esta misma operación ya había registrado el uso del token? (reproceso) */
  hasTokenUse(tokenId: string, opId: string): Promise<boolean>;
}

export type AuthzResult =
  | { ok: true; authorization: ActionAuthorization; authorizedBy: string; authorizedByName: string | null; tokenId: string | null }
  | { ok: false; reason: string; detail: string };

const REASON_TEXT: Record<string, string> = {
  proposito: 'el token no es para esta acción',
  sucursal: 'el token es de otra sucursal',
  usuario: 'el token es para otro usuario',
  vencido: 'el token ya estaba vencido a la hora de la operación',
  revocado: 'el token ya estaba revocado a la hora de la operación',
  agotado: 'el token ya había alcanzado su máximo de usos',
  pendiente: 'el token aún no estaba vigente a la hora de la operación',
};

/**
 * ¿Era válida la autorización que declaró el dispositivo? `raw` es lo que llegó (sin confiar en su forma).
 * `atIso` es la hora de la operación ya acotada a "no en el futuro" por quien llama.
 * NO consume el token: eso se hace una vez aplicada la operación (`SyncRepo.consumeToken`).
 */
export async function checkAuthorization(
  deps: AuthzDeps,
  raw: unknown,
  p: { purpose: TokenPurpose; branchId: string; userId: string; opId: string; atIso: string },
): Promise<AuthzResult> {
  if (raw === undefined || raw === null) return { ok: false, reason: 'autorizacion_invalida', detail: 'La operación no trae autorización' };
  const parsed = actionAuthorizationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'autorizacion_invalida', detail: 'La autorización no tiene un formato válido' };
  const auth = parsed.data as ActionAuthorization;

  if (auth.kind === 'admin_password') {
    const u = await deps.getUser(auth.adminUserId);
    if (!u) return { ok: false, reason: 'autorizacion_invalida', detail: 'El administrador que autorizó no existe' };
    if (u.role !== 'gerente') return { ok: false, reason: 'autorizacion_invalida', detail: `${u.name} no es gerente: su contraseña no autoriza esta acción` };
    if (!u.active) return { ok: false, reason: 'autorizacion_invalida', detail: `${u.name} está inactivo` };
    if (!u.branchIds.includes(p.branchId)) return { ok: false, reason: 'autorizacion_invalida', detail: `${u.name} no administra la sucursal de la operación` };
    return { ok: true, authorization: auth, authorizedBy: u.id, authorizedByName: u.name, tokenId: null };
  }

  const token = await deps.getSecurityToken(auth.tokenId);
  if (!token) return { ok: false, reason: 'autorizacion_invalida', detail: 'El token de la autorización no existe en el servidor' };
  // Si esta misma operación ya contó su uso (reproceso), no se vuelve a exigir un cupo libre.
  const already = token.maxUses !== null && (await deps.hasTokenUse(token.id, p.opId));
  const snapshot = already ? { ...token, usedCount: Math.max(0, token.usedCount - 1) } : token;
  const why = whyTokenInactive(snapshot, p.purpose, p.branchId, p.atIso, p.userId);
  if (why !== null) return { ok: false, reason: 'autorizacion_invalida', detail: REASON_TEXT[why] ?? 'el token no es válido' };
  const creator = await deps.getUser(token.createdBy);
  return { ok: true, authorization: auth, authorizedBy: token.createdBy, authorizedByName: creator?.name ?? null, tokenId: token.id };
}
