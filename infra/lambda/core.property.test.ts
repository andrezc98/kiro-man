import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_RUNS } from '../../src/test-support/pbt';
import { heldAt, logFromDeltas, recordGame } from '../../src/test-support/engine';
import { DEFAULT_MAX_BODY_BYTES, handle } from './core';
import type { CoreDeps, ScoreStore, StoredScore } from './core';

function deps(puts: StoredScore[]): CoreDeps {
  const store: ScoreStore = {
    async put(e) {
      puts.push(e);
    },
    async top() {
      return [];
    },
  };
  return {
    store,
    now: () => '2025-01-01T00:00:00.000Z',
    uuid: () => 'id',
    log: () => {},
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  };
}

const caseArb = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  deltas: fc.array(fc.tuple(fc.integer({ min: 1, max: 90 }), fc.integer({ min: 0, max: 4 })), { maxLength: 20 }),
  offset: fc.oneof(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: -5000, max: -1 })),
});

describe('P7 (core): core.handle replays default-config recordings', () => {
  // Default config (3 lives, no maxTicks cap), exactly what the deployed handler replays. Bounded: every
  // shipped level has X reachable from P (P2b), so Latency catches a player whose inputs stop, and the
  // engine time limit caps every game.
  it('honest claim → 201 and one put; any other claim → 422 replay_mismatch and no put', { timeout: 120000 }, async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ seed, deltas, offset }) => {
        const schedule = logFromDeltas(deltas);
        const rec = recordGame(seed, (t) => heldAt(schedule, t));
        expect(rec.state.phase).toBe('gameOver');
        const score = rec.state.score;
        const submit = (claimedScore: number) =>
          JSON.stringify({ initials: 'KIR', seed, inputLog: rec.log, claimedScore });

        const honestPuts: StoredScore[] = [];
        const ok = await handle({ method: 'POST', path: '/scores', body: submit(score), isBase64Encoded: false }, deps(honestPuts));
        expect(ok.statusCode).toBe(201);
        expect(JSON.parse(ok.body)).toEqual({ accepted: true, score, level: rec.state.level });
        expect(honestPuts).toHaveLength(1);
        expect(honestPuts[0]).toMatchObject({ initials: 'KIR', score, level: rec.state.level });

        const other = Math.abs(score + offset);
        if (other !== score) {
          const dishonestPuts: StoredScore[] = [];
          const bad = await handle(
            { method: 'POST', path: '/scores', body: submit(other), isBase64Encoded: false },
            deps(dishonestPuts),
          );
          expect(bad.statusCode).toBe(422);
          expect(JSON.parse(bad.body)).toEqual({ error: 'replay_mismatch' });
          expect(dishonestPuts).toHaveLength(0);
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });
});
