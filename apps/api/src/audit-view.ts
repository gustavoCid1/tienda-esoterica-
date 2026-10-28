/**
 * Forma pública de GET /admin/audit. Lógica pura.
 *
 * El registro guarda `{ id, at, userId, action, entity, entityId, branchId, terminalId, detail }` con `detail` OBJETO libre.
 * La página Auditoría de la web esperaba `createdAt`, `userName` y un `detail` de texto, así que fallaba al pintar.
 * Ahora cada fila lleva AMBAS formas: los campos originales (`at`, `detail` objeto) y los que la web leía
 * (`createdAt`, `userName`) más `summary` (una línea de texto lista para mostrar). Nunca se exponen contraseñas, hashes ni sales.
 */
import { normalizeCategory } from '@amara/shared';

type Doc = Record<string, any>;

const SECRET_KEY = /pass(word)?|hash|salt|secret|verifier/i;

/** Copia del detalle sin llaves sensibles (defensa en profundidad; la auditoría ya no las guarda). */
export function scrubDetail(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined || typeof v !== 'object') return v ?? null;
  if (depth > 4) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrubDetail(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Doc)) if (!SECRET_KEY.test(k)) out[k] = scrubDetail(val, depth + 1);
  return out;
}

const short = (v: unknown): string => (v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function summarize(detail: unknown, max = 160): string {
  if (detail === null || detail === undefined) return '';
  const text = (typeof detail === 'object' && !Array.isArray(detail) ? Object.entries(detail as Doc).map(([k, v]) => `${k}: ${short(v)}`).join(' · ') : short(detail)).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function auditView(a: Doc, userNames: Map<string, string>) {
  const detail = scrubDetail(a.detail);
  const at = typeof a.at === 'string' ? a.at : '';
  const userId = (a.userId ?? null) as string | null;
  return {
    id: (a._id ?? a.id) as string,
    at,
    createdAt: at,
    userId,
    userName: userId ? (userNames.get(userId) ?? null) : null,
    action: String(a.action ?? ''),
    entity: String(a.entity ?? ''),
    entityId: (a.entityId ?? null) as string | null,
    branchId: (a.branchId ?? null) as string | null,
    terminalId: (a.terminalId ?? null) as string | null,
    detail,
    summary: summarize(detail),
  };
}

/** Nombres en español (o con acentos/mayúsculas) → valores reales de `entity` en la bitácora. */
const ENTITY_ALIASES: Record<string, string[]> = {
  usuario: ['user'], usuarios: ['user'], sucursal: ['branch'], sucursales: ['branch'], terminal: ['terminal'], terminales: ['terminal'],
  producto: ['product'], productos: ['product'], variante: ['variant'], variantes: ['variant'],
  venta: ['sale'], ventas: ['sale'], ticket: ['sale'], caja: ['cash_session', 'cash_movement'], corte: ['cash_session'],
  inventario: ['inventory', 'stock', 'inventory_movement'], transferencia: ['transfer'], permiso: ['grant'], 'permiso temporal': ['grant'],
  conflicto: ['sync_conflict'], conflictos: ['sync_conflict'], token: ['security_token'], tokens: ['security_token'], seguridad: ['security_token'],
  configuracion: ['setting'], ajustes: ['setting'],
};

/** Valores de `entity` a buscar; undefined = sin filtro. Siempre incluye el texto tal cual lo escribieron. */
export function normalizeEntityFilter(entity: string | undefined): string[] | undefined {
  const raw = (entity ?? '').trim();
  if (!raw) return undefined;
  const alias = ENTITY_ALIASES[normalizeCategory(raw)] ?? [];
  return [...new Set([raw, raw.toLowerCase(), ...alias])];
}
