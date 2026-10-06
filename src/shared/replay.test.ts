import { describe, expect, it } from 'vitest';
import { MAX_TICKS } from '../engine/constants';
import type { InputLog } from '../engine/input';
import { WALLED_OFF_MAZE } from '../engine/test-fixtures';
import { heldAt, recordGame } from '../test-support/engine';
import { replay, validateReplay } from './replay';

/** A fixed, hand-written route through HALL-A used by the golden regression test. */
const GOLDEN_SEED = 0x4b49524f;
const GOLDEN_LOG: InputLog = [
  [120, 4],
  [200, 3],
  [260, 2],
  [330, 1],
  [400, 4],
  [470, 3],
  [560, 2],
  [640, 1],
  [700, 0],
  [760, 2],
  [900, 3],
  [1000, 4],
];
/** Stored when the engine was first completed; any change here means the simulation changed. */
const GOLDEN = { score: 400, level: 1, ticks: 2080 };

describe('replay', () => {
  it('golden regression: a fixed seed and log replay to the stored score', () => {
    const r = replay(GOLDEN_SEED, GOLDEN_LOG);
    expect(r.status).toBe('complete');
    expect({ score: r.score, level: r.level, ticks: r.ticks }).toEqual(GOLDEN);
  });

  it('an empty log replays to completion on the shipped level (Latency catches a stationary player)', () => {
    const r = replay(1, []);
    expect(r.status).toBe('complete');
    expect(r.finalState.gameOverReason).toBe('caught');
    expect(r.ticks).toBeLessThan(MAX_TICKS);
  });

  it('matches the client recorder loop tick for tick', () => {
    const rec = recordGame(99, (t) => ((Math.floor(t / 37) % 5) as 0 | 1 | 2 | 3 | 4));
    const r = replay(99, rec.log);
    expect(JSON.stringify(r.finalState)).toBe(JSON.stringify(rec.state));
  });

  it('log events whose tick is >= the final tick have no effect', () => {
    const base = replay(5, [[130, 2]]);
    const extra = replay(5, [
      [130, 2],
      [base.ticks, 3],
      [base.ticks + 50, 1],
    ]);
    expect(JSON.stringify(extra.finalState)).toBe(JSON.stringify(base.finalState));
  });

  it('times out at maxTicks', () => {
    const r = replay(3, [], { maxTicks: 100 });
    expect(r).toMatchObject({ status: 'timeout', ticks: 100, score: 0, level: 1 });
  });

  it('honors startLives', () => {
    const one = replay(1, [], { startLives: 1 });
    expect(one.status).toBe('complete');
    expect(one.finalState.config.startLives).toBe(1);
    expect(one.ticks).toBeLessThan(replay(1, []).ticks);
  });

  it('time limit: a walled-off player ends the game with reason timeLimit after exactly MAX_TICKS steps', () => {
    const r = replay(8, [], { maze: WALLED_OFF_MAZE });
    expect(r.status).toBe('complete');
    expect(r.ticks).toBe(MAX_TICKS);
    expect(r.finalState.gameOverReason).toBe('timeLimit');
    expect(r.finalState.lastKiller).toBeNull();
  });

  it('an input event recorded at tick 107999 is applied in the final step and replays deep-equal', () => {
    const dir = 2; // (4,2) right of P is floor
    const rec = recordGame(8, (t) => (t === MAX_TICKS - 1 ? dir : 0), { maze: WALLED_OFF_MAZE });
    expect(rec.log).toEqual([[MAX_TICKS - 1, dir]]);
    expect(rec.state.player.desired).toBe(dir);
    expect(rec.state.player.progress).toBeGreaterThan(0);
    expect(rec.state.gameOverReason).toBe('timeLimit');

    const r = replay(8, rec.log, { maze: WALLED_OFF_MAZE });
    expect(r.status).toBe('complete');
    expect(JSON.stringify(r.finalState)).toBe(JSON.stringify(rec.state));
    expect(r.score).toBe(rec.state.score);
    expect(
      validateReplay({ seed: 8, inputLog: rec.log, claimedScore: rec.state.score }, { maze: WALLED_OFF_MAZE }),
    ).toEqual({ ok: true, score: rec.state.score, level: 1 });

    const dropped = replay(8, [], { maze: WALLED_OFF_MAZE });
    expect(JSON.stringify(dropped.finalState)).not.toBe(JSON.stringify(rec.state));
  });

  it('the heldAt helper agrees with the replay rule', () => {
    const log: InputLog = [
      [5, 2],
      [9, 0],
    ];
    expect([4, 5, 8, 9, 100].map((t) => heldAt(log, t))).toEqual([0, 2, 2, 0, 0]);
  });
});

describe('validateReplay', () => {
  const rec = recordGame(21, (t) => ((Math.floor(t / 53) % 4) + 1) as 1 | 2 | 3 | 4, { startLives: 1 });

  it('accepts the recorded score', () => {
    expect(validateReplay({ seed: 21, inputLog: rec.log, claimedScore: rec.state.score }, { startLives: 1 })).toEqual({
      ok: true,
      score: rec.state.score,
      level: rec.state.level,
    });
  });

  it('rejects any other claim as replay_mismatch with the replayed score', () => {
    expect(
      validateReplay({ seed: 21, inputLog: rec.log, claimedScore: rec.state.score + 10 }, { startLives: 1 }),
    ).toEqual({ ok: false, reason: 'replay_mismatch', replayedScore: rec.state.score });
  });

  it('replay_incomplete takes precedence over replay_mismatch', () => {
    expect(validateReplay({ seed: 21, inputLog: rec.log, claimedScore: 999 }, { startLives: 1, maxTicks: 50 })).toEqual(
      { ok: false, reason: 'replay_incomplete', replayedScore: 0 },
    );
  });
});
