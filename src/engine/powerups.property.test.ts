import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { startPlaying } from '../test-support/engine';
import { CATALOG_ORDER, PICKUP_TTL } from './constants';
import { step } from './game';
import { occupiedTile } from './movement';
import { durationOf, isActive } from './powerups';
import { P5_MAZE } from './test-fixtures';
import type { GameState, PowerKind } from './types';

function placePickupUnderPlayer(s: GameState, kind: PowerKind): void {
  s.pickup = { kind, at: occupiedTile(s.player), ttl: PICKUP_TTL };
}

const p5Input = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    kind: fc.constantFrom(...CATALOG_ORDER),
  })
  .chain(({ seed, kind }) =>
    fc.record({
      seed: fc.constant(seed),
      kind: fc.constant(kind),
      // Re-pick offset R - T in [1, d + 60], or none.
      repick: fc.option(fc.integer({ min: 1, max: durationOf(kind) + 60 }), { nil: null }),
    }),
  );

describe('P5: power-up timers', () => {
  it('isActive after step s is true iff s ∈ [T, T+d-1] ∪ [R, R+d-1], and timers are never negative', () => {
    fc.assert(
      fc.property(p5Input, ({ seed, kind, repick }) => {
        const s = startPlaying(seed, { maze: P5_MAZE });
        const d = durationOf(kind);
        const T = s.tick;
        const R = repick === null ? null : T + repick;
        const last = Math.max(T, R ?? T) + d + 60;
        const inWindow = (t: number): boolean => (t >= T && t <= T + d - 1) || (R !== null && t >= R && t <= R + d - 1);
        while (s.tick <= last) {
          const t = s.tick;
          if (t === T || t === R) placePickupUnderPlayer(s, kind);
          step(s, 0);
          expect(s.phase).toBe('playing');
          for (const k of CATALOG_ORDER) expect(s.active[k] ?? 0).toBeGreaterThanOrEqual(0);
          expect(isActive(s, kind)).toBe(inWindow(t));
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
