import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_TICKS } from '../engine/constants';
import { PBT_RUNS } from '../test-support/pbt';
import { logFromDeltas } from '../test-support/engine';
import { parseSubmission } from './submission';

/** Independent oracle for every LB-4 rule (overview §7.3). */
function oracle(u: unknown): boolean {
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return false;
  const o = u as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(',') !== 'claimedScore,initials,inputLog,seed') return false;
  const int = (v: unknown, lo: number, hi: number): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (typeof o.initials !== 'string' || !/^[A-Z]{3}$/.test(o.initials)) return false;
  if (!int(o.seed, 0, 2 ** 32 - 1)) return false;
  if (!int(o.claimedScore, 0, 1e7)) return false;
  const log = o.inputLog;
  if (!Array.isArray(log) || log.length > 10000) return false;
  let prev = -1;
  for (const ev of log) {
    if (!Array.isArray(ev) || ev.length !== 2) return false;
    const [t, d] = ev as unknown[];
    if (!int(t, 0, MAX_TICKS - 1) || (t as number) <= prev || !int(d, 0, 4)) return false;
    prev = t as number;
  }
  return true;
}

const validArb = fc.record({
  initials: fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), { minLength: 3, maxLength: 3 }).map((a) => a.join('')),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  inputLog: fc
    .array(fc.tuple(fc.integer({ min: 1, max: 90 }), fc.integer({ min: 0, max: 4 })), { maxLength: 40 })
    .map((d) => logFromDeltas(d, MAX_TICKS - 1)),
  claimedScore: fc.integer({ min: 0, max: 10000000 }),
});

/** Values chosen to sit on and around each rule's boundary. */
const fieldValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  fc.constantFrom(-1, 0, 1, 1.5, 4, 5, 107999, 108000, 10000000, 10000001, 4294967295, 4294967296, 'AAA', 'aaa', 'AB', 'ABCD', null),
  fc.array(fc.tuple(fc.integer({ min: -2, max: 108001 }), fc.integer({ min: -1, max: 6 })), { maxLength: 6 }),
);

const mutationArb = fc.oneof(
  // Replace one field.
  fc.record({ kind: fc.constant('set' as const), key: fc.constantFrom('initials', 'seed', 'inputLog', 'claimedScore'), value: fieldValueArb }),
  // Remove one field.
  fc.record({ kind: fc.constant('delete' as const), key: fc.constantFrom('initials', 'seed', 'inputLog', 'claimedScore') }),
  // Add an unknown field.
  fc.record({ kind: fc.constant('add' as const), key: fc.string({ maxLength: 8 }), value: fc.jsonValue() }),
  // Mutate one input-log event.
  fc.record({ kind: fc.constant('event' as const), index: fc.nat({ max: 40 }), value: fieldValueArb }),
);

type Mutation = typeof mutationArb extends fc.Arbitrary<infer M> ? M : never;

function mutate(valid: Record<string, unknown>, m: Mutation): unknown {
  const copy: Record<string, unknown> = structuredClone(valid);
  switch (m.kind) {
    case 'set':
      copy[m.key] = m.value;
      break;
    case 'delete':
      delete copy[m.key];
      break;
    case 'add':
      copy[m.key] = m.value;
      break;
    case 'event': {
      const log = copy.inputLog as unknown[];
      if (log.length > 0) log[m.index % log.length] = m.value;
      break;
    }
  }
  return copy;
}

describe('P8: parseSubmission', () => {
  it('never throws on any JSON value and is ok iff every LB-4 rule holds', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (u) => {
        const r = parseSubmission(u);
        expect(r.ok).toBe(oracle(u));
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('valid submissions parse to themselves', () => {
    fc.assert(
      fc.property(validArb, (v) => {
        expect(parseSubmission(v)).toEqual({ ok: true, value: v });
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('for any single-field mutation of a valid submission, ok iff every rule holds', () => {
    fc.assert(
      fc.property(validArb, mutationArb, (v, m) => {
        const u = mutate(v, m);
        const r = parseSubmission(u);
        expect(r.ok).toBe(oracle(u));
        if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
