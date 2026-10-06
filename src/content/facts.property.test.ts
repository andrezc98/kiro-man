import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATALOG_ORDER } from '../engine/constants';
import type { PowerKind } from '../engine/types';
import { PBT_RUNS } from '../test-support/pbt';
import { FACTS, pickFact } from './facts';

const usedArb: fc.Arbitrary<Record<PowerKind, number>> = fc.record({
  lambda: fc.nat({ max: 5 }),
  shield: fc.nat({ max: 5 }),
  autoscaling: fc.nat({ max: 5 }),
  cloudfront: fc.nat({ max: 5 }),
  cloudwatch: fc.nat({ max: 5 }),
});

describe('P10: pickFact', () => {
  it('returns a fact for a used service (DynamoDB when none were used), deterministically', () => {
    fc.assert(
      fc.property(usedArb, fc.integer({ min: 0, max: 0xffffffff }), (used, seed) => {
        const fact = pickFact(used, seed);
        expect(FACTS).toContain(fact);
        const usedKinds = CATALOG_ORDER.filter((k) => used[k] > 0);
        if (usedKinds.length === 0) expect(fact.service).toBe('dynamodb');
        else expect(usedKinds).toContain(fact.service);
        expect(pickFact({ ...used }, seed)).toBe(fact);
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
