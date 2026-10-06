import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { initialInitials, initialsReduce, initialsString } from './initials';
import type { InitialsKey } from './initials';

const keyArb: fc.Arbitrary<InitialsKey> = fc.oneof(
  fc.constantFrom<InitialsKey>('up', 'down', 'left', 'right', 'enter', 'tick'),
  fc.string({ unit: 'grapheme', minLength: 0, maxLength: 3 }).map((char) => ({ char })),
  fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }).map((char) => ({ char })),
  fc.constantFrom('a', 'z', 'C', 'M', 'P', 'W', 'S', 'D').map((char) => ({ char })),
);

describe('P9: initials', () => {
  it('for any key sequence (incl. arbitrary unicode), initialsString always matches ^[A-Z]{3}$', () => {
    fc.assert(
      fc.property(fc.array(keyArb, { maxLength: 200 }), (keys) => {
        let s = initialInitials();
        for (const k of keys) {
          s = initialsReduce(s, k);
          expect(initialsString(s)).toMatch(/^[A-Z]{3}$/);
          expect([0, 1, 2]).toContain(s.cursor);
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
