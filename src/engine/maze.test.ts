import { describe, expect, it } from 'vitest';
import { LEVELS, levelFor } from './levels';
import {
  InvalidMazeError,
  bfsNearest,
  bfsNextStep,
  isPassable,
  loadMazeOrThrow,
  parseMaze,
  reachableFrom,
  validateMaze,
} from './maze';
import { WALLED_OFF_MAZE } from './test-fixtures';
import { Tile } from './types';
import type { Maze, MazeError } from './types';

function withChars(ascii: readonly string[], edits: Array<[number, number, string]>): string[] {
  const rows = ascii.map((r) => r.split(''));
  for (const [x, y, ch] of edits) (rows[y] as string[])[x] = ch;
  return rows.map((r) => r.join(''));
}

function errorsOf(ascii: readonly string[]): MazeError[] {
  const parsed = parseMaze(ascii);
  if (!parsed.ok) return parsed.error;
  return validateMaze(parsed.value);
}

function parsed(ascii: readonly string[]): Maze {
  const r = parseMaze(ascii);
  if (!r.ok) throw new Error('fixture should parse');
  return r.value;
}

describe('parseMaze', () => {
  it('parses the legend into cells and row-major lists', () => {
    const m = parsed(WALLED_OFF_MAZE);
    expect(m.w).toBe(12);
    expect(m.h).toBe(8);
    expect(m.spawn).toEqual({ x: 3, y: 2 });
    expect(m.exit).toEqual({ x: 10, y: 1 });
    expect(m.pen).toEqual([
      { x: 10, y: 3 },
      { x: 10, y: 4 },
      { x: 10, y: 5 },
      { x: 10, y: 6 },
    ]);
    expect(m.slots).toEqual([
      { x: 4, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 5 },
    ]);
    expect(m.pads).toEqual([
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 8, y: 3 },
      { x: 8, y: 4 },
    ]);
    expect(m.cells[2 * 12 + 1]).toBe(Tile.Bug);
    expect(m.cells[2 * 12 + 10]).toBe(Tile.Door);
  });

  it('bad_size: too small, too large, or ragged rows', () => {
    expect(errorsOf(['####', '####', '####', '####'])).toEqual([{ kind: 'bad_size', w: 4, h: 4 }]);
    expect(errorsOf(new Array(29).fill('#'.repeat(10)))).toEqual([{ kind: 'bad_size', w: 10, h: 29 }]);
    expect(errorsOf(['#'.repeat(41), ...new Array(5).fill('#'.repeat(41))])).toEqual([
      { kind: 'bad_size', w: 41, h: 6 },
    ]);
    const ragged = [...WALLED_OFF_MAZE];
    ragged[3] = `${ragged[3]}#`;
    expect(errorsOf(ragged)).toEqual([{ kind: 'bad_size', w: 13, h: 8 }]);
    expect(errorsOf([])).toEqual([{ kind: 'bad_size', w: 0, h: 0 }]);
  });

  it('bad_char: unknown characters are reported with their position', () => {
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[2, 4, '?']]))).toEqual([{ kind: 'bad_char', x: 2, y: 4, ch: '?' }]);
  });

  it('never throws on arbitrary rows', () => {
    expect(() => parseMaze(['\u0000\u0000\u0000\u0000\u0000', 'x', '', 'abc', 'zzzzz'])).not.toThrow();
  });
});

describe('validateMaze', () => {
  it('accepts a valid maze', () => {
    expect(errorsOf(WALLED_OFF_MAZE)).toEqual([]);
  });

  it('border_open: a non-wall tile on the border', () => {
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[0, 4, '.']]))).toContainEqual({ kind: 'border_open', x: 0, y: 4 });
  });

  it('count: P, X, E, U and W counts', () => {
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[3, 2, '.']]))).toContainEqual({ kind: 'count', tile: 'P', found: 0 });
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[5, 2, 'P']]))).toContainEqual({ kind: 'count', tile: 'P', found: 2 });
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[10, 1, '#']]))).toContainEqual({ kind: 'count', tile: 'X', found: 0 });
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[10, 6, '#']]))).toContainEqual({ kind: 'count', tile: 'E', found: 3 });
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[4, 1, '.']]))).toContainEqual({ kind: 'count', tile: 'U', found: 2 });
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[1, 1, '.']]))).toContainEqual({ kind: 'count', tile: 'W', found: 3 });
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[5, 6, 'W']]))).toContainEqual({ kind: 'count', tile: 'W', found: 5 });
  });

  it('exit_not_above_door: X needs a door directly below', () => {
    const errors = errorsOf(withChars(WALLED_OFF_MAZE, [[10, 2, '#']]));
    expect(errors).toContainEqual({ kind: 'exit_not_above_door', x: 10, y: 1 });
  });

  it('unreachable_bug: a bug sealed off from P', () => {
    // (7,6) becomes a wall, sealing the bug at (8,6) (walls at (8,5), (9,6) and the border).
    expect(errorsOf(withChars(WALLED_OFF_MAZE, [[7, 6, '#']]))).toEqual([{ kind: 'unreachable_bug', x: 8, y: 6 }]);
  });

  it('unreachable_tile: a U slot sealed off from P', () => {
    const errors = errorsOf(withChars(WALLED_OFF_MAZE, [[7, 6, '#'], [8, 6, 'U']]));
    expect(errors).toEqual([{ kind: 'unreachable_tile', tile: 'U', x: 8, y: 6 }]);
  });

  it('unreachable_tile: a W pad sealed off from P', () => {
    const errors = errorsOf(withChars(WALLED_OFF_MAZE, [[7, 6, '#'], [8, 6, 'W'], [8, 4, '.']]));
    expect(errors).toEqual([{ kind: 'unreachable_tile', tile: 'W', x: 8, y: 6 }]);
  });

  it('does not require X to be reachable (fixtures seal it); shipped levels assert it in P2b', () => {
    const m = parsed(WALLED_OFF_MAZE);
    expect(validateMaze(m)).toEqual([]);
    expect(reachableFrom(m, m.spawn)[m.exit.y * m.w + m.exit.x]).toBe(0);
  });

  it('loadMazeOrThrow throws InvalidMazeError carrying the errors', () => {
    try {
      loadMazeOrThrow(withChars(WALLED_OFF_MAZE, [[7, 6, '#']]));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidMazeError);
      expect((e as InvalidMazeError).errors).toEqual([{ kind: 'unreachable_bug', x: 8, y: 6 }]);
    }
  });
});

describe('passability and BFS', () => {
  const m = parsed(WALLED_OFF_MAZE);

  it('walls, doors and out-of-bounds are impassable; pen, exit, slots and pads are passable', () => {
    expect(isPassable(m, 0, 0)).toBe(false);
    expect(isPassable(m, 10, 2)).toBe(false);
    expect(isPassable(m, -1, 3)).toBe(false);
    expect(isPassable(m, 12, 3)).toBe(false);
    expect(isPassable(m, 10, 3)).toBe(true);
    expect(isPassable(m, 10, 1)).toBe(true);
    expect(isPassable(m, 4, 1)).toBe(true);
    expect(isPassable(m, 1, 1)).toBe(true);
  });

  it('bfsNextStep returns the first step of a shortest path, 0 when there or unreachable', () => {
    expect(bfsNextStep(m, { x: 3, y: 2 }, { x: 3, y: 6 })).toBe(3);
    expect(bfsNextStep(m, { x: 3, y: 2 }, { x: 1, y: 2 })).toBe(4);
    expect(bfsNextStep(m, { x: 3, y: 2 }, { x: 3, y: 2 })).toBe(0);
    expect(bfsNextStep(m, { x: 3, y: 2 }, { x: 10, y: 1 })).toBe(0);
    expect(bfsNextStep(m, { x: 3, y: 2 }, { x: 0, y: 0 })).toBe(0);
  });

  it('bfsNextStep breaks ties in U, L, D, R order', () => {
    // From (2,2) to (3,3) the two shortest first steps are D (to (2,3)) and R (to (3,2)); D comes first.
    expect(bfsNextStep(m, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(3);
    // To (1,1) from (2,2): U (to (2,1)) and L (to (1,2)) tie; U wins.
    expect(bfsNextStep(m, { x: 2, y: 2 }, { x: 1, y: 1 })).toBe(1);
  });

  it('bfsNearest finds the nearest matching tile excluding the start, 0 if none', () => {
    expect(bfsNearest(m, { x: 3, y: 2 }, (x, y) => x === 3 && y === 2)).toBe(0);
    expect(bfsNearest(m, { x: 3, y: 2 }, (x, y) => x === 5 && y === 2)).toBe(2);
    expect(bfsNearest(m, { x: 3, y: 2 }, () => false)).toBe(0);
  });
});

describe('shipped levels', () => {
  it('has three named 40x28 halls', () => {
    expect(LEVELS.map((l) => [l.id, l.name])).toEqual([
      ['HALL-A', 'us-east-3am'],
      ['HALL-B', 'cold aisle'],
      ['HALL-C', 'hot aisle'],
    ]);
    for (const l of LEVELS) {
      expect(l.ascii).toHaveLength(28);
      for (const row of l.ascii) expect(row).toHaveLength(40);
    }
  });

  it('every hall passes validateMaze and has X reachable from P', () => {
    for (const l of LEVELS) {
      const m = parsed(l.ascii);
      expect(validateMaze(m)).toEqual([]);
      expect(reachableFrom(m, m.spawn)[m.exit.y * m.w + m.exit.x]).toBe(1);
    }
  });

  it('level L uses LEVELS[(L-1) mod 3]', () => {
    expect(levelFor(1).id).toBe('HALL-A');
    expect(levelFor(2).id).toBe('HALL-B');
    expect(levelFor(3).id).toBe('HALL-C');
    expect(levelFor(4).id).toBe('HALL-A');
    expect(levelFor(8).id).toBe('HALL-B');
  });

  it('pen homes and pads are row-major', () => {
    const m = parsed(LEVELS[0]!.ascii);
    const rowMajor = (a: { x: number; y: number }, b: { x: number; y: number }): number => a.y - b.y || a.x - b.x;
    expect([...m.pen].sort(rowMajor)).toEqual(m.pen);
    expect([...m.pads].sort(rowMajor)).toEqual(m.pads);
    expect(m.pads).toHaveLength(4);
  });
});
