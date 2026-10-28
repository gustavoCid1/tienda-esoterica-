/**
 * Documentos imprimibles del gerente: "ticket de cierre" de caja y "ticket de permiso" (token de seguridad).
 * Lógica PURA: primero se arma un modelo de renglones (se prueba en test/documents.test.ts) y de ahí sale el HTML que
 * se muestra en la vista previa, se imprime (expo-print) o se guarda como PDF.
 *
 * El ticket de permiso usa VIOLETA (distinto al ticket de venta, que es negro). En impresoras térmicas monocromas
 * saldrá negro: el rótulo "TICKET DE PERMISO" y el marco lo distinguen igual. El CÓDIGO del token solo existe en
 * pantalla justo después de crearlo (el servidor no lo vuelve a dar), así que este ticket solo puede generarse entonces.
 */
import { formatMXN, formatMxDateTime } from '@amara/shared';
import type { ActionAuthorization, CashBreakdown, TokenPurpose } from '@amara/shared';
import { escapeHtml } from './ticket-render.ts';

export type DocLine =
  | { kind: 'band' | 'title' | 'text' | 'bold' | 'small' | 'code'; text: string }
  | { kind: 'pair'; text: string; value: string; strong?: boolean }
  | { kind: 'rule' | 'gap' };

// ───────────── Textos ─────────────

export const PURPOSE_NAME: Record<TokenPurpose, string> = {
  cierre_caja: 'Cierre de caja',
  devolucion: 'Devolución',
  cancelacion: 'Cancelación',
  limpias: 'Limpias',
};

/** Minutos -> "45 min", "1 h 30 min", "2 h", "1 día", "2 días 3 h". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) {
    const day = `${d} ${d === 1 ? 'día' : 'días'}`;
    return h > 0 ? `${day} ${h} h` : m > 0 ? `${day} ${m} min` : day;
  }
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.ceil((b - a) / 60000);
}

// ───────────── Ticket de cierre ─────────────

export interface ClosureTicketData {
  business: string;
  branchName: string;
  terminalCode: string;
  openedAtIso: string;
  openedByName: string;
  openingCents: number;
  closedAtIso: string;
  closedByName: string;
  breakdown: Pick<CashBreakdown, 'cashSalesCents' | 'cashInCents' | 'withdrawalsCents' | 'expensesCents' | 'cashRefundsCents' | 'byMethod' | 'operations'>;
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
  /** Quién autorizó el cierre. */
  authorizedByName: string | null;
  authorization: ActionAuthorization | null;
  /** true = el cierre se hizo con operaciones aún sin enviar al servidor. */
  provisional: boolean;
}

export function differenceText(diffCents: number): string {
  if (diffCents === 0) return 'Cuadra';
  return diffCents < 0 ? `Faltante ${formatMXN(-diffCents)}` : `Sobrante ${formatMXN(diffCents)}`;
}

export function authorizationText(auth: ActionAuthorization | null, name: string | null): string {
  if (!auth) return name ?? '-';
  if (auth.kind === 'token') return name ? `Token de seguridad (creado por ${name})` : 'Token de seguridad';
  return name ? `Contraseña de administrador (${name})` : 'Contraseña de administrador';
}

export function buildClosureModel(d: ClosureTicketData): DocLine[] {
  const L: DocLine[] = [];
  L.push({ kind: 'title', text: d.business });
  L.push({ kind: 'text', text: d.branchName });
  L.push({ kind: 'band', text: 'CIERRE DE CAJA' });
  L.push({ kind: 'text', text: `Terminal: ${d.terminalCode}` });
  L.push({ kind: 'rule' });
  L.push({ kind: 'pair', text: 'Apertura', value: formatMxDateTime(d.openedAtIso) });
  L.push({ kind: 'text', text: `Abrió: ${d.openedByName}` });
  L.push({ kind: 'pair', text: 'Cierre', value: formatMxDateTime(d.closedAtIso) });
  L.push({ kind: 'text', text: `Cerró: ${d.closedByName}` });
  L.push({ kind: 'rule' });
  L.push({ kind: 'pair', text: 'Fondo inicial', value: formatMXN(d.openingCents) });
  L.push({ kind: 'pair', text: '+ Cobros en efectivo', value: formatMXN(d.breakdown.cashSalesCents) });
  if (d.breakdown.cashInCents > 0) L.push({ kind: 'pair', text: '+ Entradas de efectivo', value: formatMXN(d.breakdown.cashInCents) });
  if (d.breakdown.withdrawalsCents > 0) L.push({ kind: 'pair', text: '- Retiros', value: formatMXN(d.breakdown.withdrawalsCents) });
  if (d.breakdown.expensesCents > 0) L.push({ kind: 'pair', text: '- Gastos', value: formatMXN(d.breakdown.expensesCents) });
  if (d.breakdown.cashRefundsCents > 0) L.push({ kind: 'pair', text: '- Devoluciones en efectivo', value: formatMXN(d.breakdown.cashRefundsCents) });
  L.push({ kind: 'pair', text: 'Efectivo esperado', value: formatMXN(d.expectedCents), strong: true });
  L.push({ kind: 'pair', text: 'Efectivo contado', value: formatMXN(d.countedCents), strong: true });
  L.push({ kind: 'pair', text: 'Diferencia', value: differenceText(d.differenceCents), strong: true });
  L.push({ kind: 'rule' });
  L.push({ kind: 'bold', text: 'Ventas por método (netas)' });
  const names: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' };
  for (const [m, label] of Object.entries(names)) {
    const v = (d.breakdown.byMethod as Record<string, number>)[m] ?? 0;
    if (v !== 0) L.push({ kind: 'pair', text: label, value: formatMXN(v) });
  }
  L.push({ kind: 'text', text: `Operaciones: ${d.breakdown.operations}` });
  L.push({ kind: 'rule' });
  L.push({ kind: 'bold', text: 'Autorizó el cierre' });
  L.push({ kind: 'text', text: authorizationText(d.authorization, d.authorizedByName) });
  if (d.provisional) {
    L.push({ kind: 'gap' });
    L.push({ kind: 'small', text: 'CIERRE PROVISIONAL: había operaciones sin enviar al servidor. Se concilia al sincronizar.' });
  }
  return L;
}

// ───────────── Ticket de permiso ─────────────

export interface PermitTicketData {
  code: string;
  label: string;
  purposes: TokenPurpose[];
  issuedAtIso: string;
  expiresAtIso: string;
  /** null/'' = cualquier sucursal. */
  branchName: string | null;
  /** null/'' = cualquier usuario. */
  forUserName: string | null;
  maxUses: number | null;
  /** Quién autoriza (el gerente que creó el token). */
  authorizedBy: string;
  business?: string;
}

/** El código se muestra en bloques de 4 ("ABCD EFGH") para dictarlo; el servidor ignora espacios y guiones. */
export function groupCode(code: string): string {
  const c = code.replace(/[\s-]/g, '');
  return c.replace(/(.{4})(?=.)/g, '$1 ');
}

export function buildPermitModel(d: PermitTicketData): DocLine[] {
  const L: DocLine[] = [];
  L.push({ kind: 'band', text: 'TICKET DE PERMISO' });
  L.push({ kind: 'title', text: d.business ?? 'Esotérica Amara' });
  L.push({ kind: 'small', text: 'Comprobante de autorización. No es un ticket de venta.' });
  L.push({ kind: 'rule' });
  if (d.label) L.push({ kind: 'bold', text: d.label });
  L.push({ kind: 'small', text: 'CÓDIGO DE AUTORIZACIÓN' });
  L.push({ kind: 'code', text: groupCode(d.code) });
  L.push({ kind: 'gap' });
  L.push({ kind: 'bold', text: 'Sirve para:' });
  if (d.purposes.length === 0) L.push({ kind: 'text', text: '- (sin propósito)' });
  for (const p of d.purposes) L.push({ kind: 'text', text: `- ${PURPOSE_NAME[p] ?? p}` });
  L.push({ kind: 'gap' });
  L.push({ kind: 'bold', text: 'Vigencia' });
  L.push({ kind: 'text', text: `Emitido: ${formatMxDateTime(d.issuedAtIso)}` });
  L.push({ kind: 'text', text: `Vence: ${formatMxDateTime(d.expiresAtIso)}` });
  const minutes = minutesBetween(d.issuedAtIso, d.expiresAtIso);
  if (minutes > 0) L.push({ kind: 'text', text: `Duración: ${formatDuration(minutes)}` });
  L.push({ kind: 'gap' });
  L.push({ kind: 'text', text: `Sucursal: ${d.branchName || 'Cualquier sucursal'}` });
  L.push({ kind: 'text', text: `Para: ${d.forUserName || 'Cualquier usuario'}` });
  L.push({ kind: 'text', text: `Usos: ${d.maxUses === null ? 'Sin límite dentro de su vigencia' : d.maxUses}` });
  L.push({ kind: 'rule' });
  L.push({ kind: 'bold', text: 'Autoriza:' });
  L.push({ kind: 'text', text: d.authorizedBy || '-' });
  L.push({ kind: 'gap' });
  L.push({ kind: 'small', text: 'Entrega este ticket solo a quien debe usar el permiso. El código deja de servir al vencer o al ser revocado.' });
  return L;
}

// ───────────── HTML ─────────────

export type DocTheme = 'cierre' | 'permiso';

/** Colores del documento. El permiso es violeta; el cierre, negro. */
export const DOC_COLORS: Record<DocTheme, { main: string; tint: string }> = {
  cierre: { main: '#111111', tint: '#F2F2F2' },
  permiso: { main: '#5B3A8C', tint: '#F1ECF8' },
};

export function docHtml(lines: DocLine[], theme: DocTheme, opts: { title?: string } = {}): string {
  const c = DOC_COLORS[theme];
  const body = lines
    .map((l) => {
      switch (l.kind) {
        case 'band':
          return `<div class="band">${escapeHtml(l.text)}</div>`;
        case 'title':
          return `<div class="title">${escapeHtml(l.text)}</div>`;
        case 'text':
          return `<div class="text">${escapeHtml(l.text)}</div>`;
        case 'bold':
          return `<div class="bold">${escapeHtml(l.text)}</div>`;
        case 'small':
          return `<div class="small">${escapeHtml(l.text)}</div>`;
        case 'code':
          return `<div class="code">${escapeHtml(l.text)}</div>`;
        case 'pair':
          return `<div class="pair${l.strong ? ' strong' : ''}"><span>${escapeHtml(l.text)}</span><span>${escapeHtml(l.value)}</span></div>`;
        case 'rule':
          return '<hr>';
        case 'gap':
          return '<div class="gap"></div>';
      }
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title ?? (theme === 'permiso' ? 'Ticket de permiso' : 'Cierre de caja'))}</title>
<style>
@page { size: 80mm auto; margin: 4mm; }
body { font-family: monospace; font-size: 12px; color: #111; margin: 0; padding: 6px; }
.doc { border: ${theme === 'permiso' ? `2px solid ${c.main}` : '0'}; padding: 8px; }
.band { background: ${c.main}; color: #fff; text-align: center; font-weight: bold; font-size: 15px; padding: 6px 4px; margin: 4px 0; }
.title { text-align: center; font-weight: bold; font-size: 15px; color: ${c.main}; margin: 4px 0; }
.text { margin: 2px 0; }
.bold { font-weight: bold; color: ${c.main}; margin: 2px 0; }
.small { font-size: 10px; color: #555; text-align: center; margin: 2px 0; }
.code { font-size: 26px; font-weight: bold; letter-spacing: 2px; text-align: center; color: ${c.main}; background: ${c.tint}; border: 1.5px solid ${c.main}; padding: 8px 2px; margin: 6px 0; }
.pair { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
.pair span:last-child { text-align: right; }
.strong { font-weight: bold; }
.gap { height: 8px; }
hr { border: 0; border-top: 1px dashed ${c.main}; margin: 6px 0; }
</style></head><body><div class="doc">${body}</div></body></html>`;
}

export const closureHtml = (d: ClosureTicketData): string => docHtml(buildClosureModel(d), 'cierre');
export const permitHtml = (d: PermitTicketData): string => docHtml(buildPermitModel(d), 'permiso');
