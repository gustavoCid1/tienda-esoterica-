/** Generación de identificadores y folios. */

/** UUID v4. Usa crypto.randomUUID cuando existe; si no, getRandomValues. */
export function newId(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // Último recurso (no criptográfico): solo para identificadores, nunca secretos.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/**
 * Folio de venta legible y único por terminal y día:
 *   AMA-<sucursal><terminal>-<aammdd>-<consecutivo de 4 dígitos>
 * La unicidad global la da el código de terminal (único en el sistema).
 */
export function buildFolio(branchCode: string, terminalCode: string, dayKey: string, seq: number): string {
  const yymmdd = dayKey.replace(/-/g, '').slice(2);
  return `AMA-${branchCode}${terminalCode}-${yymmdd}-${String(seq).padStart(4, '0')}`;
}

/** Identificador interno de variante para códigos de barras (Code 128). */
export function buildInternalCode(seq: number): string {
  return `AMA${String(seq).padStart(8, '0')}`;
}

/** Contenido del QR de una variante: identifica, no autentica; sin credenciales. */
export function buildQrValue(variantId: string): string {
  return `amara:v1:${variantId}`;
}

export function parseQrValue(text: string): string | null {
  const m = /^amara:v1:([0-9a-fA-F-]{36})$/.exec(text.trim());
  return m ? m[1]!.toLowerCase() : null;
}
