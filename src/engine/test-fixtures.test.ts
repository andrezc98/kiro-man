import { describe, expect, it } from 'vitest';
import { parseMaze, reachableFrom, validateMaze } from './maze';
import { P5_MAZE, PERF_MAZE, WALLED_OFF_MAZE, WARP_MAZE } from './test-fixtures';
import { Tile } from './types';
import type { Maze } from './types';

function load(ascii: readonly string[]): Maze {
  const r = parseMaze(ascii);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const FIXTURES = { P5_MAZE, WALLED_OFF_MAZE, WARP_MAZE, PERF_MAZE };

describe('test fixtures', () => {
  it.each(Object.entries(FIXTURES))('%s passes validateMaze', (_name, ascii) => {
    expect(validateMaze(load(ascii))).toEqual([]);
  });

  it.each(Object.entries(FIXTURES))('%s seals X and the pen off from P', (_name, ascii) => {
    const m = load(ascii);
    const seen = reachableFrom(m, m.spawn);
    expect(seen[m.exit.y * m.w + m.exit.x]).toBe(0);
    for (const p of m.pen) expect(seen[p.y * m.w + p.x]).toBe(0);
  });

  it('P5_MAZE has at least 100 bugs reachable from P (more than a clone can eat during P5 sampling)', () => {
    const m = load(P5_MAZE);
    const seen = reachableFrom(m, m.spawn);
    const reachableBugs = m.cells.filter((c, i) => c === Tile.Bug && seen[i] === 1).length;
    expect(reachableBugs).toBeGreaterThanOrEqual(100);
    expect(reachableBugs).toBeGreaterThan(84);
  });

  it('WARP_MAZE pads are at the documented positions', () => {
    expect(load(WARP_MAZE).pads).toEqual([
      { x: 3, y: 1 },
      { x: 8, y: 1 },
      { x: 3, y: 5 },
      { x: 8, y: 5 },
    ]);
  });

  it('PERF_MAZE is full size', () => {
    const m = load(PERF_MAZE);
    expect([m.w, m.h]).toEqual([40, 28]);
  });
});
