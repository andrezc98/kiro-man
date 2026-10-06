/**
 * Shared test mazes (imported only by tests; validated by test-fixtures.test.ts).
 * Every fixture passes `validateMaze`: its bugs, `U` and `W` tiles lie in `P`'s region.
 */
import { LEVELS } from './levels';

/**
 * P5 fixture: `X` and the pen are sealed off by `#` from `P`'s region, so released enemies can never reach
 * the player. 116 bugs are reachable from `P` (a clone eats at most 84 within the P5 sampling interval).
 */
export const P5_MAZE: readonly string[] = [
  '########################',
  '#W..................W#X#',
  '#.##.###.####.###.##.#=#',
  '#..........U.........#E#',
  '#.##.###.####.###.##.#E#',
  '#.........P..........#E#',
  '#.##.###.####.###.##.#E#',
  '#U..................U###',
  '#.##.###.####.###.##.###',
  '#W..................W###',
  '########################',
];

/** Walled-off time-limit maze: a small player room; the enemies are released into a sealed pocket at `X`. */
export const WALLED_OFF_MAZE: readonly string[] = [
  '############',
  '#W..U..W##X#',
  '#..P.....#=#',
  '#U......W#E#',
  '#.......W#E#',
  '#..U....##E#',
  '#........#E#',
  '############',
];

/**
 * Warp maze: pads 0..3 (row-major) at (3,1), (8,1), (3,5), (8,5); `P` at (1,6). Enemies are sealed at `X`.
 * Walking right along row 5 from (1,5) crosses pad 2 and warps to pad 3.
 */
export const WARP_MAZE: readonly string[] = [
  '##############',
  '#..W....W..#X#',
  '#.##.##.##.#=#',
  '#U.........#E#',
  '#.##.##.##.#E#',
  '#..W....W.U#E#',
  '#P........U#E#',
  '##############',
];

/**
 * Full-size perf maze derived from HALL-A: the rack band at rows 17-18 is sealed, the upper hall (with `X`
 * and the pen) is bug-free floor, and the player owns the lower hall. Enemies roam 40x28 forever and every
 * pursuit BFS explores their whole region, a worst case for a 108000-tick replay.
 */
export const PERF_MAZE: readonly string[] = (() => {
  const base = (LEVELS[0] as { ascii: readonly string[] }).ascii;
  const rows = base.map((r) => r.split(''));
  for (let y = 0; y <= 16; y++) {
    const row = rows[y] as string[];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.' || row[x] === 'U' || row[x] === 'W') row[x] = ' ';
    }
  }
  for (const y of [17, 18]) rows[y] = new Array<string>(40).fill('#');
  const put = (x: number, y: number, ch: string): void => {
    (rows[y] as string[])[x] = ch;
  };
  put(1, 19, 'W');
  put(38, 19, 'W');
  put(19, 25, 'U');
  return rows.map((r) => r.join(''));
})();
