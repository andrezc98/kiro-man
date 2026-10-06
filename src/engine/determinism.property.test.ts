import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { logFromDeltas } from '../test-support/engine';
import { MAX_TICKS } from './constants';
import { cloneState, createGame, step } from './game';
import type { InputLog } from './input';
import type { Dir, GameState } from './types';

/** The pinned replay loop (overview §5.9), optionally stopping early at `stopAt`. */
function run(s: GameState, log: InputLog, from: { i: number; held: Dir }, stopAt = MAX_TICKS): { i: number; held: Dir } {
  let { i, held } = from;
  while (s.phase !== 'gameOver' && s.tick < stopAt) {
    while (i < log.length && (log[i] as [number, Dir])[0] === s.tick) {
      held = (log[i] as [number, Dir])[1];
      i++;
    }
    step(s, held);
  }
  return { i, held };
}

const p4Input = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  deltas: fc.array(fc.tuple(fc.integer({ min: 1, max: 90 }), fc.integer({ min: 0, max: 4 }))),
  cut: fc.integer({ min: 0, max: 4000 }),
});

describe('P4: determinism', () => {
  it('two independent runs and a mid-run cloneState continuation give identical final states', () => {
    fc.assert(
      fc.property(p4Input, ({ seed, deltas, cut }) => {
        const log = logFromDeltas(deltas);
        const a = createGame(seed);
        run(a, log, { i: 0, held: 0 });
        const b = createGame(seed);
        run(b, log, { i: 0, held: 0 });
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(b.score).toBe(a.score);

        const c = createGame(seed);
        const cursor = run(c, log, { i: 0, held: 0 }, cut);
        const d = cloneState(c);
        run(c, log, cursor);
        run(d, log, cursor);
        expect(JSON.stringify(d)).toBe(JSON.stringify(a));
        expect(JSON.stringify(c)).toBe(JSON.stringify(a));
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
