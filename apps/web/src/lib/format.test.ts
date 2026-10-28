import { describe, expect, it } from 'vitest';
import {
  centsToInput, describeCashDifference, formatBytes, formatDuration, formatQty,
  monthLabel, parseIntInput, parseMoneyInput, toCsv,
} from './format.ts';

describe('parseMoneyInput', () => {
  it('convierte importes capturados a centavos', () => {
    expect(parseMoneyInput('1,234.50')).toBe(123450);
    expect(parseMoneyInput('99')).toBe(9900);
    expect(parseMoneyInput('$ 10')).toBe(1000);
    expect(parseMoneyInput('0.05')).toBe(5);
  });
  it('rechaza vacíos y formatos inválidos', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('12.345')).toBeNull();
    expect(parseMoneyInput('1,23')).toBeNull();
  });
});

describe('centsToInput / parseIntInput', () => {
  it('formatea centavos para edición', () => {
    expect(centsToInput(12345)).toBe('123.45');
    expect(centsToInput(5)).toBe('0.05');
    expect(centsToInput(null)).toBe('');
  });
  it('solo acepta enteros', () => {
    expect(parseIntInput('12')).toBe(12);
    expect(parseIntInput(' -3 ')).toBe(-3);
    expect(parseIntInput('1.5')).toBeNull();
    expect(parseIntInput('')).toBeNull();
  });
});

describe('etiquetas de texto', () => {
  it('mes, duración, cantidades y bytes', () => {
    expect(monthLabel('2026-10')).toBe('oct 2026');
    expect(monthLabel('xx')).toBe('xx');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatQty(1250)).toBe('1,250');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(undefined)).toBe('-');
  });
  it('describe diferencias de caja', () => {
    expect(describeCashDifference(0)).toBe('Cuadra');
    expect(describeCashDifference(-500)).toBe('Faltante $5.00');
    expect(describeCashDifference(1250)).toBe('Sobrante $12.50');
  });
});

describe('toCsv', () => {
  it('escapa comas, comillas y saltos de línea', () => {
    expect(toCsv(['a', 'b'], [['x,y', 1], ['di "hola"', null]], false)).toBe('a,b\r\n"x,y",1\r\n"di ""hola""",');
  });
  it('agrega BOM por defecto', () => {
    expect(toCsv(['a'], [], true).startsWith('﻿')).toBe(true);
  });
});
