/** Arma los datos del ticket de cierre desde un corte YA hecho en LocalStore (getClosure). */
import type { LocalStore } from '@amara/database';
import type { ClosureTicketData } from './documents.ts';

export async function loadClosureTicketData(
  store: LocalStore,
  sessionId: string,
  ctx: { business?: string; branchName: string; terminalCode: string },
): Promise<ClosureTicketData | null> {
  const c = await store.getClosure(sessionId);
  if (!c || c.status !== 'cerrada' || !c.closedAt || c.countedCents === null || c.expectedCents === null || c.differenceCents === null) return null;
  const breakdown = c.closure?.breakdown as ClosureTicketData['breakdown'] | undefined;
  if (!breakdown) return null;
  return {
    business: ctx.business ?? 'Esotérica Amara',
    branchName: ctx.branchName,
    terminalCode: ctx.terminalCode,
    openedAtIso: c.openedAt,
    openedByName: c.openedByName ?? '-',
    openingCents: c.openingCents,
    closedAtIso: c.closedAt,
    closedByName: c.closedByName ?? '-',
    breakdown,
    expectedCents: c.expectedCents,
    countedCents: c.countedCents,
    differenceCents: c.differenceCents,
    authorizedByName: c.authorizedByName,
    authorization: c.closeAuthorization,
    provisional: c.provisional,
  };
}
