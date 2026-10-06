import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { LEVELS } from './levels';
import { bfsNextStep, parseMaze, reachableFrom, validateMaze } from './maze';
import { Tile } from './types';
import type { Maze } from './types';

/** Independent flood fill over the raw ASCII (only `#` blocks; random grids never contain `=`). */
function oracleUnreachableBugs(rows: string[]): Set<string> {
  const h = rows.length;
  const w = (rows[0] as string).length;
  let start: [number, number] | null = null;
  rows.forEach((r, y) => {
    const x = r.indexOf('P');
    if (x >= 0 && start === null) start = [x, y];
  });
  const seen = new Set<string>();
  const stack: Array<[number, number]> = start === null ? [] : [start];
  if (start !== null) seen.add(`${(start as [number, number])[0]},${(start as [number, number])[1]}`);
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as Array<[number, number]>) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if ((rows[ny] as string)[nx] === '#') continue;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  const out = new Set<string>();
  rows.forEach((r, y) => {
    for (let x = 0; x < w; x++) if (r[x] === '.' && !seen.has(`${x},${y}`)) out.add(`${x},${y}`);
  });
  return out;
}

const randomGrid = fc
  .record({ w: fc.integer({ min: 5, max: 20 }), h: fc.integer({ min: 5, max: 20 }) })
  .chain(({ w, h }) =>
    fc.record({
      cells: fc.array(fc.constantFrom('#', '.', ' ', '#', '.'), { minLength: w * h, maxLength: w * h }),
      spawn: fc.integer({ min: 0, max: w * h - 1 }),
      w: fc.constant(w),
      h: fc.constant(h),
    }),
  )
  .map(({ cells, spawn, w, h }) => {
    const c: string[] = [...cells];
    c[spawn] = 'P';
    const rows: string[] = [];
    for (let y = 0; y < h; y++) rows.push(c.slice(y * w, (y + 1) * w).join(''));
    return rows;
  });

function load(ascii: readonly string[]): Maze {
  const r = parseMaze(ascii);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('maze properties', () => {
  it('P2a: unreachable_bug errors equal the bugs an independent flood fill does not reach from P', () => {
    fc.assert(
      fc.property(randomGrid, (rows) => {
        const maze = load(rows);
        const reported = new Set(
          validateMaze(maze)
            .filter((e) => e.kind === 'unreachable_bug')
            .map((e) => (e.kind === 'unreachable_bug' ? `${e.x},${e.y}` : '')),
        );
        expect([...reported].sort()).toEqual([...oracleUnreachableBugs(rows)].sort());
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it('P2b: every shipped level is valid, every bug is BFS-reachable from P, and X is reachable', () => {
    const mazes = LEVELS.map((l) => load(l.ascii));
    for (const m of mazes) {
      expect(validateMaze(m)).toEqual([]);
      expect(reachableFrom(m, m.spawn)[m.exit.y * m.w + m.exit.x]).toBe(1);
    }
    const bugsPer = mazes.map((m) => m.cells.flatMap((c, i) => (c === Tile.Bug ? [i] : [])));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: mazes.length - 1 }), fc.nat(), (levelIdx, bugPick) => {
        const m = mazes[levelIdx] as Maze;
        const bugs = bugsPer[levelIdx] as number[];
        const idx = bugs[bugPick % bugs.length] as number;
        const target = { x: idx % m.w, y: Math.floor(idx / m.w) };
        expect(bfsNextStep(m, m.spawn, target)).not.toBe(0);
        expect(bfsNextStep(m, m.spawn, m.exit)).not.toBe(0);
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
