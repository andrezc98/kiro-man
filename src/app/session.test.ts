import { describe, expect, it } from 'vitest';
import { createGame, forceGameOver, step } from '../engine';
import { WALLED_OFF_MAZE } from '../engine/test-fixtures';
import { recordGame } from '../test-support/engine';
import { checkGameOver, createSession, resetForNewGame, summarize } from './session';

describe('checkGameOver', () => {
  it('fires once after forceGameOver and not again on later frames', () => {
    const s = createGame(11);
    const session = createSession();
    for (let i = 0; i < 200; i++) {
      step(s, 0);
      expect(checkGameOver(s, session)).toBe(false);
    }
    forceGameOver(s);
    expect(checkGameOver(s, session)).toBe(true);
    expect(session.gameOverSent).toBe(true);
    // The next step clears the gameOver event; detection is phase-based, so nothing fires again.
    for (let i = 0; i < 10; i++) {
      step(s, 0);
      expect(s.events).toEqual([]);
      expect(checkGameOver(s, session)).toBe(false);
    }
  });

  it('fires once for a normal ending', () => {
    const s = createGame(1, { startLives: 1 });
    const session = createSession();
    let fired = 0;
    while (s.tick < 20000) {
      step(s, 0);
      if (checkGameOver(s, session)) fired++;
    }
    expect(s.phase).toBe('gameOver');
    expect(fired).toBe(1);
  });

  it('resets for a new game', () => {
    const session = createSession();
    const first = createGame(2);
    forceGameOver(first);
    expect(checkGameOver(first, session)).toBe(true);
    resetForNewGame(session);
    expect(session.gameOverSent).toBe(false);
    const second = createGame(3);
    step(second, 0);
    expect(checkGameOver(second, session)).toBe(false);
    forceGameOver(second);
    expect(checkGameOver(second, session)).toBe(true);
    expect(checkGameOver(second, session)).toBe(false);
  });
});

describe('summarize', () => {
  it('builds the cabinet summary from a finished game', () => {
    const rec = recordGame(5, (t) => (t < 400 ? 2 : 3), { startLives: 1 });
    const sum = summarize(rec.state, rec.log, false);
    expect(sum).toEqual({
      seed: 5,
      score: rec.state.score,
      level: rec.state.level,
      bugsEaten: rec.state.stats.bugsEaten,
      servicesUsed: rec.state.stats.servicesUsed,
      lastKiller: rec.state.lastKiller,
      gameOverReason: 'caught',
      inputLog: rec.log,
      tainted: false,
    });
    expect(sum.inputLog).not.toBe(rec.log);
    expect(sum.servicesUsed).not.toBe(rec.state.stats.servicesUsed);
  });

  it('carries the QA and time-limit reasons', () => {
    const qa = createGame(4);
    forceGameOver(qa);
    expect(summarize(qa, [], true)).toMatchObject({ gameOverReason: 'qa', lastKiller: null, tainted: true });
    const timed = recordGame(8, () => 0, { maze: WALLED_OFF_MAZE });
    expect(summarize(timed.state, timed.log, false)).toMatchObject({ gameOverReason: 'timeLimit', lastKiller: null });
  });
});
