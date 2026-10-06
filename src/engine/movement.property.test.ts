import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { heldAt, logFromDeltas } from '../test-support/engine';
import { CATALOG_ORDER } from './constants';
import { createGame, step } from './game';
import type { InputLog } from './input';
import { addDir } from './movement';
import { isPassable } from './maze';
import { applyPowerUp, isActive } from './powerups';
import type { GameState, Mover, PowerKind } from './types';

const MAX_P3_TICKS = 3000;

/** Pinned seed for the coverage run (confirmed to hit the clone, a warp, and Lambda speed). */
export const P3_COVERAGE_SEED = 0x4b49524f;

interface Coverage {
  runsWithClone: number;
  warps: number;
  lambdaSteps: number;
}

const p3Input = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  deltas: fc.array(fc.tuple(fc.integer({ min: 1, max: 90 }), fc.integer({ min: 0, max: 4 }))),
  startLives: fc.integer({ min: 1, max: 3 }),
  grants: fc.array(fc.tuple(fc.integer({ min: 0, max: MAX_P3_TICKS - 1 }), fc.constantFrom(...CATALOG_ORDER)), {
    maxLength: 8,
  }),
});

function onPassable(s: GameState, m: Mover): boolean {
  if (!isPassable(s.maze, m.tile.x, m.tile.y)) return false;
  if (m.progress > 0) {
    const next = addDir(m.tile, m.dir);
    if (m.dir === 0 || !isPassable(s.maze, next.x, next.y)) return false;
  }
  return true;
}

/** Runs one P3 case; asserts the wall invariant after every step and updates `cov`. */
function runP3(
  input: { seed: number; deltas: Array<[number, number]>; startLives: number; grants: Array<[number, PowerKind]> },
  cov: Coverage,
): void {
  const log: InputLog = logFromDeltas(input.deltas, MAX_P3_TICKS - 1);
  const s = createGame(input.seed, { startLives: input.startLives });
  let sawClone = false;
  while (s.phase !== 'gameOver' && s.tick < MAX_P3_TICKS) {
    if (s.phase === 'playing') {
      for (const [tick, kind] of input.grants) if (tick === s.tick) applyPowerUp(s, kind);
    }
    step(s, heldAt(log, s.tick));
    expect(onPassable(s, s.player)).toBe(true);
    if (s.clone !== null) {
      sawClone = true;
      expect(onPassable(s, s.clone)).toBe(true);
    }
    for (const e of s.enemies) expect(onPassable(s, e)).toBe(true);
    if (s.phase === 'playing' && isActive(s, 'lambda')) cov.lambdaSteps += 1;
    cov.warps += s.events.filter((e) => e.type === 'warp').length;
  }
  if (sawClone) cov.runsWithClone += 1;
}

describe('P3: no entity is ever in a wall', () => {
  it('holds for any seed, input log, startLives and power-up grants', () => {
    const cov: Coverage = { runsWithClone: 0, warps: 0, lambdaSteps: 0 };
    fc.assert(
      fc.property(p3Input, (input) => runP3(input, cov)),
      { numRuns: PBT_RUNS },
    );
  });

  it('pinned-seed run set exercises the clone, at least one warp, and Lambda speed', () => {
    const cov: Coverage = { runsWithClone: 0, warps: 0, lambdaSteps: 0 };
    fc.assert(
      fc.property(p3Input, (input) => runP3(input, cov)),
      { numRuns: PBT_RUNS, seed: P3_COVERAGE_SEED },
    );
    console.info(`P3 coverage (seed 0x${P3_COVERAGE_SEED.toString(16)}): ${JSON.stringify(cov)}`);
    expect(cov.runsWithClone).toBeGreaterThanOrEqual(1);
    expect(cov.warps).toBeGreaterThanOrEqual(1);
    expect(cov.lambdaSteps).toBeGreaterThanOrEqual(1);
  });
});
