import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { INITIALS_RE, MAX_ENTRIES, insertScore, qualifies } from './ranking';
import type { ScoreEntry } from './ranking';

const initialsArb = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), { minLength: 3, maxLength: 3 })
  .map((a) => a.join(''));

/** Small score range so ties and "equal to the lowest" cases are frequent. */
const validEntryArb: fc.Arbitrary<ScoreEntry> = fc.record({
  initials: fc.oneof(initialsArb, fc.constantFrom('AAA', 'KIR')),
  score: fc.nat({ max: 60 }).map((n) => n * 10),
  level: fc.integer({ min: 1, max: 4 }),
});

const invalidEntryArb: fc.Arbitrary<ScoreEntry> = fc.oneof(
  validEntryArb.chain((v) => fc.string({ maxLength: 4 }).filter((s) => !INITIALS_RE.test(s)).map((initials) => ({ ...v, initials }))),
  validEntryArb.chain((v) => fc.integer({ min: -1000, max: -1 }).map((score) => ({ ...v, score }))),
  validEntryArb.map((v) => ({ ...v, score: v.score + 0.5 })),
  validEntryArb.chain((v) => fc.integer({ min: -3, max: 0 }).map((level) => ({ ...v, level }))),
);

/** A valid ranking list: stable-sorted descending, at most 10 entries. */
const listArb = fc
  .array(validEntryArb, { maxLength: MAX_ENTRIES })
  .map((l) => [...l].sort((a, b) => b.score - a.score));

const count = (list: readonly ScoreEntry[], x: ScoreEntry): number =>
  list.filter((e) => e.initials === x.initials && e.score === x.score && e.level === x.level).length;

function isSortedDesc(list: readonly ScoreEntry[]): boolean {
  return list.every((e, i) => i === 0 || (list[i - 1] as ScoreEntry).score >= e.score);
}

describe('P6: insertScore', () => {
  it('sorted desc (stable ties), <= 10, valid initials; candidate count +1 iff qualifies, else unchanged', () => {
    fc.assert(
      fc.property(listArb, validEntryArb, (list, candidate) => {
        const before = structuredClone(list);
        const q = qualifies(list, candidate.score);
        const r = insertScore(list, candidate);
        expect(list).toEqual(before);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(isSortedDesc(r.list)).toBe(true);
        expect(r.list.length).toBeLessThanOrEqual(MAX_ENTRIES);
        for (const e of r.list) expect(e.initials).toMatch(INITIALS_RE);
        if (q) {
          expect(count(r.list, candidate)).toBe(count(list, candidate) + 1);
          expect(r.rank).not.toBeNull();
          const rank = r.rank as number;
          expect(r.list[rank - 1]).toEqual(candidate);
          // Stable ties: every earlier entry with the same score stays above the new one.
          expect(r.list.slice(rank).every((e) => e.score <= candidate.score)).toBe(true);
          expect(r.list.slice(0, rank - 1).every((e) => e.score >= candidate.score)).toBe(true);
          expect(r.list.filter((e) => e.score === candidate.score).at(-1)).toEqual(candidate);
          // Everything else keeps its relative order.
          const rest = [...r.list.slice(0, rank - 1), ...r.list.slice(rank)];
          expect(rest).toEqual(list.slice(0, rest.length));
        } else {
          expect(r.list).toEqual(list);
          expect(r.rank).toBeNull();
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('invalid entries are rejected and leave the list unchanged', () => {
    fc.assert(
      fc.property(listArb, invalidEntryArb, (list, candidate) => {
        const r = insertScore(list, candidate);
        expect(r.ok).toBe(false);
        expect(r.list).toEqual(list);
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
