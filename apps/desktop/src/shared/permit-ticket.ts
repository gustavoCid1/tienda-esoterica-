/**
 * "TICKET DE PERMISO" (v2): comprobante imprimible de un token de seguridad (código, propósitos, vigencia,
 * sucursal y quién autoriza). Lógica PURA y probada.
 *
 * Se dibuja en VIOLETA (marco, banda y código) para que nunca se confunda con el ticket de venta. En una impresora
 * térmica monocroma saldrá en negro: por eso además lleva el rótulo "TICKET DE PERMISO" en una banda invertida y un
 * marco grueso, que lo distinguen aun sin color.
 * El código solo se conoce al crear el token (el servidor no lo guarda): este ticket solo se puede generar entonces.
 */
import { formatMxDateTime } from '@amara/shared';
import type { TokenPurpose } from '@amara/shared';
import { BASE_CSS, escapeHtml, header } from './ticket-format.ts';
import { PURPOSE_LABEL, formatDuration } from './token-form.ts';

/** Violeta del ticket de permiso (mismo que la web). */
export const PERMIT_COLOR = '#5B3A8C';
export const PERMIT_TINT = '#F1ECF8';

export interface PermitTicketData {
  business: string;
  code: string;
  label: string;
  purposes: TokenPurpose[];
  createdAt: string;
  expiresAt: string;
  /** null = cualquier sucursal. */
  branchName: string | null;
  /** null = cualquier usuario. */
  forUserName: string | null;
  maxUses: number | null;
  authorizedBy: string;
}

/** Minutos de vigencia entre dos fechas ISO (0 si son inválidas). */
export function minutesBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 60_000);
}

/** El código se muestra en grupos de 4 ("ABCD EFGH") para dictarlo y teclearlo sin errores. */
export function groupCode(code: string): string {
  return code.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

const PERMIT_CSS = (paperMm: 58 | 80) => `
.permit { border: 2.5px solid ${PERMIT_COLOR}; padding: 2mm; color: ${PERMIT_COLOR}; }
.permit .band { background: ${PERMIT_COLOR}; color: #fff; text-align: center; font-weight: bold; letter-spacing: 1.5px; padding: 1.5mm 0; margin: 1mm 0 2mm; font-size: ${paperMm === 58 ? 12 : 14}px; }
.permit .code { border: 2px dashed ${PERMIT_COLOR}; background: ${PERMIT_TINT}; text-align: center; font-family: Consolas, 'Courier New', monospace; font-weight: bold; font-size: ${paperMm === 58 ? 20 : 26}px; letter-spacing: 3px; padding: 2.5mm 0; margin: 2mm 0; word-break: break-all; }
.permit .sep { border-top: 1px dashed ${PERMIT_COLOR}; }
.permit .row b { text-align: right; }
.permit .note { font-size: ${paperMm === 58 ? 9 : 10}px; text-align: center; margin-top: 2mm; }
`;

export function permitBodyHtml(d: PermitTicketData, o: { paperMm: 58 | 80; logoSrc?: string }): string {
  const row = (k: string, v: string) => `<div class="row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;
  const minutes = minutesBetween(d.createdAt, d.expiresAt);
  return `<div class="permit">${[
    header({ business: d.business }, o),
    '<div class="band">TICKET DE PERMISO</div>',
    `<div class="c"><b>${escapeHtml(d.label)}</b></div>`,
    `<div class="code">${escapeHtml(groupCode(d.code))}</div>`,
    '<div class="sep"></div>',
    `<div><b>Sirve para:</b></div><div>${d.purposes.map((p) => escapeHtml(PURPOSE_LABEL[p] ?? p)).join(', ')}</div>`,
    '<div class="sep"></div>',
    row('Emitido', formatMxDateTime(d.createdAt)),
    row('Válido hasta', formatMxDateTime(d.expiresAt)),
    row('Duración', formatDuration(minutes)),
    row('Sucursal', d.branchName || 'Cualquiera'),
    row('Para', d.forUserName || 'Cualquier usuario'),
    row('Usos máximos', d.maxUses === null ? 'Sin límite' : String(d.maxUses)),
    '<div class="sep"></div>',
    row('Autorizó', d.authorizedBy),
    '<div class="note">Este permiso NO es un comprobante de compra. Entrégalo solo a la persona autorizada; cualquiera que tenga el código puede usarlo hasta que venza.</div>',
  ].join('')}</div>`;
}

export function buildPermitTicketHtml(d: PermitTicketData, o: { paperMm: 58 | 80; logoSrc?: string }): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket de permiso</title><style>${BASE_CSS(o.paperMm)}${PERMIT_CSS(o.paperMm)}</style></head><body><div class="t">${permitBodyHtml(d, o)}</div></body></html>`;
}
