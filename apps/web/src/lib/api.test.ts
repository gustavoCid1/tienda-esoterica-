import { describe, expect, it } from 'vitest';
import { asList, buildQuery, listTotal } from './api.ts';

describe('cliente de API', () => {
  it('arma la consulta omitiendo vacíos y convierte true en 1', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: null, low: true, out: false, q: 'rosa blanca' })).toBe('?a=1&low=1&q=rosa+blanca');
    expect(buildQuery()).toBe('');
    expect(buildQuery({ x: '' })).toBe('');
  });
  it('normaliza listas simples y paginadas', () => {
    expect(asList([1, 2])).toEqual([1, 2]);
    expect(asList({ items: [3], total: 10 })).toEqual([3]);
    expect(asList(null)).toEqual([]);
    expect(listTotal({ items: [3], total: 10 })).toBe(10);
    expect(listTotal([1, 2])).toBe(2);
  });
});
