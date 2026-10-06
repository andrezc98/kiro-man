/** Engine test helpers (tests only). */
import { MAX_TICKS } from '../engine/constants';
import { createGame, step } from '../engine/game';
import { createRecorder } from '../engine/input';
import type { InputLog } from '../engine/input';
import { parseMaze } from '../engine/maze';
import type { Dir, GameConfig, GameState, Maze } from '../engine/types';

/** A new game stepped through `ready` with dir 0, so the next `step` is the first `playing` step. */
export function startPlaying(seed: number, config: Partial<GameConfig> = {}): GameState {
  const s = createGame(seed, config);
  while (s.phase === 'ready') step(s, 0);
  return s;
}

export function stepN(state: GameState, n: number, dir: Dir = 0): void {
  for (let i = 0; i < n; i++) step(state, dir);
}

/** Strictly increasing input log from `[delta, dir]` pairs (overview §8 generator shape). */
export function logFromDeltas(deltas: ReadonlyArray<readonly [number, number]>, maxTick = Number.POSITIVE_INFINITY): InputLog {
  const log: InputLog = [];
  let tick = -1;
  for (const [delta, dir] of deltas) {
    tick += delta;
    if (tick > maxTick) break;
    log.push([tick, dir as Dir]);
  }
  return log;
}

/** The held direction at `tick` for a log, using the replay rule (events apply from their tick on). */
export function heldAt(log: InputLog, tick: number): Dir {
  let held: Dir = 0;
  for (const [t, d] of log) {
    if (t > tick) break;
    held = d;
  }
  return held;
}

/**
 * The client recorder loop (overview §5.2): before each step read the held direction, record it if it
 * changed, then step. Stops at gameOver or `maxTicks`.
 */
export function recordGame(
  seed: number,
  held: (tick: number) => Dir,
  opts: { startLives?: number; maxTicks?: number; maze?: readonly string[] } = {},
): { state: GameState; log: InputLog } {
  const config: Partial<GameConfig> = {};
  if (opts.startLives !== undefined) config.startLives = opts.startLives;
  if (opts.maze !== undefined) config.maze = [...opts.maze];
  const s = createGame(seed, config);
  const rec = createRecorder();
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  while (s.phase !== 'gameOver' && s.tick < maxTicks) {
    const d = held(s.tick);
    rec.record(s.tick, d);
    step(s, d);
  }
  return { state: s, log: rec.log };
}

/** Parse a test maze without validation (movement and AI tests use partial mazes). */
export function rawMaze(ascii: readonly string[]): Maze {
  const r = parseMaze(ascii);
  if (!r.ok) throw new Error(`test maze does not parse: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Replace characters at `[x, y, ch]` positions. */
export function withChars(ascii: readonly string[], edits: ReadonlyArray<[number, number, string]>): string[] {
  const rows = ascii.map((r) => r.split(''));
  for (const [x, y, ch] of edits) (rows[y] as string[])[x] = ch;
  return rows.map((r) => r.join(''));
}

/** Pixel-free fixed-point position along x/y, for "on-screen position unchanged" assertions. */
export function fixedPos(m: { tile: { x: number; y: number }; dir: Dir; progress: number }): { x: number; y: number } {
  const v = [
    [0, 0],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ][m.dir] as [number, number];
  return { x: m.tile.x * 256 + v[0] * m.progress, y: m.tile.y * 256 + v[1] * m.progress };
}
