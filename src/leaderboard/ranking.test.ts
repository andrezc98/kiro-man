import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, insertScore, isValidEntry, normalize, qualifies } from './ranking';
import type { ScoreEntry } from './ranking';

const e = (initials: string, score: number, level = 1): ScoreEntry => ({ initials, score, level });

/** Ten entries with scores 1000, 900, ..., 100. */
const FULL: ScoreEntry[] = Array.from({ length: MAX_ENTRIES }, (_, i) => e('AAA', 1000 - i * 100));

describe('isValidEntry', () => {
  it('accepts a valid entry, also with extra keys', () => {
    expect(isValidEntry(e('KIR', 0, 1))).toBe(true);
    expect(isValidEntry({ ...e('KIR', 10, 3), createdAt: 'x' })).toBe(true);
  });

  it.each<[string, unknown]>([
    ['lowercase initials', e('abc', 10)],
    ['two letters', e('AB', 10)],
    ['four letters', e('ABCD', 10)],
    ['a digit in initials', e('A1C', 10)],
    ['a float score', e('ABC', 10.5)],
    ['a negative score', e('ABC', -10)],
    ['a string score', { initials: 'ABC', score: '10', level: 1 }],
    ['level 0', e('ABC', 10, 0)],
    ['a float level', e('ABC', 10, 1.5)],
    ['NaN score', e('ABC', Number.NaN)],
    ['null', null],
    ['an array', ['ABC', 10, 1]],
  ])('rejects %s', (_name, v) => {
    expect(isValidEntry(v)).toBe(false);
  });
});

describe('qualifies', () => {
  it('score 0 never qualifies', () => {
    expect(qualifies([], 0)).toBe(false);
  });

  it('any positive score qualifies while fewer than 10 entries exist', () => {
    expect(qualifies([], 1)).toBe(true);
    expect(qualifies(FULL.slice(0, 9), 1)).toBe(true);
  });

  it('a full list needs a score strictly greater than the lowest', () => {
    expect(qualifies(FULL, 99)).toBe(false);
    expect(qualifies(FULL, 100)).toBe(false);
    expect(qualifies(FULL, 101)).toBe(true);
  });
});

describe('insertScore', () => {
  it('inserts into an empty list at rank 1', () => {
    expect(insertScore([], e('KIR', 50))).toEqual({ ok: true, list: [e('KIR', 50)], rank: 1 });
  });

  it('keeps descending order and returns the 1-based rank', () => {
    const r = insertScore([e('AAA', 300), e('BBB', 100)], e('CCC', 200, 2));
    expect(r).toEqual({ ok: true, list: [e('AAA', 300), e('CCC', 200, 2), e('BBB', 100)], rank: 2 });
  });

  it('a tie ranks below the existing entry', () => {
    const r = insertScore([e('AAA', 200), e('BBB', 100)], e('NEW', 200));
    expect(r).toEqual({ ok: true, list: [e('AAA', 200), e('NEW', 200), e('BBB', 100)], rank: 2 });
  });

  it('an 11th entry lower than all of them is rejected with rank null', () => {
    expect(insertScore(FULL, e('LOW', 50))).toEqual({ ok: true, list: FULL, rank: null });
  });

  it('an 11th entry equal to the lowest is rejected (strictly greater is required)', () => {
    expect(insertScore(FULL, e('EQL', 100))).toEqual({ ok: true, list: FULL, rank: null });
  });

  it('a qualifying entry in a full list drops the lowest', () => {
    const r = insertScore(FULL, e('TOP', 5000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rank).toBe(1);
    expect(r.list).toHaveLength(MAX_ENTRIES);
    expect(r.list[0]).toEqual(e('TOP', 5000));
    expect(r.list.at(-1)).toEqual(e('AAA', 200));
  });

  it('score 0 does not qualify', () => {
    expect(insertScore([], e('ZRO', 0))).toEqual({ ok: true, list: [], rank: null });
  });

  it('rejects an invalid entry and leaves the list unchanged', () => {
    const list = [e('AAA', 300)];
    expect(insertScore(list, e('abc', 500))).toEqual({ ok: false, error: 'invalid_entry', list });
    expect(insertScore(list, e('ABC', 500, 0))).toEqual({ ok: false, error: 'invalid_entry', list });
    expect(insertScore(list, e('ABC', -5))).toEqual({ ok: false, error: 'invalid_entry', list });
    expect(insertScore(list, e('ABC', 2.5))).toEqual({ ok: false, error: 'invalid_entry', list });
  });

  it('never mutates the input list and strips extra keys', () => {
    const list = [e('AAA', 300)];
    const copy = structuredClone(list);
    const r = insertScore(list, { ...e('BBB', 400), extra: true } as ScoreEntry);
    expect(list).toEqual(copy);
    expect(r.ok && r.list[0]).toEqual(e('BBB', 400));
  });
});

describe('normalize', () => {
  it('a non-array gives an empty list', () => {
    expect(normalize(null)).toEqual({ list: [], dropped: 1 });
    expect(normalize({ scores: [] })).toEqual({ list: [], dropped: 1 });
    expect(normalize('[]')).toEqual({ list: [], dropped: 1 });
  });

  it('an array with junk keeps only the valid entries, re-sorted', () => {
    const raw = [e('BBB', 100), 'junk', e('bad', 999), null, e('AAA', 300), { initials: 'CCC' }, e('DDD', 200, 0)];
    expect(normalize(raw)).toEqual({ list: [e('AAA', 300), e('BBB', 100)], dropped: 5 });
  });

  it('more than 10 valid entries are truncated to the top 10, ties stable', () => {
    const raw = Array.from({ length: 13 }, (_, i) => e(String.fromCharCode(65 + i).repeat(3), i < 6 ? 500 : 100 + i));
    const r = normalize(raw);
    expect(r.dropped).toBe(0);
    expect(r.list).toHaveLength(MAX_ENTRIES);
    expect(r.list.slice(0, 6).map((x) => x.initials)).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF']);
    expect(r.list.slice(6).map((x) => x.score)).toEqual([112, 111, 110, 109]);
  });

  it('strips extra keys', () => {
    expect(normalize([{ ...e('AAA', 1), id: 'x', createdAt: 'y' }]).list).toEqual([e('AAA', 1)]);
  });
});
