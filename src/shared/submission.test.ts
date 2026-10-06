import { describe, expect, it } from 'vitest';
import { MAX_TICKS } from '../engine/constants';
import { parseReplayInput, parseSubmission } from './submission';
import type { FieldError } from './submission';

const VALID = { initials: 'KIR', seed: 1234, inputLog: [[0, 2], [10, 3], [107999, 0]], claimedScore: 420 };

function errorsOf(u: unknown): FieldError[] {
  const r = parseSubmission(u);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.error;
}

describe('parseSubmission', () => {
  it('accepts a valid submission and returns a copy', () => {
    const r = parseSubmission(VALID);
    expect(r).toEqual({ ok: true, value: VALID });
    if (r.ok) expect(r.value.inputLog).not.toBe(VALID.inputLog);
  });

  it('accepts boundary values', () => {
    expect(parseSubmission({ ...VALID, seed: 0, inputLog: [], claimedScore: 0 }).ok).toBe(true);
    expect(parseSubmission({ ...VALID, seed: 4294967295, claimedScore: 10000000 }).ok).toBe(true);
    const full = Array.from({ length: 10000 }, (_, i) => [i, i % 5]);
    expect(parseSubmission({ ...VALID, inputLog: full }).ok).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ['an extra key', { ...VALID, extra: 1 }, 'extra'],
    ['a missing key', { initials: 'KIR', seed: 1, inputLog: [] }, 'claimedScore'],
    ['a float seed', { ...VALID, seed: 1.5 }, 'seed'],
    ['seed 2^32', { ...VALID, seed: 4294967296 }, 'seed'],
    ['a negative seed', { ...VALID, seed: -1 }, 'seed'],
    ['a string seed', { ...VALID, seed: '12' }, 'seed'],
    ['a negative tick', { ...VALID, inputLog: [[-1, 2]] }, 'inputLog[0][0]'],
    ['tick MAX_TICKS', { ...VALID, inputLog: [[MAX_TICKS, 2]] }, 'inputLog[0][0]'],
    ['equal consecutive ticks', { ...VALID, inputLog: [[5, 2], [5, 3]] }, 'inputLog[1][0]'],
    ['decreasing ticks', { ...VALID, inputLog: [[5, 2], [4, 3]] }, 'inputLog[1][0]'],
    ['dir 5', { ...VALID, inputLog: [[0, 5]] }, 'inputLog[0][1]'],
    ['a float dir', { ...VALID, inputLog: [[0, 1.5]] }, 'inputLog[0][1]'],
    ['a 3-tuple event', { ...VALID, inputLog: [[0, 1, 2]] }, 'inputLog[0]'],
    ['an object event', { ...VALID, inputLog: [{ tick: 0, dir: 1 }] }, 'inputLog[0]'],
    ['a non-array log', { ...VALID, inputLog: 'x' }, 'inputLog'],
    ['10001 events', { ...VALID, inputLog: Array.from({ length: 10001 }, (_, i) => [i, 1]) }, 'inputLog'],
    ['initials "abc"', { ...VALID, initials: 'abc' }, 'initials'],
    ['initials "AB"', { ...VALID, initials: 'AB' }, 'initials'],
    ['claimedScore as a string', { ...VALID, claimedScore: '420' }, 'claimedScore'],
    ['claimedScore over 10000000', { ...VALID, claimedScore: 10000001 }, 'claimedScore'],
    ['a negative claimedScore', { ...VALID, claimedScore: -1 }, 'claimedScore'],
  ])('rejects %s', (_name, u, field) => {
    expect(errorsOf(u).map((e) => e.field)).toContain(field);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', [VALID]],
    ['a string', 'KIR'],
    ['a number', 42],
  ])('rejects a non-object body: %s', (_name, u) => {
    expect(errorsOf(u)).toEqual([{ field: '(root)', message: 'must be a JSON object' }]);
  });

  it('reports several field errors at once', () => {
    const fields = errorsOf({ initials: 'x', seed: -1, inputLog: [], claimedScore: 'no' }).map((e) => e.field);
    expect(fields).toEqual(['initials', 'seed', 'claimedScore']);
  });

  it('a __proto__ key from JSON is an unknown key', () => {
    const u: unknown = JSON.parse('{"initials":"KIR","seed":1,"inputLog":[],"claimedScore":0,"__proto__":{"x":1}}');
    expect(errorsOf(u).map((e) => e.field)).toEqual(['__proto__']);
  });
});

describe('parseReplayInput', () => {
  const { initials: _initials, ...replayInput } = VALID;

  it('accepts the three replay fields without initials', () => {
    expect(parseReplayInput(replayInput)).toEqual({ ok: true, value: replayInput });
  });

  it('applies the same rules to the other fields', () => {
    const r = parseReplayInput({ ...replayInput, seed: 2 ** 32 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((e) => e.field)).toEqual(['seed']);
  });

  it('rejects unknown keys and a non-object', () => {
    expect(parseReplayInput({ ...replayInput, foo: 1 }).ok).toBe(false);
    expect(parseReplayInput(null).ok).toBe(false);
  });
});
