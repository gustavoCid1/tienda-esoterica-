/**
 * Normalización de GET /admin/audit. Lógica pura (probada en audit.test.ts).
 *
 * CAUSA REAL de que la página Auditoría no cargara (leyendo apps/api/src/audit.ts y routes/admin.ts):
 *  - El servidor guarda y devuelve cada fila como
 *    `{ id, at, userId, action, entity, entityId, branchId, terminalId, detail }`, donde `detail`
 *    es un OBJETO libre (p. ej. `{ username, role }`) y la fecha se llama `at`.
 *  - El cliente esperaba `createdAt`, `userName` y un `detail` de TEXTO, y pintaba `{r.detail}`
 *    directamente en JSX. React no puede renderizar un objeto ("Objects are not valid as a React
 *    child"), el árbol se desmontaba y, sin un límite de errores, la pantalla quedaba en blanco.
 *  - Además `createdAt` inexistente producía fechas "NaN/NaN/NaN" y `entity` puede venir en null.
 * Aquí se aceptan ambas formas (la del servidor y la que esperaba el cliente) y se entrega siempre
 * texto seguro para mostrar.
 */
import type { AuditView } from './types-v2.ts';

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Lista de filas desde un arreglo, `{ items }` o `{ rows }`. */
export function auditRowsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isDict(raw)) {
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.rows)) return raw.rows;
  }
  return [];
}

/** Valor primitivo legible; objetos y listas se compactan a JSON. */
function shortValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '[dato no mostrable]';
  }
}

/** Resumen de una línea de cualquier `detail` (texto, número u objeto). Nunca devuelve un objeto. */
export function summarizeDetail(detail: unknown, max = 160): string {
  let text = '';
  if (detail === null || detail === undefined) text = '';
  else if (isDict(detail)) {
    text = Object.entries(detail)
      .map(([k, v]) => `${k}: ${shortValue(v)}`)
      .join(' · ');
  } else text = shortValue(detail);
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

/** ISO válido o ''. Acepta `at`, `createdAt` o `timestamp`. */
export function auditDate(row: Dict): string {
  for (const key of ['at', 'createdAt', 'timestamp'] as const) {
    const v = row[key];
    if (typeof v === 'string' && v !== '' && !Number.isNaN(new Date(v).getTime())) return v;
  }
  return '';
}

/**
 * Convierte la respuesta cruda en filas seguras para pintar.
 * `userNames` asocia id de usuario -> nombre (si la persona pudo cargar la lista de usuarios).
 */
export function normalizeAuditRows(raw: unknown, userNames: Record<string, string> = {}): AuditView[] {
  const out: AuditView[] = [];
  auditRowsOf(raw).forEach((item, i) => {
    if (!isDict(item)) return;
    const detail = item.detail;
    const userId = str(item.userId);
    const terminalId = str(item.terminalId);
    const userLabel =
      str(item.userName) ||
      (userId && userNames[userId]) ||
      (userId ? userId.slice(0, 8) : terminalId ? `Terminal ${terminalId.slice(0, 6)}` : 'Sistema');

    let before: unknown = item.before ?? (isDict(detail) ? detail.before : undefined);
    let after: unknown = item.after ?? (isDict(detail) ? detail.after : undefined);
    if (before === undefined && after === undefined && isDict(detail) && isDict(detail.changes)) {
      after = detail.changes;
    }
    before = before ?? null;
    after = after ?? null;
    const hasDetailObject = isDict(detail) && Object.keys(detail).length > 0;

    out.push({
      id: str(item.id) || `fila-${i}`,
      at: auditDate(item),
      userLabel,
      entity: str(item.entity) || '-',
      action: str(item.action) || '-',
      summary: summarizeDetail(detail),
      before,
      after,
      raw: detail ?? null,
      hasDiff: before !== null || after !== null || hasDetailObject,
    });
  });
  return out;
}

/** Filtro de texto libre sobre acción, entidad, usuario y resumen (sin distinguir mayúsculas). */
export function filterAuditRows(rows: AuditView[], text: string): AuditView[] {
  const t = text.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) => [r.action, r.entity, r.userLabel, r.summary].join(' ').toLowerCase().includes(t));
}
