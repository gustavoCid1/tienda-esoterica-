/** Reglas puras de pantallas operativas: permisos temporales, devoluciones y cortes de caja. */
import type { SaleItem } from '@amara/shared';
import type { CashSessionRow, GrantRow } from './types.ts';

export type GrantState = 'programado' | 'vigente' | 'vencido' | 'revocado';

/** Estado legible de un permiso temporal en el instante `nowIso` (mismas reglas que isGrantActive). */
export function grantState(g: Pick<GrantRow, 'startsAt' | 'expiresAt' | 'revokedAt'>, nowIso: string): GrantState {
  if (g.revokedAt && g.revokedAt <= nowIso) return 'revocado';
  if (nowIso >= g.expiresAt) return 'vencido';
  if (nowIso < g.startsAt) return 'programado';
  return 'vigente';
}

/** Minutos que faltan para que venza (0 si ya venció). */
export function minutesLeft(expiresAt: string, nowIso: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - new Date(nowIso).getTime()) / 60000));
}

export interface ReturnSelection {
  saleItemId: string;
  qty: number;
  restock: boolean;
}

/**
 * Importe a devolver: neto de cada línea prorrateado por la cantidad devuelta.
 * Si se devuelve toda la línea se usa su neto exacto (evita centavos perdidos por redondeo).
 */
export function computeReturnAmount(items: Pick<SaleItem, 'id' | 'qty' | 'netCents'>[], selections: ReturnSelection[]): number {
  let total = 0;
  for (const sel of selections) {
    if (sel.qty <= 0) continue;
    const it = items.find((i) => i.id === sel.saleItemId);
    if (!it || it.qty <= 0) continue;
    total += sel.qty >= it.qty ? it.netCents : Math.round((it.netCents * sel.qty) / it.qty);
  }
  return total;
}

/** Valida selección de devolución; devuelve mensajes de error (vacío = correcto). */
export function validateReturn(
  items: Pick<SaleItem, 'id' | 'qty' | 'productName'>[],
  selections: ReturnSelection[],
  reason: string,
  payments: { amountCents: number }[],
  expectedCents: number,
): string[] {
  const errs: string[] = [];
  const chosen = selections.filter((s) => s.qty > 0);
  if (chosen.length === 0) errs.push('Elige al menos un artículo a devolver');
  for (const s of chosen) {
    const it = items.find((i) => i.id === s.saleItemId);
    if (!it) errs.push('Artículo no encontrado en la venta');
    else if (!Number.isInteger(s.qty) || s.qty > it.qty) errs.push(`Cantidad inválida para ${it.productName} (máximo ${it.qty})`);
  }
  if (reason.trim().length < 3) errs.push('Escribe el motivo (mínimo 3 caracteres)');
  const paid = payments.reduce((a, p) => a + p.amountCents, 0);
  if (chosen.length > 0 && paid !== expectedCents) errs.push('El dinero devuelto debe sumar exactamente el importe de la devolución');
  return errs;
}

export interface CashKind {
  label: string;
  tone: 'ok' | 'warn' | 'info';
  hint: string;
}

/**
 * Distingue un CORTE REAL (sesión cerrada con conteo físico) de una sesión abierta,
 * y marca los provisionales o con operaciones pendientes de conciliar.
 */
export function cashSessionKind(s: Pick<CashSessionRow, 'status' | 'provisional' | 'pendingReconcile'>): CashKind {
  if (s.status === 'abierta') {
    return { label: 'Sesión abierta', tone: 'info', hint: 'Aún no hay corte: el efectivo esperado se calcula en vivo.' };
  }
  if ((s.pendingReconcile ?? 0) > 0) {
    return {
      label: 'Pendiente de conciliación',
      tone: 'warn',
      hint: `${s.pendingReconcile} operación(es) por conciliar: las cifras pueden cambiar.`,
    };
  }
  if (s.provisional) {
    return { label: 'Corte provisional', tone: 'warn', hint: 'Cerrado con operaciones pendientes de sincronizar o conciliar.' };
  }
  return { label: 'Corte real', tone: 'ok', hint: 'Cerrado con conteo físico del efectivo.' };
}
