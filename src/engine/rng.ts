/**
 * Seeded mulberry32 PRNG (pinned in game-engine/design.md "Core types").
 * The state is a plain `{ s }` object stored in `GameState.rng`, so the game state stays JSON.
 * Only `Math.imul` and 32-bit integer operations are used.
 */
export interface Rng {
  s: number;
}

export function createRng(seed: number): Rng {
  return { s: seed | 0 };
}

export function nextU32(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform-ish integer in `0..n-1` via `nextU32 % n`. `n` must be an integer ≥ 1. */
export function nextInt(r: Rng, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`nextInt: n must be an integer >= 1, got ${n}`);
  return nextU32(r) % n;
}

/** `pick(r, arr) = arr[nextInt(r, arr.length)]`. Throws `RangeError` on an empty array (programming error). */
export function pick<T>(r: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError('pick: empty array');
  return arr[nextInt(r, arr.length)] as T;
}
