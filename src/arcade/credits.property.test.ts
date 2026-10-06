import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { MAX_CREDITS, insertCoin, tryStart } from './credits';

describe('P1a: credit arithmetic', () => {
  it('credits stay in 0..99, start succeeds iff credits >= 1, a start costs exactly 1, a coin adds 1 capped at 99', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_CREDITS }),
        fc.array(fc.constantFrom('coin' as const, 'start' as const), { maxLength: 300 }),
        (initial, actions) => {
          let credits = initial;
          for (const a of actions) {
            const before = credits;
            if (a === 'coin') {
              const r = insertCoin(before);
              expect(r.credits).toBe(Math.min(before + 1, MAX_CREDITS));
              expect(r.accepted).toBe(before < MAX_CREDITS);
              credits = r.credits;
            } else {
              const r = tryStart(before);
              expect(r.started).toBe(before >= 1);
              expect(r.credits).toBe(r.started ? before - 1 : before);
              credits = r.credits;
            }
            expect(Number.isInteger(credits)).toBe(true);
            expect(credits).toBeGreaterThanOrEqual(0);
            expect(credits).toBeLessThanOrEqual(MAX_CREDITS);
          }
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });
});
