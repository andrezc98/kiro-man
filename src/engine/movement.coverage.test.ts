/**
 * Deterministic companion to P3: one pinned seed + log + grants case on HALL-A that has a clone, a warp,
 * and Lambda speed, while the wall invariant holds after every step.
 */
import { describe, expect, it } from 'vitest';
import { heldAt } from '../test-support/engine';
import { createGame, step } from './game';
import type { InputLog } from './input';
import { addDir } from './movement';
import { isPassable } from './maze';
import { applyPowerUp, isActive } from './powerups';
import type { GameState, Mover, PowerKind } from './types';

const SEED = 0x4b49524f;
// From P (19,19): left along row 19 to (1,19), then down the side aisle onto pad 2 at (1,25).
const LOG: InputLog = [
  [120, 4],
  [230, 3],
];
const GRANTS: Array<[number, PowerKind]> = [
  [120, 'lambda'],
  [120, 'autoscaling'],
  [120, 'cloudfront'],
];

function onPassable(s: GameState, m: Mover): boolean {
  if (!isPassable(s.maze, m.tile.x, m.tile.y)) return false;
  if (m.progress === 0) return true;
  const next = addDir(m.tile, m.dir);
  return m.dir !== 0 && isPassable(s.maze, next.x, next.y);
}

describe('P3 coverage companion', () => {
  it('hits the clone, a warp and Lambda speed with the wall invariant intact', () => {
    const s = createGame(SEED);
    let cloneSteps = 0;
    let lambdaSteps = 0;
    const warps: Array<{ from: number; to: number }> = [];
    while (s.phase !== 'gameOver' && s.tick < 600) {
      if (s.phase === 'playing') for (const [t, k] of GRANTS) if (t === s.tick) applyPowerUp(s, k);
      step(s, heldAt(LOG, s.tick));
      expect(onPassable(s, s.player)).toBe(true);
      for (const e of s.enemies) expect(onPassable(s, e)).toBe(true);
      if (s.clone !== null) {
        cloneSteps += 1;
        expect(onPassable(s, s.clone)).toBe(true);
      }
      if (isActive(s, 'lambda')) lambdaSteps += 1;
      for (const e of s.events) if (e.type === 'warp') warps.push({ from: e.from, to: e.to });
    }
    expect(cloneSteps).toBeGreaterThan(0);
    expect(lambdaSteps).toBeGreaterThan(0);
    expect(warps[0]).toEqual({ from: 2, to: 3 });
  });
});
