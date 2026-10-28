/**
 * Alta de terminales v2: código sugerido, nombre automático y lectura tolerante de las respuestas
 * de POST /admin/terminals y POST /admin/terminals/:id/token. Lógica pura (terminals.test.ts).
 */
import type { TerminalCredentials, TerminalRecord } from './types-v2.ts';

export type TerminalKind = 'escritorio' | 'movil';

export const KIND_LABEL: Record<TerminalKind, string> = { escritorio: 'PC (escritorio)', movil: 'Móvil' };

/** El código lo exige la API: 1 a 3 caracteres A-Z/0-9, único en todo el sistema. */
export const TERMINAL_CODE_RE = /^[A-Z0-9]{1,3}$/;

const PREFIX: Record<TerminalKind, string> = { escritorio: 'P', movil: 'M' };

/**
 * Código sugerido: "P" + número para PC y "M" + número para móvil (P1, P2... M1, M2...), el primero
 * que no esté usado. Devuelve '' si se agotaron los 99 números.
 */
export function suggestTerminalCode(kind: TerminalKind, existingCodes: string[]): string {
  const used = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  for (let n = 1; n <= 99; n++) {
    const code = `${PREFIX[kind]}${n}`;
    if (!used.has(code)) return code;
  }
  return '';
}

/** Nombre de la terminal a partir de quién la usa: "PC de Ana" / "Móvil de Ana" (máx. 60). */
export function buildTerminalName(kind: TerminalKind, person: string): string {
  const p = person.replace(/\s+/g, ' ').trim();
  const base = kind === 'movil' ? 'Móvil' : 'PC';
  return `${base} de ${p}`.slice(0, 60).trim();
}

export interface NewTerminalForm {
  kind: TerminalKind;
  person: string;
  branchId: string;
  code: string;
}

export interface NewTerminalPayload {
  code: string;
  name: string;
  branchId: string;
  kind: TerminalKind;
  assignedTo: string;
}

/** Valida el formulario "¿Para quién es esta terminal?" y arma el cuerpo para la API. */
export function buildNewTerminalPayload(
  form: NewTerminalForm,
  existingCodes: string[] = [],
): { payload: NewTerminalPayload | null; errors: Partial<Record<keyof NewTerminalForm, string>> } {
  const errors: Partial<Record<keyof NewTerminalForm, string>> = {};
  const person = form.person.replace(/\s+/g, ' ').trim();
  const code = form.code.trim().toUpperCase();
  if (person.length < 2) errors.person = 'Escribe el nombre de la persona (mínimo 2 letras).';
  else if (person.length > 40) errors.person = 'El nombre es demasiado largo (máximo 40).';
  if (!form.branchId) errors.branchId = 'Elige una sucursal.';
  if (!TERMINAL_CODE_RE.test(code)) errors.code = 'El código debe tener de 1 a 3 letras mayúsculas o números.';
  else if (existingCodes.some((c) => c.trim().toUpperCase() === code)) errors.code = 'Ese código ya lo usa otra terminal.';
  if (Object.keys(errors).length > 0) return { payload: null, errors };
  return {
    payload: { code, name: buildTerminalName(form.kind, person), branchId: form.branchId, kind: form.kind, assignedTo: person },
    errors,
  };
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Acepta el terminal directo (contrato v2) o envuelto en `{ terminal }` (forma de la API v1). */
export function unwrapTerminal(raw: unknown): TerminalRecord | null {
  const o = isDict(raw) && isDict(raw.terminal) ? raw.terminal : raw;
  if (!isDict(o) || !s(o.id)) return null;
  return {
    id: s(o.id),
    code: s(o.code),
    name: s(o.name),
    kind: o.kind === 'movil' ? 'movil' : 'escritorio',
    branchId: s(o.branchId),
    assignedTo: typeof o.assignedTo === 'string' ? o.assignedTo : null,
  };
}

/**
 * Datos para el segundo modal. Los campos que la respuesta del token omita se completan con lo
 * que ya se conoce de la terminal (así el modal nunca queda con huecos).
 */
export function buildCredentials(terminal: TerminalRecord, tokenRaw: unknown, fallbackAssignedTo = ''): TerminalCredentials {
  const t = isDict(tokenRaw) ? tokenRaw : {};
  return {
    id: s(t.terminalId) || terminal.id,
    code: s(t.code) || terminal.code,
    name: s(t.name) || terminal.name,
    kind: t.kind === 'movil' ? 'movil' : t.kind === 'escritorio' ? 'escritorio' : terminal.kind,
    branchId: s(t.branchId) || terminal.branchId,
    assignedTo: (typeof t.assignedTo === 'string' && t.assignedTo) || terminal.assignedTo || fallbackAssignedTo,
    token: s(t.token) || null,
  };
}

/** Texto para "Copiar todo". El token va al final y solo si existe. */
export function credentialsText(c: TerminalCredentials, branchName: string): string {
  const lines = [
    `ID: ${c.id}`,
    `Código: ${c.code}`,
    `Nombre: ${c.name}`,
    `Tipo: ${c.kind === 'movil' ? 'Móvil' : 'PC (escritorio)'}`,
    `Sucursal: ${branchName || c.branchId}`,
  ];
  if (c.assignedTo) lines.push(`Para: ${c.assignedTo}`);
  if (c.token) lines.push(`Token de activación: ${c.token}`);
  return lines.join('\n');
}

/** ¿El token de la terminal está anulado? La API v1 manda `revoked` (booleano); otras versiones `revokedAt`. */
export function isTerminalRevoked(t: { revoked?: boolean; revokedAt?: string | null }): boolean {
  if (typeof t.revoked === 'boolean') return t.revoked;
  return !!t.revokedAt;
}
