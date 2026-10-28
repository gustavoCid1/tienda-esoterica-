import { describe, expect, it } from 'vitest';
import { BurstParser, DEFAULT_BURST_CONFIG, ScanGate } from '../src/renderer/lib/scan-burst.ts';
import type { BurstAction } from '../src/renderer/lib/scan-burst.ts';

/** Teclea `text` empezando en t0 con `gap` ms entre teclas y devuelve las acciones. */
function type(p: BurstParser, text: string, t0: number, gap: number): { actions: BurstAction[]; end: number } {
  const actions: BurstAction[] = [];
  let t = t0;
  for (const ch of text) {
    actions.push(p.feed({ key: ch, timeStamp: t }));
    t += gap;
  }
  return { actions, end: t };
}

describe('BurstParser: lectura de escáner USB por ráfaga + Enter', () => {
  it('reconoce una ráfaga rápida terminada en Enter', () => {
    const p = new BurstParser();
    const { actions, end } = type(p, '7501234567890', 1000, 10);
    const enter = p.feed({ key: 'Enter', timeStamp: end });
    expect(enter).toEqual({ type: 'scan', code: '7501234567890', leaked: 2 });
    // las dos primeras teclas pasan, el resto se bloquea
    expect(actions[0]).toEqual({ type: 'buffering' });
    expect(actions[1]).toEqual({ type: 'buffering' });
    expect(actions[2]).toEqual({ type: 'swallow' });
    expect(actions.at(-1)).toEqual({ type: 'swallow' });
  });

  it('no confunde a una persona tecleando lento con un escáner', () => {
    const p = new BurstParser();
    const { end, actions } = type(p, '1234', 0, 180);
    expect(actions.every((a) => a.type === 'buffering')).toBe(true);
    expect(p.feed({ key: 'Enter', timeStamp: end })).toEqual({ type: 'ignore' });
  });

  it('un código demasiado corto no es lectura', () => {
    const p = new BurstParser();
    const { end } = type(p, '123', 0, 5);
    expect(p.feed({ key: 'Enter', timeStamp: end })).toEqual({ type: 'ignore' });
  });

  it('un Enter tardío después de la ráfaga no cuenta (la persona lo pulsó a mano)', () => {
    const p = new BurstParser();
    const { end } = type(p, '75012345', 0, 5);
    expect(p.feed({ key: 'Enter', timeStamp: end + 400 })).toEqual({ type: 'ignore' });
  });

  it('dos lecturas seguidas se separan bien', () => {
    const p = new BurstParser();
    const a = type(p, 'AMA00000001', 0, 8);
    expect(p.feed({ key: 'Enter', timeStamp: a.end })).toMatchObject({ type: 'scan', code: 'AMA00000001' });
    const b = type(p, 'AMA00000002', a.end + 900, 8);
    expect(p.feed({ key: 'Enter', timeStamp: b.end })).toMatchObject({ type: 'scan', code: 'AMA00000002' });
  });

  it('Shift no rompe la ráfaga (códigos con mayúsculas)', () => {
    const p = new BurstParser();
    let t = 0;
    for (const ch of 'AMA0001') {
      if (/[A-Z]/.test(ch)) p.feed({ key: 'Shift', timeStamp: t });
      p.feed({ key: ch, timeStamp: (t += 6) });
    }
    expect(p.feed({ key: 'Enter', timeStamp: t + 6 })).toMatchObject({ type: 'scan', code: 'AMA0001' });
  });

  it('Ctrl/Alt reinician la ráfaga (atajos de teclado no son lecturas)', () => {
    const p = new BurstParser();
    type(p, '1234567', 0, 5);
    expect(p.feed({ key: 'v', timeStamp: 40, ctrlKey: true })).toEqual({ type: 'ignore' });
    expect(p.feed({ key: 'Enter', timeStamp: 45 })).toEqual({ type: 'ignore' });
  });

  it('otras teclas (flechas, Backspace) cortan la ráfaga', () => {
    const p = new BurstParser();
    type(p, '1234567', 0, 5);
    p.feed({ key: 'Backspace', timeStamp: 40 });
    expect(p.feed({ key: 'Enter', timeStamp: 45 })).toEqual({ type: 'ignore' });
  });

  it('acepta Tab como terminador y respeta maxLength', () => {
    const p = new BurstParser();
    const { end } = type(p, '12345678', 0, 5);
    expect(p.feed({ key: 'Tab', timeStamp: end })).toMatchObject({ type: 'scan', code: '12345678' });
    const long = new BurstParser({ ...DEFAULT_BURST_CONFIG, maxLength: 6 });
    const r = type(long, '12345678', 0, 5);
    expect(long.feed({ key: 'Enter', timeStamp: r.end })).toEqual({ type: 'ignore' });
  });

  it('respeta un intervalo máximo configurado', () => {
    const p = new BurstParser({ ...DEFAULT_BURST_CONFIG, maxGapMs: 100 });
    const { end } = type(p, '7501234', 0, 80);
    expect(p.feed({ key: 'Enter', timeStamp: end - 80 + 80 })).toMatchObject({ type: 'scan', code: '7501234' });
  });
});

describe('ScanGate: lecturas repetidas', () => {
  it('ignora el doble disparo y acepta la misma pieza después de una pausa', () => {
    const g = new ScanGate(700);
    expect(g.accept('A1', 1000)).toBe(true);
    expect(g.accept('A1', 1300)).toBe(false); // doble lectura
    expect(g.accept('B2', 1400)).toBe(true); // otro código siempre pasa
    expect(g.accept('A1', 2100)).toBe(true); // 800 ms después de la última lectura de A1 (1300)
  });

  it('mantener disparando no suma piezas', () => {
    const g = new ScanGate(700);
    expect(g.accept('A1', 0)).toBe(true);
    for (let t = 300; t <= 3000; t += 300) expect(g.accept('A1', t)).toBe(false);
    expect(g.accept('A1', 3800)).toBe(true);
  });
});
