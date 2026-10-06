import { describe, expect, it } from 'vitest';
import { startPlaying, stepN, withChars } from '../test-support/engine';
import { MAX_TICKS } from './constants';
import { cloneState, createGame, forceGameOver, step } from './game';
import { LEVELS } from './levels';
import { InvalidMazeError } from './maze';
import { applyPowerUp } from './powerups';
import { WALLED_OFF_MAZE, WARP_MAZE } from './test-fixtures';
import type { Enemy, EnemyId, GameState } from './types';

function enemy(s: GameState, id: EnemyId): Enemy {
  return s.enemies.find((e) => e.id === id) as Enemy;
}

function putEnemy(s: GameState, id: EnemyId, x: number, y: number, dir: Enemy['dir'] = 0, progress = 0): Enemy {
  const e = enemy(s, id);
  Object.assign(e, { tile: { x, y }, dir, progress, mode: 'active', releaseIn: 0 });
  return e;
}

/** Leaves exactly one bug, at (x, y). */
function onlyBugAt(s: GameState, x: number, y: number): void {
  s.bugs = s.bugs.map(() => 0);
  s.bugs[y * s.maze.w + x] = 1;
  s.bugsLeft = 1;
}

describe('createGame', () => {
  it('returns the binding initial state', () => {
    const s = createGame(0xdeadbeef);
    expect(s).toMatchObject({
      seed: 0xdeadbeef,
      tick: 0,
      phase: 'ready',
      phaseTimer: 120,
      level: 1,
      lives: 3,
      score: 0,
      events: [],
      lastKiller: null,
      gameOverReason: null,
      bugsEatenThisLevel: 0,
      nextPickupThreshold: 30,
      clone: null,
      pickup: null,
      active: {},
      config: { startLives: 3 },
    });
    expect(s.rng).toEqual({ s: 0xdeadbeef | 0 });
    expect(s.player).toEqual({
      tile: s.maze.spawn,
      dir: 0,
      progress: 0,
      desired: 0,
      facing: 0,
      invuln: 0,
      warpLock: -1,
    });
    expect(s.stats).toEqual({
      bugsEaten: 0,
      servicesUsed: { lambda: 0, shield: 0, autoscaling: 0, cloudfront: 0, cloudwatch: 0 },
      shieldBlocks: 0,
    });
    expect(s.bugsLeft).toBe(s.bugs.filter((b) => b === 1).length);
    expect(s.bugsLeft).toBeGreaterThan(300);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('uses seed >>> 0', () => {
    expect(createGame(-1).seed).toBe(4294967295);
  });

  it.each([0, 10, 1.5, -1, Number.NaN])('throws RangeError for startLives %s', (startLives) => {
    expect(() => createGame(1, { startLives })).toThrow(RangeError);
  });

  it('accepts startLives 1 and 9', () => {
    expect(createGame(1, { startLives: 1 }).lives).toBe(1);
    expect(createGame(1, { startLives: 9 }).lives).toBe(9);
  });

  it('throws InvalidMazeError for an invalid config.maze', () => {
    expect(() => createGame(1, { maze: withChars(WALLED_OFF_MAZE, [[7, 6, '#']]) })).toThrow(InvalidMazeError);
  });
});

describe('phases', () => {
  it('ready lasts exactly 120 steps and the transition happens in the step the timer hits 0', () => {
    const s = createGame(1);
    stepN(s, 119);
    expect(s).toMatchObject({ phase: 'ready', phaseTimer: 1, tick: 119 });
    step(s, 0);
    expect(s).toMatchObject({ phase: 'playing', tick: 120 });
  });

  it('nothing moves while not playing, but the input rule applies in every phase', () => {
    const s = createGame(1);
    const before = cloneState(s);
    step(s, 2);
    expect(s.player.desired).toBe(2);
    expect(s.player.tile).toEqual(before.player.tile);
    expect(s.enemies).toEqual(before.enemies);
  });

  it('a gameOver-phase step clears events and only increments tick', () => {
    const s = startPlaying(1);
    forceGameOver(s);
    const before = cloneState(s);
    step(s, 3);
    expect(s.events).toEqual([]);
    expect(s.tick).toBe(before.tick + 1);
    expect({ ...s, tick: 0, events: [] }).toEqual({ ...before, tick: 0, events: [] });
  });

  it('forceGameOver sets lives 0, gameOver, reason qa, no killer, and emits gameOver; the next step clears it', () => {
    const s = startPlaying(1);
    s.lastKiller = 'throttle';
    forceGameOver(s);
    expect(s).toMatchObject({ lives: 0, phase: 'gameOver', gameOverReason: 'qa', lastKiller: null });
    expect(s.events).toEqual([{ type: 'gameOver', reason: 'qa' }]);
    step(s, 0);
    expect(s.events).toEqual([]);
    expect(s.phase).toBe('gameOver');
  });

  it('events are cleared first in every phase', () => {
    const s = createGame(1);
    s.events.push({ type: 'warp', from: 0, to: 1 });
    step(s, 0);
    expect(s.events).toEqual([]);
  });
});

describe('collisions, death and lives', () => {
  it('same-tile collision kills: dying 90, lives - 1, lastKiller, death event, effects cleared', () => {
    const s = startPlaying(1, { maze: WARP_MAZE });
    applyPowerUp(s, 'cloudwatch');
    putEnemy(s, 'outage', 1, 6);
    s.rng = { s: 1 };
    step(s, 0);
    expect(s).toMatchObject({ phase: 'dying', phaseTimer: 90, lives: 2, lastKiller: 'outage', active: {} });
    expect(s.events).toContainEqual({ type: 'death', enemy: 'outage' });
  });

  it('swap-tile collision: player and enemy facing each other across one tile boundary', () => {
    const s = startPlaying(1, { maze: WARP_MAZE });
    Object.assign(s.player, { tile: { x: 2, y: 6 }, dir: 2, progress: 120, desired: 2 });
    putEnemy(s, 'latency', 3, 6, 4, 120);
    step(s, 2);
    // occ(player) moved to (3,6) and occ(latency) to (2,6): they swapped tiles within one tick.
    expect(s.phase).toBe('dying');
    expect(s.lastKiller).toBe('latency');
  });

  it('collisions are skipped while invulnerable and for pen enemies', () => {
    const s = startPlaying(1, { maze: WARP_MAZE });
    s.player.invuln = 5;
    putEnemy(s, 'coldstart', 1, 6).cold = { phase: 'frozen', timer: 100 };
    step(s, 0);
    expect(s.phase).toBe('playing');
    const t = startPlaying(1, { maze: WARP_MAZE });
    Object.assign(enemy(t, 'outage'), { tile: { x: 1, y: 6 } });
    step(t, 0);
    expect(t.phase).toBe('playing');
  });

  it('dying ends in ready with positions reset and bugs kept, then a final death ends the game as caught', () => {
    const s = startPlaying(1, { maze: WARP_MAZE, startLives: 2 });
    stepN(s, 8, 2);
    const bugsAfterEating = s.bugsLeft;
    putEnemy(s, 'latency', s.player.tile.x, s.player.tile.y);
    step(s, 0);
    expect(s.phase).toBe('dying');
    stepN(s, 89);
    expect(s.phase).toBe('dying');
    step(s, 0);
    expect(s).toMatchObject({ phase: 'ready', phaseTimer: 120, lives: 1, bugsLeft: bugsAfterEating });
    expect(s.player).toMatchObject({ tile: s.maze.spawn, dir: 0, desired: 0, facing: 0, progress: 0, warpLock: -1 });
    s.enemies.forEach((e, i) => expect(e).toMatchObject({ mode: 'pen', tile: s.maze.pen[i] }));
    expect(s.enemies.map((e) => e.releaseIn)).toEqual([0, 180, 360, 540]);

    while (s.phase !== 'playing') step(s, 0);
    putEnemy(s, 'throttle', 1, 6);
    step(s, 0);
    expect(s).toMatchObject({ phase: 'dying', lives: 0, lastKiller: 'throttle' });
    stepN(s, 90);
    expect(s).toMatchObject({ phase: 'gameOver', gameOverReason: 'caught', lastKiller: 'throttle' });
    expect(s.events).toEqual([{ type: 'gameOver', reason: 'caught' }]);
  });
});

describe('level clear', () => {
  it('awards 500 × L, enters levelClear for 120 ticks, clears effects immediately, then loads the next hall', () => {
    const s = startPlaying(7);
    onlyBugAt(s, 20, 19);
    Object.assign(s.player, { tile: { x: 19, y: 19 }, dir: 2, progress: 96, desired: 2 });
    applyPowerUp(s, 'lambda');
    applyPowerUp(s, 'autoscaling');
    s.clone = { tile: { x: 5, y: 4 }, dir: 0, progress: 0 };
    s.pickup = { kind: 'shield', at: { x: 9, y: 7 }, ttl: 300 };
    s.score = 0;
    s.active.lambda = 360;
    // Lambda speed: 96 + 48 = 144 ≥ 128 → eats (20,19).
    step(s, 2);
    expect(s.bugsLeft).toBe(0);
    expect(s).toMatchObject({ phase: 'levelClear', phaseTimer: 120, active: {}, clone: null, pickup: null });
    expect(s.score).toBe(10 + 500);
    expect(s.events).toContainEqual({ type: 'levelClear', level: 1, bonus: 500 });
    stepN(s, 120);
    expect(s).toMatchObject({ phase: 'ready', level: 2, bugsEatenThisLevel: 0, nextPickupThreshold: 30 });
    expect(s.maze.cells).toEqual(createGame(1, { maze: [...(LEVELS[1]?.ascii ?? [])] }).maze.cells);
    expect(s.bugsLeft).toBeGreaterThan(300);
    expect(s.enemies.map((e) => e.releaseIn)).toEqual([0, 165, 330, 495]);
  });

  it('level clear vs death on the same tick: death wins; the clear fires on the first playing step after respawn', () => {
    const s = startPlaying(1, { maze: WARP_MAZE });
    onlyBugAt(s, 2, 6);
    Object.assign(s.player, { tile: { x: 1, y: 6 }, dir: 2, progress: 96, desired: 2 });
    putEnemy(s, 'coldstart', 2, 6).cold = { phase: 'frozen', timer: 100 };
    step(s, 2);
    expect(s.bugsLeft).toBe(0);
    expect(s.phase).toBe('dying');
    while (s.phase !== 'playing') step(s, 0);
    const scoreBefore = s.score;
    step(s, 0);
    expect(s.phase).toBe('levelClear');
    expect(s.score).toBe(scoreBefore + 500);
  });

  it('with lives = 0 there is no clear bonus', () => {
    const s = startPlaying(1, { maze: WARP_MAZE, startLives: 1 });
    onlyBugAt(s, 2, 6);
    Object.assign(s.player, { tile: { x: 1, y: 6 }, dir: 2, progress: 96, desired: 2 });
    putEnemy(s, 'coldstart', 2, 6).cold = { phase: 'frozen', timer: 100 };
    step(s, 2);
    const score = s.score;
    stepN(s, 200);
    expect(s.phase).toBe('gameOver');
    expect(s.gameOverReason).toBe('caught');
    expect(s.score).toBe(score);
  });
});

describe('time limit', () => {
  it('in every phase, the step at tick MAX_TICKS - 1 ends the game with reason timeLimit', () => {
    for (const phase of ['ready', 'playing', 'dying', 'levelClear'] as const) {
      const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
      s.phase = phase;
      s.phaseTimer = 50;
      s.tick = MAX_TICKS - 1;
      s.lastKiller = 'latency';
      step(s, 0);
      expect(s).toMatchObject({ phase: 'gameOver', gameOverReason: 'timeLimit', lastKiller: null, tick: MAX_TICKS });
      expect(s.events).toContainEqual({ type: 'gameOver', reason: 'timeLimit' });
    }
  });

  it('does not override a game that ended normally in the same step', () => {
    const s = startPlaying(1, { maze: WARP_MAZE, startLives: 1 });
    s.phase = 'dying';
    s.phaseTimer = 1;
    s.lives = 0;
    s.lastKiller = 'outage';
    s.tick = MAX_TICKS - 1;
    step(s, 0);
    expect(s).toMatchObject({ gameOverReason: 'caught', lastKiller: 'outage' });
  });
});

describe('cloneState', () => {
  it('deep-copies: continuing the copy matches continuing the original', () => {
    const a = startPlaying(11);
    stepN(a, 50, 2);
    const b = cloneState(a);
    stepN(a, 200, 3);
    stepN(b, 200, 3);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
