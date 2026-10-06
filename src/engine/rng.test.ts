import { describe, expect, it } from 'vitest';
import { createRng, nextInt, nextU32, pick } from './rng';

describe('rng (mulberry32)', () => {
  it('matches the golden values for seed 0', () => {
    const r = createRng(0);
    expect([nextU32(r), nextU32(r), nextU32(r), nextU32(r)]).toEqual([1144304738, 1416247, 958946056, 627933444]);
  });

  it('matches the golden values for seed 1', () => {
    const r = createRng(1);
    expect([nextU32(r), nextU32(r), nextU32(r), nextU32(r)]).toEqual([2693262067, 11749833, 2265367787, 4213581821]);
  });

  it('keeps its state as a plain JSON object', () => {
    const r = createRng(123);
    nextU32(r);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('treats seeds as 32-bit (seed and seed + 2^32 agree)', () => {
    const a = createRng(7);
    const b = createRng(7 + 2 ** 32);
    expect(nextU32(a)).toBe(nextU32(b));
  });

  it('nextInt stays in 0..n-1 and equals nextU32 % n', () => {
    const r = createRng(42);
    const copy = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const n = (i % 7) + 1;
      const v = nextInt(r, n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(n);
      expect(v).toBe(nextU32(copy) % n);
    }
  });

  it('nextInt rejects n < 1 and non-integers', () => {
    expect(() => nextInt(createRng(0), 0)).toThrow(RangeError);
    expect(() => nextInt(createRng(0), 1.5)).toThrow(RangeError);
  });

  it('pick(r, arr) = arr[nextInt(r, arr.length)]', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const r = createRng(9);
    const copy = createRng(9);
    for (let i = 0; i < 50; i++) expect(pick(r, arr)).toBe(arr[nextInt(copy, arr.length)]);
  });

  it('pick consumes exactly one draw, even for a single element', () => {
    const r = createRng(5);
    expect(pick(r, ['only'])).toBe('only');
    const ref = createRng(5);
    nextU32(ref);
    expect(r).toEqual(ref);
  });

  it('pick on an empty array throws RangeError', () => {
    expect(() => pick(createRng(0), [])).toThrow(RangeError);
  });
});
