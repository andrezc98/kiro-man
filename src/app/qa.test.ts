import { describe, expect, it, vi } from 'vitest';
import { createGame, step } from '../engine';
import type { GameState } from '../engine';
import { startPlaying } from '../test-support/engine';
import { createQaApi, parseQaParams } from './qa';
import type { QaHost } from './qa';

describe('parseQaParams', () => {
  it('is off without qa=1', () => {
    expect(parseQaParams('')).toEqual({ enabled: false, seed: null });
    expect(parseQaParams('?qa=0&seed=5')).toEqual({ enabled: false, seed: null });
  });
  it('accepts a uint32 seed only in QA mode', () => {
    expect(parseQaParams('?qa=1&seed=3735928559')).toEqual({ enabled: true, seed: 3735928559 });
    expect(parseQaParams('?qa=1&seed=0')).toEqual({ enabled: true, seed: 0 });
    expect(parseQaParams('?qa=1')).toEqual({ enabled: true, seed: null });
  });
  it('ignores invalid seeds with an info message', () => {
    const info = vi.fn();
    expect(parseQaParams('?qa=1&seed=4294967296', info).seed).toBeNull();
    expect(parseQaParams('?qa=1&seed=-1', info).seed).toBeNull();
    expect(parseQaParams('?qa=1&seed=1e3', info).seed).toBeNull();
    expect(info).toHaveBeenCalledTimes(3);
  });
});

function host(game: GameState | null) {
  const mutated = vi.fn((_g: GameState, _before: number) => undefined);
  const h: QaHost = {
    activeGame: () => game,
    screen: () => 'playing',
    score: () => game?.score ?? 0,
    mutated,
    lastSubmission: () => ({ seed: 1, inputLog: [[0, 2]], claimedScore: 10 }),
  };
  return Object.assign(h, { mutated });
}

describe('QA api', () => {
  it('grants a power-up exactly like a pickup (no score) and reports the new events', () => {
    const g = startPlaying(5);
    step(g, 0);
    const h = host(g);
    const qa = createQaApi(h);
    const before = g.events.length;
    expect(qa.grantPowerUp('cloudwatch')).toBe(true);
    expect(g.active.cloudwatch).toBe(480);
    expect(g.score).toBe(0);
    expect(h.mutated).toHaveBeenCalledWith(g, before);
    expect(() => qa.grantPowerUp('nope' as never)).toThrow(TypeError);
  });

  it('releases pen enemies on the next step and sets invulnerability', () => {
    const g = startPlaying(5);
    const qa = createQaApi(host(g));
    qa.releaseEnemies();
    step(g, 0);
    expect(g.enemies.every((e) => e.mode === 'active')).toBe(true);
    qa.setInvulnerable(600);
    expect(g.player.invuln).toBe(600);
    expect(() => qa.setInvulnerable(-1)).toThrow(TypeError);
  });

  it('forces game over once; mutators do nothing without a running game', () => {
    const g = createGame(9);
    const h = host(g);
    const qa = createQaApi(h);
    expect(qa.forceGameOver()).toBe(true);
    expect(g.phase).toBe('gameOver');
    expect(g.gameOverReason).toBe('qa');
    expect(qa.forceGameOver()).toBe(false);
    expect(createQaApi(host(null)).grantPowerUp('lambda')).toBe(false);
  });

  it('exposes screen, score and a copy of the last submission', () => {
    const qa = createQaApi(host(createGame(1)));
    expect(qa.getScreen()).toBe('playing');
    expect(qa.getScore()).toBe(0);
    const s = qa.getLastSubmission();
    expect(s).toEqual({ seed: 1, inputLog: [[0, 2]], claimedScore: 10 });
  });
});
