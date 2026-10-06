import { DIR_ORDER, DIR_VEC } from './input';
import { Tile } from './types';
import type { Dir, Maze, MazeError, Result, Vec } from './types';

/** Size bounds accepted by `parseMaze`. Shipped levels are 40x28; tests may use smaller grids. */
export const MIN_MAZE_W = 5;
export const MAX_MAZE_W = 40;
export const MIN_MAZE_H = 5;
export const MAX_MAZE_H = 28;

const CHAR_TILE: Readonly<Record<string, Tile>> = {
  '#': Tile.Wall,
  '.': Tile.Bug,
  ' ': Tile.Floor,
  P: Tile.Spawn,
  E: Tile.Pen,
  '=': Tile.Door,
  X: Tile.Exit,
  U: Tile.Slot,
  W: Tile.Pad,
};

const NO_TILE: Vec = { x: -1, y: -1 };

/** Thrown by `createGame` for an invalid maze (a programming error for shipped levels). */
export class InvalidMazeError extends Error {
  readonly errors: MazeError[];
  constructor(errors: MazeError[]) {
    super(`invalid maze: ${errors.map((e) => e.kind).join(', ')}`);
    this.name = 'InvalidMazeError';
    this.errors = errors;
  }
}

/** Checks size and characters only; `validateMaze` checks everything else. Never throws. */
export function parseMaze(ascii: readonly string[]): Result<Maze, MazeError[]> {
  const h = ascii.length;
  const w = h > 0 ? (ascii[0] as string).length : 0;
  const errors: MazeError[] = [];
  if (h < MIN_MAZE_H || h > MAX_MAZE_H || w < MIN_MAZE_W || w > MAX_MAZE_W) {
    return { ok: false, error: [{ kind: 'bad_size', w, h }] };
  }
  for (const row of ascii) {
    if (row.length !== w) return { ok: false, error: [{ kind: 'bad_size', w: row.length, h }] };
  }
  const cells: Tile[] = new Array<Tile>(w * h);
  let spawn: Vec | null = null;
  let exit: Vec | null = null;
  const pen: Vec[] = [];
  const slots: Vec[] = [];
  const pads: Vec[] = [];
  for (let y = 0; y < h; y++) {
    const row = ascii[y] as string;
    for (let x = 0; x < w; x++) {
      const ch = row[x] as string;
      const tile = CHAR_TILE[ch];
      if (tile === undefined) {
        errors.push({ kind: 'bad_char', x, y, ch });
        cells[y * w + x] = Tile.Wall;
        continue;
      }
      cells[y * w + x] = tile;
      if (tile === Tile.Spawn && spawn === null) spawn = { x, y };
      else if (tile === Tile.Exit && exit === null) exit = { x, y };
      else if (tile === Tile.Pen) pen.push({ x, y });
      else if (tile === Tile.Slot) slots.push({ x, y });
      else if (tile === Tile.Pad) pads.push({ x, y });
    }
  }
  if (errors.length > 0) return { ok: false, error: errors };
  return {
    ok: true,
    value: { w, h, cells, spawn: spawn ?? { ...NO_TILE }, exit: exit ?? { ...NO_TILE }, pen, slots, pads },
  };
}

export function cellAt(maze: Maze, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= maze.w || y >= maze.h) return Tile.Wall;
  return maze.cells[y * maze.w + x] as Tile;
}

/** `#` and `=` are impassable for every entity; out of bounds is impassable. */
export function isPassable(maze: Maze, x: number, y: number): boolean {
  const t = cellAt(maze, x, y);
  return t !== Tile.Wall && t !== Tile.Door;
}

/** True when moving one tile from `from` in direction `d` lands on a passable tile. `d = 0` is false. */
export function canStep(maze: Maze, from: Vec, d: Dir): boolean {
  if (d === 0) return false;
  const v = DIR_VEC[d] as Vec;
  return isPassable(maze, from.x + v.x, from.y + v.y);
}

/** 1 for every tile reachable from `p` over passable tiles (4-neighborhood), else 0. */
export function reachableFrom(maze: Maze, p: Vec): Uint8Array {
  const seen = new Uint8Array(maze.w * maze.h);
  if (!isPassable(maze, p.x, p.y)) return seen;
  const queue = new Int32Array(maze.w * maze.h);
  let head = 0;
  let tail = 0;
  seen[p.y * maze.w + p.x] = 1;
  queue[tail++] = p.y * maze.w + p.x;
  while (head < tail) {
    const idx = queue[head++] as number;
    const x = idx % maze.w;
    const y = (idx - x) / maze.w;
    for (const d of DIR_ORDER) {
      const v = DIR_VEC[d] as Vec;
      const nx = x + v.x;
      const ny = y + v.y;
      if (!isPassable(maze, nx, ny)) continue;
      const n = ny * maze.w + nx;
      if (seen[n] === 1) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return seen;
}

/**
 * BFS from `from` (neighbor order U, L, D, R) to the first tile satisfying `goal`, excluding `from` itself.
 * Returns the first step direction of that shortest path, or 0 when none exists.
 */
/** Marks the BFS start in the `via` array (real first-step directions are 1..4; 0 means unvisited). */
const VIA_START = 5;

/**
 * BFS from `from` (neighbor order U, L, D, R) to the first tile whose index satisfies the goal, excluding
 * `from` itself. Returns the first step direction of that shortest path, or 0 when none exists.
 * Either `target` (a single goal index) or `goal` (a predicate) is used. This is the hot path of a replay,
 * so it works on flat indices with one visit array that stores each tile's first-step direction.
 */
function bfsFirstStep(maze: Maze, from: Vec, target: number, goal: ((idx: number) => boolean) | null): Dir | 0 {
  const { w, cells } = maze;
  // Local copies keep imported-binding lookups out of the hot loop (module runners wrap them in getters).
  const WALL = Tile.Wall;
  const DOOR = Tile.Door;
  if (!isPassable(maze, from.x, from.y)) return 0;
  const size = cells.length;
  // Grids are at most 40x28 = 1120 tiles, so 16-bit indices suffice. `via` holds each visited tile's
  // first-step direction (0 = unvisited); `queue` is a flat FIFO.
  const via = new Uint8Array(size);
  const queue = new Uint16Array(size);
  let head = 0;
  let tail = 0;
  const start = from.y * w + from.x;
  via[start] = VIA_START;
  queue[tail++] = start;
  while (head < tail) {
    const idx = queue[head++] as number;
    const x = idx % w;
    const isStart = idx === start;
    const inherited = via[idx] as number;
    // DIR_ORDER U, L, D, R. Neighbors of the start carry their own direction; later tiles inherit it.
    let n = idx - w;
    if (idx >= w && via[n] === 0) {
      const c = cells[n];
      if (c !== WALL && c !== DOOR) {
        const fd = isStart ? 1 : inherited;
        if (goal === null ? n === target : goal(n)) return fd as Dir;
        via[n] = fd;
        queue[tail++] = n;
      }
    }
    n = idx - 1;
    if (x > 0 && via[n] === 0) {
      const c = cells[n];
      if (c !== WALL && c !== DOOR) {
        const fd = isStart ? 4 : inherited;
        if (goal === null ? n === target : goal(n)) return fd as Dir;
        via[n] = fd;
        queue[tail++] = n;
      }
    }
    n = idx + w;
    if (idx < size - w && via[n] === 0) {
      const c = cells[n];
      if (c !== WALL && c !== DOOR) {
        const fd = isStart ? 3 : inherited;
        if (goal === null ? n === target : goal(n)) return fd as Dir;
        via[n] = fd;
        queue[tail++] = n;
      }
    }
    n = idx + 1;
    if (x < w - 1 && via[n] === 0) {
      const c = cells[n];
      if (c !== WALL && c !== DOOR) {
        const fd = isStart ? 2 : inherited;
        if (goal === null ? n === target : goal(n)) return fd as Dir;
        via[n] = fd;
        queue[tail++] = n;
      }
    }
  }
  return 0;
}

/** First step of a BFS shortest path from `from` to `to`; 0 when unreachable or already there. */
export function bfsNextStep(maze: Maze, from: Vec, to: Vec): Dir | 0 {
  if (from.x === to.x && from.y === to.y) return 0;
  if (!isPassable(maze, to.x, to.y)) return 0;
  return bfsFirstStep(maze, from, to.y * maze.w + to.x, null);
}

/** First step toward the nearest tile (BFS order, excluding `from`) for which `predicate(x, y)` holds; 0 if none. */
export function bfsNearest(maze: Maze, from: Vec, predicate: (x: number, y: number) => boolean): Dir | 0 {
  const w = maze.w;
  return bfsFirstStep(maze, from, -1, (idx) => {
    const x = idx % w;
    return predicate(x, (idx - x) / w);
  });
}

function countTiles(maze: Maze, tile: Tile): Vec[] {
  const out: Vec[] = [];
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      if (maze.cells[y * maze.w + x] === tile) out.push({ x, y });
    }
  }
  return out;
}

const COUNT_RULES: ReadonlyArray<{ tile: 'P' | 'X' | 'E' | 'U' | 'W'; cell: Tile; min: number; max: number }> = [
  { tile: 'P', cell: Tile.Spawn, min: 1, max: 1 },
  { tile: 'X', cell: Tile.Exit, min: 1, max: 1 },
  { tile: 'E', cell: Tile.Pen, min: 4, max: 8 },
  { tile: 'U', cell: Tile.Slot, min: 3, max: 6 },
  { tile: 'W', cell: Tile.Pad, min: 4, max: 4 },
];

/**
 * Overview §5.3: solid border, exactly 1 P, exactly 1 X directly above a door, 4..8 E, 3..6 U, exactly 4 W,
 * and every bug, U and W tile reachable from P. `X` reachability is asserted for shipped levels by P2b.
 */
export function validateMaze(maze: Maze): MazeError[] {
  const errors: MazeError[] = [];
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      const onBorder = x === 0 || y === 0 || x === maze.w - 1 || y === maze.h - 1;
      if (onBorder && maze.cells[y * maze.w + x] !== Tile.Wall) errors.push({ kind: 'border_open', x, y });
    }
  }
  for (const rule of COUNT_RULES) {
    const found = countTiles(maze, rule.cell).length;
    if (found < rule.min || found > rule.max) errors.push({ kind: 'count', tile: rule.tile, found });
  }
  for (const x of countTiles(maze, Tile.Exit)) {
    if (cellAt(maze, x.x, x.y + 1) !== Tile.Door) errors.push({ kind: 'exit_not_above_door', x: x.x, y: x.y });
  }
  const spawns = countTiles(maze, Tile.Spawn);
  const spawn = spawns[0];
  if (spawn !== undefined) {
    const seen = reachableFrom(maze, spawn);
    for (let y = 0; y < maze.h; y++) {
      for (let x = 0; x < maze.w; x++) {
        const idx = y * maze.w + x;
        if (seen[idx] === 1) continue;
        const cell = maze.cells[idx];
        if (cell === Tile.Bug) errors.push({ kind: 'unreachable_bug', x, y });
        else if (cell === Tile.Slot) errors.push({ kind: 'unreachable_tile', tile: 'U', x, y });
        else if (cell === Tile.Pad) errors.push({ kind: 'unreachable_tile', tile: 'W', x, y });
      }
    }
  }
  return errors;
}

/** Parse + validate; returns the maze or every error. */
export function loadMaze(ascii: readonly string[]): Result<Maze, MazeError[]> {
  const parsed = parseMaze(ascii);
  if (!parsed.ok) return parsed;
  const errors = validateMaze(parsed.value);
  return errors.length > 0 ? { ok: false, error: errors } : parsed;
}

/** Parse + validate, throwing `InvalidMazeError` on failure. */
export function loadMazeOrThrow(ascii: readonly string[]): Maze {
  const r = loadMaze(ascii);
  if (!r.ok) throw new InvalidMazeError(r.error);
  return r.value;
}

/** Initial 0/1 bug array for a maze. */
export function initialBugs(maze: Maze): number[] {
  return maze.cells.map((c) => (c === Tile.Bug ? 1 : 0));
}

export function sameTile(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}
