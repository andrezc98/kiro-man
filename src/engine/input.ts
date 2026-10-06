import type { Dir, Vec } from './types';

/** `[tick, dir]`: from this tick on, the held direction is `dir`. Ticks strictly increase. */
export type InputLog = [number, Dir][];

export interface Recorder {
  /** Call before each `step` with the tick about to be stepped and the held direction. */
  record(tick: number, dir: Dir): void;
  readonly log: InputLog;
}

/** Records only changes of the held direction, starting from `last = 0`. */
export function createRecorder(): Recorder {
  const log: InputLog = [];
  let last: Dir = 0;
  return {
    record(tick: number, dir: Dir): void {
      if (dir !== last) {
        log.push([tick, dir]);
        last = dir;
      }
    },
    log,
  };
}

/** Unit vector per `Dir`. Screen coordinates: y grows downward. */
export const DIR_VEC: readonly Vec[] = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** BFS / candidate order: U, L, D, R. */
export const DIR_ORDER: readonly Dir[] = [1, 4, 3, 2];

const REVERSE: readonly Dir[] = [0, 3, 4, 1, 2];

/** `reverse(0) = 0`. */
export function reverse(d: Dir): Dir {
  return REVERSE[d] as Dir;
}

export function isDir(n: unknown): n is Dir {
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4;
}
