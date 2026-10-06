import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, createLocalStore } from './localStore';
import type { KV } from './localStore';
import type { ScoreEntry } from './ranking';

const e = (initials: string, score: number, level = 1): ScoreEntry => ({ initials, score, level });

function memoryKV(initial: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function collect(): { warn: (m: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (m) => messages.push(m), messages };
}

describe('createLocalStore', () => {
  it('uses the key kiroman.highscores.v1 and round-trips a list as JSON', () => {
    expect(STORAGE_KEY).toBe('kiroman.highscores.v1');
    const kv = memoryKV();
    const { warn, messages } = collect();
    const store = createLocalStore(kv, warn);
    store.save([e('KIR', 500, 2), e('AAA', 100)]);
    expect(JSON.parse(kv.data[STORAGE_KEY] as string)).toEqual([e('KIR', 500, 2), e('AAA', 100)]);
    expect(createLocalStore(kv, warn).load()).toEqual([e('KIR', 500, 2), e('AAA', 100)]);
    expect(messages).toEqual([]);
  });

  it('missing data loads an empty list without a warning', () => {
    const { warn, messages } = collect();
    expect(createLocalStore(memoryKV(), warn).load()).toEqual([]);
    expect(messages).toEqual([]);
  });

  it('corrupt JSON loads an empty list and warns once', () => {
    const { warn, messages } = collect();
    const store = createLocalStore(memoryKV({ [STORAGE_KEY]: '{not json' }), warn);
    expect(store.load()).toEqual([]);
    expect(store.load()).toEqual([]);
    expect(messages).toHaveLength(1);
  });

  it('partially invalid entries: loads only the valid ones, re-sorted and truncated, and warns once', () => {
    const stored = [e('BBB', 100), e('bad', 900), 'junk', e('AAA', 300), ...Array.from({ length: 12 }, () => e('CCC', 50))];
    const { warn, messages } = collect();
    const list = createLocalStore(memoryKV({ [STORAGE_KEY]: JSON.stringify(stored) }), warn).load();
    expect(list).toHaveLength(10);
    expect(list.slice(0, 3)).toEqual([e('AAA', 300), e('BBB', 100), e('CCC', 50)]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('2 invalid');
  });

  it('a non-array stored value loads an empty list and warns', () => {
    const { warn, messages } = collect();
    expect(createLocalStore(memoryKV({ [STORAGE_KEY]: '{"a":1}' }), warn).load()).toEqual([]);
    expect(messages).toHaveLength(1);
  });

  it('a throwing storage falls back to memory for the session with one warning', () => {
    const throwing: KV = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const { warn, messages } = collect();
    const store = createLocalStore(throwing, warn);
    expect(store.load()).toEqual([]);
    store.save([e('KIR', 10)]);
    expect(store.load()).toEqual([e('KIR', 10)]);
    store.save([e('KIR', 20)]);
    expect(store.load()).toEqual([e('KIR', 20)]);
    expect(messages).toHaveLength(1);
  });

  it('no storage at all (null) keeps scores in memory with one warning', () => {
    const { warn, messages } = collect();
    const store = createLocalStore(null, warn);
    expect(store.load()).toEqual([]);
    store.save([e('KIR', 10)]);
    expect(store.load()).toEqual([e('KIR', 10)]);
    expect(messages).toHaveLength(1);
  });

  it('a quota error on write warns and still updates the in-memory list', () => {
    const kv = memoryKV({ [STORAGE_KEY]: JSON.stringify([e('OLD', 5)]) });
    kv.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const { warn, messages } = collect();
    const store = createLocalStore(kv, warn);
    expect(store.load()).toEqual([e('OLD', 5)]);
    store.save([e('NEW', 50), e('OLD', 5)]);
    expect(store.load()).toEqual([e('NEW', 50), e('OLD', 5)]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('QuotaExceededError');
  });

  it('load returns a copy that callers cannot use to mutate the store', () => {
    const store = createLocalStore(memoryKV(), () => undefined);
    store.save([e('KIR', 10)]);
    const list = store.load();
    list.push(e('ZZY', 1));
    (list[0] as ScoreEntry).score = 999;
    expect(store.load()).toEqual([e('KIR', 10)]);
  });
});
