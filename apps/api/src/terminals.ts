/** Terminales (v2): código y nombre automáticos y forma pública. Lógica pura. */

export type TerminalKind = 'escritorio' | 'movil';

const PREFIX: Record<TerminalKind, string> = { escritorio: 'P', movil: 'M' };

/** Siguiente código libre: P1, P2… para escritorio y M1, M2… para móvil (máx. 3 caracteres, único en todo el sistema). */
export function nextTerminalCode(kind: TerminalKind, existingCodes: string[]): string | null {
  const used = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  for (let n = 1; n <= 99; n++) {
    const code = `${PREFIX[kind]}${n}`;
    if (!used.has(code)) return code;
  }
  return null;
}

/** "PC de Ana" / "Móvil de Ana" (máx. 60); sin persona, "PC P1" / "Móvil M1". */
export function terminalName(kind: TerminalKind, assignedTo: string | undefined, code: string): string {
  const base = kind === 'movil' ? 'Móvil' : 'PC';
  const person = (assignedTo ?? '').replace(/\s+/g, ' ').trim();
  return (person ? `${base} de ${person}` : `${base} ${code}`).slice(0, 60).trim();
}

/** Forma pública del contrato: nunca incluye la versión del token. */
export function terminalPublic(t: Record<string, any>) {
  const { _id, tokenVersion: _v, ...rest } = t;
  return { id: (_id ?? t.id) as string, ...rest, assignedTo: (t.assignedTo ?? null) as string | null };
}
