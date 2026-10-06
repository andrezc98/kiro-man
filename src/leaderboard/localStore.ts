/**
 * Local top-10 persistence (LB-3) behind an injected key-value store, so it is testable without a
 * browser. Never throws: every storage failure becomes a warning, and the in-memory list stays the
 * source of truth for the session (overview §10).
 */
import { normalize } from './ranking';
import type { ScoreEntry } from './ranking';

export const STORAGE_KEY = 'kiroman.highscores.v1';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function errText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export function createLocalStore(
  kv: KV | null,
  warn: (m: string) => void,
): { load(): ScoreEntry[]; save(list: ScoreEntry[]): void } {
  let memory: ScoreEntry[] | null = null;
  let store: KV | null = kv;
  let warnedUnavailable = false;

  function unavailable(reason: string): void {
    store = null;
    if (warnedUnavailable) return;
    warnedUnavailable = true;
    warn(`high scores: localStorage unavailable (${reason}); keeping scores in memory for this session`);
  }

  function readStored(): ScoreEntry[] {
    if (store === null) {
      unavailable('not provided');
      return [];
    }
    let text: string | null;
    try {
      text = store.getItem(STORAGE_KEY);
    } catch (e) {
      unavailable(errText(e));
      return [];
    }
    if (text === null) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      warn('high scores: stored data is not valid JSON; starting with an empty list');
      return [];
    }
    const { list, dropped } = normalize(raw);
    if (dropped > 0) warn(`high scores: dropped ${dropped} invalid stored entr${dropped === 1 ? 'y' : 'ies'}`);
    return list;
  }

  return {
    load(): ScoreEntry[] {
      if (memory === null) memory = readStored();
      return memory.map((e) => ({ ...e }));
    },
    save(list: ScoreEntry[]): void {
      memory = normalize(list).list;
      if (store === null) {
        unavailable('not provided');
        return;
      }
      try {
        store.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch (e) {
        warn(`high scores: could not write localStorage (${errText(e)}); the list is kept in memory`);
      }
    },
  };
}
