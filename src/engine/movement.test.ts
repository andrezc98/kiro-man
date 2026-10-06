import { describe, expect, it } from 'vitest';
import { fixedPos, rawMaze, startPlaying, stepN } from '../test-support/engine';
import { step } from './game';
import { advanceMover, occupiedTile, playerDecide, reverseMidTile } from './movement';
import { WALLED_OFF_MAZE } from './test-fixtures';
import type { Dir, Mover } from './types';

//  0123456
// 0#######
// 1#.....#
// 2#.###.#
// 3#.....#
// 4#######
const LOOP = rawMaze(['#######', '#.....#', '#.###.#', '#.....#', '#######']);

function mover(x: number, y: number, dir: Dir = 0, progress = 0): Mover {
  return { tile: { x, y }, dir, progress };
}

function run(m: Mover, n: number, speed: number, desired: Dir): void {
  for (let i = 0; i < n; i++) advanceMover(LOOP, m, speed, playerDecide(LOOP, desired));
}

describe('advanceMover', () => {
  it('moves in fixed-point units and changes tile every 256 units', () => {
    const m = mover(1, 1);
    run(m, 7, 32, 2);
    expect(m).toEqual(mover(1, 1, 2, 224));
    run(m, 1, 32, 2);
    expect(m).toEqual(mover(2, 1, 2, 0));
  });

  it('a player holding into a wall stops at the center (progress 0, dir 0)', () => {
    const m = mover(4, 1);
    run(m, 8, 32, 2);
    expect(m.tile).toEqual({ x: 5, y: 1 });
    run(m, 1, 32, 2);
    expect(m).toEqual(mover(5, 1, 0, 0));
    run(m, 5, 32, 2);
    expect(m).toEqual(mover(5, 1, 0, 0));
  });

  it('never starts toward an impassable tile', () => {
    const m = mover(1, 1);
    run(m, 3, 32, 1);
    expect(m).toEqual(mover(1, 1, 0, 0));
  });

  it('carries leftover progress when the next direction is passable', () => {
    const m = mover(2, 1, 2, 0);
    run(m, 6, 48, 2);
    // 6 × 48 = 288 → one tile plus 32 leftover toward (4,1).
    expect(m).toEqual(mover(3, 1, 2, 32));
  });

  it('drops leftover progress when the next direction is blocked', () => {
    const m = mover(3, 1, 2, 0);
    run(m, 6, 48, 2);
    expect(m).toEqual(mover(4, 1, 2, 32));
    // 32 + 5 × 48 = 272 → arrives at (5,1) with 16 leftover, but (6,1) is a wall.
    run(m, 5, 48, 2);
    expect(m).toEqual(mover(5, 1, 0, 0));
  });

  it('buffers a turn until a center where it is passable', () => {
    const m = mover(2, 3, 2, 0);
    for (let i = 0; i < 8 * 3; i++) advanceMover(LOOP, m, 32, playerDecide(LOOP, 1));
    expect(m.tile).toEqual({ x: 5, y: 3 });
    advanceMover(LOOP, m, 32, playerDecide(LOOP, 1));
    expect(m).toEqual(mover(5, 3, 1, 32));
  });

  it('turns using leftover progress at a center', () => {
    const m = mover(4, 3, 2, 240);
    advanceMover(LOOP, m, 48, playerDecide(LOOP, 1));
    expect(m).toEqual(mover(5, 3, 1, 32));
  });

  it('speed 0 never moves (Cold Start frozen)', () => {
    const m = mover(1, 1, 2, 100);
    expect(advanceMover(LOOP, m, 0, () => 3)).toBe(false);
    expect(m).toEqual(mover(1, 1, 2, 100));
  });

  it('reports whether the tile changed', () => {
    const m = mover(1, 1, 2, 224);
    expect(advanceMover(LOOP, m, 16, () => 2)).toBe(false);
    expect(advanceMover(LOOP, m, 16, () => 2)).toBe(true);
  });
});

describe('mid-tile reversal', () => {
  it.each([1, 255, 128])('at progress %i keeps the on-screen position', (progress) => {
    const m = mover(1, 1, 2, progress);
    const before = fixedPos(m);
    expect(reverseMidTile(m)).toBe(true);
    expect(m).toEqual(mover(2, 1, 4, 256 - progress));
    expect(fixedPos(m)).toEqual(before);
  });

  it('is not applied at a center', () => {
    const m = mover(1, 1, 2, 0);
    expect(reverseMidTile(m)).toBe(false);
    expect(m).toEqual(mover(1, 1, 2, 0));
  });

  it('in the game, a reverse press mid-tile flips direction right away, before advancing', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    step(s, 2); // from P (3,2) start right
    step(s, 2);
    expect(s.player).toMatchObject({ tile: { x: 3, y: 2 }, dir: 2, progress: 64 });
    step(s, 4);
    // Reversed to tile (4,2) dir left with progress 256-64 = 192, then advanced 32 → 224.
    expect(s.player).toMatchObject({ tile: { x: 4, y: 2 }, dir: 4, progress: 224 });
  });
});

describe('occupiedTile', () => {
  it('is the tile below 128 progress and the destination from 128 on', () => {
    expect(occupiedTile(mover(1, 1, 2, 127))).toEqual({ x: 1, y: 1 });
    expect(occupiedTile(mover(1, 1, 2, 128))).toEqual({ x: 2, y: 1 });
    expect(occupiedTile(mover(1, 1, 0, 0))).toEqual({ x: 1, y: 1 });
  });
});

describe('player input rule', () => {
  it('releasing all keys (dir 0) keeps the player moving until a wall', () => {
    const s = startPlaying(3, { maze: WALLED_OFF_MAZE });
    step(s, 2);
    stepN(s, 60, 0);
    // From (3,2) the row runs right to (8,2); (9,2) is a wall.
    expect(s.player.tile).toEqual({ x: 8, y: 2 });
    expect(s.player.dir).toBe(0);
    expect(s.player.progress).toBe(0);
    expect(s.player.desired).toBe(2);
  });

  it('facing remembers the last non-zero direction moved', () => {
    const s = startPlaying(3, { maze: WALLED_OFF_MAZE });
    step(s, 2);
    stepN(s, 60, 0);
    expect(s.player.dir).toBe(0);
    expect(s.player.facing).toBe(2);
  });
});
