import { describe, expect, it } from 'vitest';
import {
  addDays, isoToMxLocal, isValidRange, monthRange, mxLocalToIso, presetRange,
  previousMonthRange, weekdayIndex, weekRange,
} from './dates.ts';

// 22 de octubre de 2026 es jueves.
describe('rangos de fechas', () => {
  it('suma días con cambio de mes, año y bisiesto', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('calcula la semana de lunes a domingo', () => {
    expect(weekdayIndex('2026-10-22')).toBe(3);
    expect(weekRange('2026-10-22')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekRange('2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekRange('2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });
  it('calcula mes actual y anterior', () => {
    expect(monthRange('2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(previousMonthRange('2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousMonthRange('2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('atajos terminan hoy', () => {
    expect(presetRange('hoy', '2026-10-22')).toEqual({ from: '2026-10-22', to: '2026-10-22' });
    expect(presetRange('semana', '2026-10-22')).toEqual({ from: '2026-10-19', to: '2026-10-22' });
    expect(presetRange('mes', '2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-22' });
    expect(presetRange('ultimos_30', '2026-10-22')).toEqual({ from: '2026-09-23', to: '2026-10-22' });
  });
  it('valida rangos', () => {
    expect(isValidRange('2026-10-01', '2026-10-22')).toBe(true);
    expect(isValidRange('2026-10-23', '2026-10-22')).toBe(false);
    expect(isValidRange('', '2026-10-22')).toBe(false);
  });
});

describe('hora de México', () => {
  it('convierte datetime-local a UTC y de regreso (UTC-6)', () => {
    expect(mxLocalToIso('2026-10-22T14:30')).toBe('2026-10-22T20:30:00.000Z');
    expect(isoToMxLocal('2026-10-22T20:30:00.000Z')).toBe('2026-10-22T14:30');
    expect(mxLocalToIso('2026-10-22T20:00')).toBe('2026-10-23T02:00:00.000Z');
    expect(mxLocalToIso('')).toBeNull();
  });
});
