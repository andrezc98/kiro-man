/**
 * Pure top-10 ranking (LB-1, LB-2). The single choke point for local and remote lists: every list the
 * UI shows went through `insertScore` or `normalize`, so it is sorted descending, has at most 10
 * entries, and only valid initials.
 */

export interface ScoreEntry {
  initials: string;
  score: number;
  level: number;
}

export const INITIALS_RE = /^[A-Z]{3}$/;
export const MAX_ENTRIES = 10;

/** Initials `^[A-Z]{3}$`, score an integer >= 0, level an integer >= 1. Extra keys are tolerated. */
export function isValidEntry(e: unknown): e is ScoreEntry {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.initials === 'string' &&
    INITIALS_RE.test(o.initials) &&
    typeof o.score === 'number' &&
    Number.isInteger(o.score) &&
    o.score >= 0 &&
    typeof o.level === 'number' &&
    Number.isInteger(o.level) &&
    o.level >= 1
  );
}

/** Only the three fields, so extra keys from storage or the network never reach the UI. */
function copyEntry(e: ScoreEntry): ScoreEntry {
  return { initials: e.initials, score: e.score, level: e.level };
}

/** `score > 0` and (fewer than 10 entries, or strictly greater than the lowest score). */
export function qualifies(list: readonly ScoreEntry[], score: number): boolean {
  if (!(score > 0)) return false;
  if (list.length < MAX_ENTRIES) return true;
  let lowest = Number.POSITIVE_INFINITY;
  for (const e of list) lowest = Math.min(lowest, e.score);
  return score > lowest;
}

/**
 * Inserts a qualifying entry below every entry with an equal or higher score (the earlier entry ranks
 * higher on ties) and truncates to 10. Returns the 1-based rank, or `null` when it does not qualify.
 */
export function insertScore(
  list: readonly ScoreEntry[],
  entry: ScoreEntry,
): { ok: true; list: ScoreEntry[]; rank: number | null } | { ok: false; error: 'invalid_entry'; list: ScoreEntry[] } {
  const copy = list.map(copyEntry);
  if (!isValidEntry(entry)) return { ok: false, error: 'invalid_entry', list: copy };
  if (!qualifies(list, entry.score)) return { ok: true, list: copy, rank: null };
  let at = 0;
  while (at < copy.length && (copy[at] as ScoreEntry).score >= entry.score) at++;
  copy.splice(at, 0, copyEntry(entry));
  return { ok: true, list: copy.slice(0, MAX_ENTRIES), rank: at + 1 };
}

/**
 * Untrusted data (storage, network) to a ranking list: keeps the valid entries, stable-sorts them by
 * score descending, takes 10. `dropped` counts invalid entries (a non-array value counts as one).
 */
export function normalize(raw: unknown): { list: ScoreEntry[]; dropped: number } {
  if (!Array.isArray(raw)) return { list: [], dropped: 1 };
  const valid = raw.filter(isValidEntry).map(copyEntry);
  valid.sort((a, b) => b.score - a.score);
  return { list: valid.slice(0, MAX_ENTRIES), dropped: raw.length - valid.length };
}
