import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { SCREEN_H, SCREEN_W, integerScale } from './scale';

describe('P11 integer scaling', () => {
  it('is the largest integer s >= 1 with 320s <= w and 240s <= h (1 if none)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8000 }), fc.integer({ min: 1, max: 8000 }), (w, h) => {
        const s = integerScale(w, h);
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(1);
        const fits = (k: number): boolean => SCREEN_W * k <= w && SCREEN_H * k <= h;
        if (fits(1)) {
          expect(fits(s)).toBe(true);
          expect(fits(s + 1)).toBe(false);
        } else {
          expect(s).toBe(1);
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
