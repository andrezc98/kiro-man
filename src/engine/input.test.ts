import { describe, expect, it } from 'vitest';
import { DIR_ORDER, DIR_VEC, createRecorder, isDir, reverse } from './input';

describe('input', () => {
  it('the recorder starts at last = 0, so no key presses records an empty log', () => {
    const rec = createRecorder();
    for (let t = 0; t < 100; t++) rec.record(t, 0);
    expect(rec.log).toEqual([]);
  });

  it('the recorder only records changes of the held direction', () => {
    const rec = createRecorder();
    const held = [0, 2, 2, 2, 1, 1, 0, 0, 3] as const;
    held.forEach((d, t) => rec.record(t, d));
    expect(rec.log).toEqual([
      [1, 2],
      [4, 1],
      [6, 0],
      [8, 3],
    ]);
  });

  it('reverse flips directions and reverse(0) = 0', () => {
    expect(reverse(0)).toBe(0);
    expect(reverse(1)).toBe(3);
    expect(reverse(3)).toBe(1);
    expect(reverse(2)).toBe(4);
    expect(reverse(4)).toBe(2);
  });

  it('DIR_ORDER is U, L, D, R and DIR_VEC uses screen coordinates', () => {
    expect(DIR_ORDER).toEqual([1, 4, 3, 2]);
    expect(DIR_VEC[1]).toEqual({ x: 0, y: -1 });
    expect(DIR_VEC[2]).toEqual({ x: 1, y: 0 });
    expect(DIR_VEC[3]).toEqual({ x: 0, y: 1 });
    expect(DIR_VEC[4]).toEqual({ x: -1, y: 0 });
  });

  it('isDir accepts exactly 0..4', () => {
    expect([0, 1, 2, 3, 4].every(isDir)).toBe(true);
    expect([5, -1, 1.5, '1', null].some(isDir)).toBe(false);
  });
});
