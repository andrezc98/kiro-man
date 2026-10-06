import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { P5_MAZE } from '../engine/test-fixtures';
import { PBT_RUNS } from '../test-support/pbt';
import { heldAt, logFromDeltas, recordGame } from '../test-support/engine';
import { validateReplay } from './replay';
import type { ReplayOpts } from './replay';

const OPTS = { startLives: 1, maxTicks: 6000 } satisfies ReplayOpts;

const caseArb = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  deltas: fc.array(fc.tuple(fc.integer({ min: 1, max: 90 }), fc.integer({ min: 0, max: 4 })), { maxLength: 120 }),
  // Offset from the recorded score for the dishonest claim (never 0).
  offset: fc.oneof(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: -5000, max: -1 })),
});

describe('P7 (pure): validateReplay against the client recorder loop', () => {
  it(
    'accepts exactly the recorded score of a finished game; rejects every claim of an unfinished one',
    { timeout: 120000 },
    () => {
      fc.assert(
        fc.property(caseArb, ({ seed, deltas, offset }) => {
          const schedule = logFromDeltas(deltas);
          const rec = recordGame(seed, (t) => heldAt(schedule, t), OPTS);
          const score = rec.state.score;
          const other = Math.abs(score + offset);
          const claims = other === score ? [score] : [score, other];
          if (rec.state.phase === 'gameOver') {
            expect(validateReplay({ seed, inputLog: rec.log, claimedScore: score }, OPTS)).toEqual({
              ok: true,
              score,
              level: rec.state.level,
            });
            if (other !== score) {
              expect(validateReplay({ seed, inputLog: rec.log, claimedScore: other }, OPTS)).toEqual({
                ok: false,
                reason: 'replay_mismatch',
                replayedScore: score,
              });
            }
          } else {
            expect(rec.state.tick).toBe(OPTS.maxTicks);
            for (const claimedScore of claims) {
              expect(validateReplay({ seed, inputLog: rec.log, claimedScore }, OPTS)).toMatchObject({
                ok: false,
                reason: 'replay_incomplete',
              });
            }
          }
        }),
        { numRuns: PBT_RUNS },
      );
    },
  );

  // On shipped levels a 1-life game always ends well before 6000 ticks, so the branch above never sees a
  // timeout. The same check on P5_MAZE (enemies sealed away from the player) exercises replay_incomplete.
  it('a recording that hits maxTicks is rejected for every claim (sealed-enemy fixture)', { timeout: 120000 }, () => {
    const opts = { ...OPTS, maze: P5_MAZE } satisfies ReplayOpts;
    fc.assert(
      fc.property(caseArb, ({ seed, deltas, offset }) => {
        const schedule = logFromDeltas(deltas);
        const rec = recordGame(seed, (t) => heldAt(schedule, t), opts);
        expect(rec.state.phase).not.toBe('gameOver');
        expect(rec.state.tick).toBe(opts.maxTicks);
        const score = rec.state.score;
        for (const claimedScore of [score, Math.abs(score + offset)]) {
          expect(validateReplay({ seed, inputLog: rec.log, claimedScore }, opts)).toEqual({
            ok: false,
            reason: 'replay_incomplete',
            replayedScore: score,
          });
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
