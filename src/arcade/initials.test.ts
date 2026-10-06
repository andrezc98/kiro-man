import { describe, expect, it } from 'vitest';
import { INITIALS_TIMEOUT_TICKS, initialInitials, initialsReduce, initialsString } from './initials';
import type { InitialsKey, InitialsState } from './initials';

function run(keys: InitialsKey[], from: InitialsState = initialInitials()): InitialsState {
  return keys.reduce(initialsReduce, from);
}

describe('initials entry', () => {
  it('starts at AAA on slot 0', () => {
    const s = initialInitials();
    expect(initialsString(s)).toBe('AAA');
    expect(s.cursor).toBe(0);
    expect(s.done).toBe(false);
  });

  it('a typed lowercase letter is uppercased and advances the cursor', () => {
    const s = run([{ char: 'a' }]);
    expect(initialsString(s)).toBe('AAA');
    expect(s.cursor).toBe(1);
    expect(initialsString(run([{ char: 'k' }, { char: 'i' }, { char: 'r' }]))).toBe('KIR');
  });

  it('the hotkey letters C, M, P, W, A, S, D are plain letters here', () => {
    expect(initialsString(run([{ char: 'C' }, { char: 'M' }, { char: 'P' }]))).toBe('CMP');
    expect(initialsString(run([{ char: 'W' }, { char: 'A' }, { char: 's' }]))).toBe('WAS');
    expect(initialsString(run([{ char: 'd' }]))).toBe('DAA');
  });

  it('a typed digit, a non-ASCII letter or a multi-char string is ignored', () => {
    const before = initialInitials();
    for (const char of ['5', 'Ä', 'ä', 'ß', ' ', '', 'ab', 'ǅ']) {
      expect(initialsReduce(before, { char })).toBe(before);
    }
  });

  it('Up from A wraps to Z, Down from Z wraps to A', () => {
    const z = run(['down']);
    expect(initialsString(z)).toBe('ZAA');
    expect(initialsString(run(['up'], z))).toBe('AAA');
    expect(initialsString(run(['up', 'up']))).toBe('CAA');
  });

  it('Left at slot 0 stays put and Right at slot 2 stays put', () => {
    expect(run(['left']).cursor).toBe(0);
    expect(run(['right', 'right', 'right', 'right']).cursor).toBe(2);
    expect(run(['right', 'left']).cursor).toBe(0);
  });

  it('a typed letter in slot 2 sets it and does not advance past it', () => {
    const s = run([{ char: 'x' }, { char: 'y' }, { char: 'z' }, { char: 'q' }]);
    expect(s.cursor).toBe(2);
    expect(initialsString(s)).toBe('XYQ');
  });

  it('Enter confirms and later keys are ignored', () => {
    const s = run([{ char: 'b' }, 'enter']);
    expect(s.done).toBe(true);
    expect(run(['up', { char: 'z' }, 'tick'], s)).toBe(s);
    expect(initialsString(s)).toBe('BAA');
  });

  it(`auto-confirms after ${INITIALS_TIMEOUT_TICKS} ticks without a confirm`, () => {
    let s = initialInitials();
    for (let i = 0; i < INITIALS_TIMEOUT_TICKS - 1; i++) s = initialsReduce(s, 'tick');
    expect(s.done).toBe(false);
    s = initialsReduce(s, 'tick');
    expect(s.done).toBe(true);
    expect(s.idle).toBe(INITIALS_TIMEOUT_TICKS);
  });

  it('never mutates its input', () => {
    const s = initialInitials();
    const copy = structuredClone(s);
    run(['up', 'right', { char: 'q' }, 'tick', 'enter'], s);
    expect(s).toEqual(copy);
  });
});
