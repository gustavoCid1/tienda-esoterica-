import { describe, expect, it } from 'vitest';
import { computeSale } from '@amara/shared';
import { parsePesos } from '../src/renderer/lib/format.ts';
import { planPayments } from '../src/renderer/lib/payments.ts';

describe('planPayments', () => {
  it('efectivo exacto sin recibido', () => {
    const r = planPayments({ totalCents: 15000, nonCash: {}, cashTenderedCents: null });
    expect(r).toMatchObject({ ok: true, cashDueCents: 15000, tenderedCents: 15000, changeCents: 0 });
  });

  it('efectivo con cambio', () => {
    const r = planPayments({ totalCents: 15000, nonCash: {}, cashTenderedCents: 20000 });
    expect(r).toMatchObject({ ok: true, changeCents: 5000 });
    if (r.ok) expect(r.payments).toEqual([{ method: 'efectivo', amountCents: 15000, tenderedCents: 20000 }]);
  });

  it('pago mixto: tarjeta + efectivo con cambio, y lo acepta computeSale', () => {
    const r = planPayments({ totalCents: 30000, nonCash: { tarjeta: 10000 }, cashTenderedCents: 50000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cashDueCents).toBe(20000);
    expect(r.changeCents).toBe(30000);
    const sale = computeSale([{ variantId: 'a', qty: 2, unitPriceCents: 15000, unitCostCents: 0 }], 0, r.payments);
    expect(sale.totalCents).toBe(30000);
    expect(sale.changeCents).toBe(30000);
  });

  it('solo tarjeta: no hay renglón de efectivo', () => {
    const r = planPayments({ totalCents: 9000, nonCash: { tarjeta: 9000 }, cashTenderedCents: 100 });
    expect(r).toMatchObject({ ok: true, cashDueCents: 0, changeCents: 0 });
    if (r.ok) expect(r.payments).toEqual([{ method: 'tarjeta', amountCents: 9000 }]);
  });

  it('rechaza efectivo insuficiente y pagos que exceden el total', () => {
    expect(planPayments({ totalCents: 10000, nonCash: {}, cashTenderedCents: 5000 }).ok).toBe(false);
    expect(planPayments({ totalCents: 10000, nonCash: { tarjeta: 8000, transferencia: 3000 }, cashTenderedCents: null }).ok).toBe(false);
    expect(planPayments({ totalCents: 0, nonCash: {}, cashTenderedCents: null }).ok).toBe(false);
  });
});

describe('parsePesos', () => {
  it('convierte importes a centavos y rechaza basura', () => {
    expect(parsePesos('123.45')).toBe(12345);
    expect(parsePesos('$1,234.5')).toBe(123450);
    expect(parsePesos('.5')).toBe(50);
    expect(parsePesos('')).toBeNull();
    expect(Number.isNaN(parsePesos('1e3'))).toBe(true);
    expect(Number.isNaN(parsePesos('12.345'))).toBe(true);
    expect(Number.isNaN(parsePesos('abc'))).toBe(true);
  });
});
