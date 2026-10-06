import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../test-support/pbt';
import { initialCabinet, reduce } from './cabinet';
import type { CabinetEvent, CabinetState, Effect, GameSummary } from './cabinet';
import { MAX_CREDITS } from './credits';

type Action = { kind: 'coin' } | { kind: 'start'; seed: number } | { kind: 'roundTrip' };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.constant({ kind: 'coin' } as const),
  fc.integer({ min: 0, max: 0xffffffff }).map((seed) => ({ kind: 'start', seed }) as const),
  fc.constant({ kind: 'roundTrip' } as const),
);

/** Score 0 means no remote submission on the way back. */
const ZERO_SUMMARY: GameSummary = {
  seed: 1,
  score: 0,
  level: 1,
  bugsEaten: 0,
  servicesUsed: { lambda: 0, shield: 0, autoscaling: 0, cloudfront: 0, cloudwatch: 0 },
  lastKiller: 'latency',
  gameOverReason: 'caught',
  inputLog: [],
  tainted: false,
};

/** gameOver, 60 x uiTick, confirm (incident → highscores), confirm (highscores → attract). */
const ROUND_TRIP: CabinetEvent[] = [
  { type: 'gameOver', summary: ZERO_SUMMARY, qualifies: false },
  ...Array.from({ length: 60 }, () => ({ type: 'uiTick' }) as const),
  { type: 'confirm' },
  { type: 'confirm' },
];

function apply(s: CabinetState, events: CabinetEvent[]): { state: CabinetState; effects: Effect[] } {
  let state = s;
  const effects: Effect[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

describe('P1b: credits through the cabinet reducer', () => {
  it('credits in [0,99]; start succeeds iff attract and credits >= 1; coin +1 capped on any screen', () => {
    let startsSeen = 0;
    let roundTrips = 0;
    fc.assert(
      fc.property(fc.boolean(), fc.array(actionArb, { maxLength: 250 }), (online, actions) => {
        let s = initialCabinet(online);
        for (const a of actions) {
          const before = s;
          if (a.kind === 'coin') {
            const r = reduce(before, { type: 'coin' });
            expect(r.state.credits).toBe(Math.min(before.credits + 1, MAX_CREDITS));
            expect(r.state.screen).toBe(before.screen);
            expect(r.effects.filter((e) => e.type === 'startEngine')).toEqual([]);
            s = r.state;
          } else if (a.kind === 'start') {
            const r = reduce(before, { type: 'start', seed: a.seed });
            const starts = r.effects.filter((e) => e.type === 'startEngine');
            const shouldStart = before.screen === 'attract' && before.credits >= 1;
            if (shouldStart) {
              startsSeen++;
              expect(r.state.credits).toBe(before.credits - 1);
              expect(starts).toEqual([{ type: 'startEngine', seed: a.seed }]);
              expect(r.state.screen).toBe('playing');
            } else {
              expect(r.state.credits).toBe(before.credits);
              expect(r.state.screen).toBe(before.screen);
              expect(starts).toEqual([]);
            }
            s = r.state;
          } else {
            // Generated only when playing; skipped on any other screen.
            if (before.screen !== 'playing') continue;
            roundTrips++;
            const r = apply(before, ROUND_TRIP);
            expect(r.state.screen).toBe('attract');
            expect(r.state.credits).toBe(before.credits);
            expect(r.effects.filter((e) => e.type === 'submitRemote' || e.type === 'startEngine')).toEqual([]);
            s = r.state;
          }
          expect(Number.isInteger(s.credits)).toBe(true);
          expect(s.credits).toBeGreaterThanOrEqual(0);
          expect(s.credits).toBeLessThanOrEqual(MAX_CREDITS);
        }
      }),
      { numRuns: PBT_RUNS },
    );
    // The generator must actually exercise successful starts and round trips back to attract.
    expect(startsSeen).toBeGreaterThan(0);
    expect(roundTrips).toBeGreaterThan(0);
  });
});
