import { describe, expect, it } from 'vitest';
import { rawMaze, startPlaying, stepN } from '../../test-support/engine';
import { difficulty } from '../constants';
import { createGame, step } from '../game';
import { createRng, nextU32 } from '../rng';
import { WALLED_OFF_MAZE } from '../test-fixtures';
import type { Enemy, EnemyId, GameState } from '../types';
import { decideColdStart, decideLatency, decideOutage, decideThrottle, isDark, throttleTarget } from './index';
import { candidateDirs } from './pathing';

//   0123456789
// 0 ##########
// 1 #........#
// 2 #.######.#
// 3 #.######.#
// 4 #........#
// 5 ##########
const RING = rawMaze(['##########', '#........#', '#.######.#', '#.######.#', '#........#', '##########']);

//   0123456
// 0 #######
// 1 #.....#
// 2 #.###.#
// 3 #.#...#   (3,3) is a dead end pointing left
// 4 #######
const DEAD_END = rawMaze(['#######', '#.....#', '#.###.#', '#.#...#', '#######']);

function enemy(s: GameState, id: EnemyId): Enemy {
  return s.enemies.find((e) => e.id === id) as Enemy;
}

/** A playing state whose maze is swapped for a raw decision-test maze. */
function aiState(maze = RING): GameState {
  const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
  s.maze = maze;
  return s;
}

function place(e: Enemy, x: number, y: number, dir: Enemy['dir'] = 0): void {
  e.tile = { x, y };
  e.dir = dir;
  e.progress = 0;
  e.mode = 'active';
}

describe('Latency (BFS pursuit)', () => {
  it('takes the first step of the BFS shortest path to the player tile', () => {
    const s = aiState();
    s.player.tile = { x: 5, y: 4 };
    s.player.facing = 2;
    const e = enemy(s, 'latency');
    place(e, 1, 1);
    // Down the left side is 7 steps; the right way round is 13.
    expect(decideLatency(s, e)).toEqual({ dir: 3, target: { x: 5, y: 4 } });
  });

  it('stays (dir 0) when the player is unreachable', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    step(s, 0);
    const e = enemy(s, 'latency');
    expect(e.mode).toBe('active');
    expect(decideLatency(s, e).dir).toBe(0);
  });
});

describe('Throttle (cut-off)', () => {
  it('targets 4 tiles ahead of the player facing, clamped to the grid', () => {
    const s = aiState();
    s.player.tile = { x: 5, y: 4 };
    s.player.facing = 2;
    expect(throttleTarget(s)).toEqual({ x: 9, y: 4 });
    s.player.facing = 4;
    expect(throttleTarget(s)).toEqual({ x: 1, y: 4 });
    s.player.facing = 3;
    expect(throttleTarget(s)).toEqual({ x: 5, y: 5 });
    s.player.facing = 0;
    expect(throttleTarget(s)).toEqual({ x: 5, y: 4 });
  });

  it('steers greedily toward the ahead target, unlike Latency', () => {
    const s = aiState();
    s.player.tile = { x: 5, y: 4 };
    s.player.facing = 2;
    const e = enemy(s, 'throttle');
    place(e, 1, 1);
    // Target (9,4): right neighbor (2,1) is closer than down neighbor (1,2).
    expect(decideThrottle(s, e)).toEqual({ dir: 2, target: { x: 9, y: 4 } });
    expect(decideLatency(s, e).dir).toBe(3);
  });

  it('does not reverse except at a dead end', () => {
    const s = aiState();
    s.player.tile = { x: 8, y: 1 };
    s.player.facing = 2;
    const e = enemy(s, 'throttle');
    place(e, 5, 1, 4); // moving left, target is to the right
    expect(decideThrottle(s, e).dir).toBe(4);

    const d = aiState(DEAD_END);
    d.player.tile = { x: 5, y: 3 };
    const t = enemy(d, 'throttle');
    place(t, 3, 3, 4); // reached the dead end moving left
    expect(candidateDirs(DEAD_END, t)).toEqual([2]);
    expect(decideThrottle(d, t).dir).toBe(2);
  });

  it('picks the neighbor with the smallest squared distance to the target', () => {
    const s = aiState();
    s.player.tile = { x: 1, y: 1 };
    s.player.facing = 0;
    const e = enemy(s, 'throttle');
    place(e, 8, 4); // target (1,1): up (8,3) → 49+4 = 53, left (7,4) → 36+9 = 45 → left
    expect(decideThrottle(s, e).dir).toBe(4);
  });

  it('breaks distance ties in U, L, D, R order', () => {
    const s = aiState();
    s.player.tile = { x: 2, y: 2 }; // the target may be a wall
    s.player.facing = 0;
    const e = enemy(s, 'throttle');
    place(e, 1, 1); // right (2,1) and down (1,2) are both at distance 1; D precedes R
    expect(decideThrottle(s, e).dir).toBe(3);
  });
});

describe('Cold Start (freeze then dash)', () => {
  it('starts frozen after release with timer coldFrozen, and the release tick decrements nothing', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    const cold = enemy(s, 'coldstart');
    stepN(s, difficulty(1).releaseDelays.coldstart);
    expect(cold.mode).toBe('active');
    expect(cold.cold).toEqual({ phase: 'frozen', timer: difficulty(1).coldFrozen });
    step(s, 0);
    expect(cold.cold).toEqual({ phase: 'frozen', timer: difficulty(1).coldFrozen - 1 });
  });

  it('frozen does not move (even mid-tile); on the step its timer hits 0 it dashes in that same step', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    const cold = enemy(s, 'coldstart');
    place(cold, 1, 6, 2);
    cold.progress = 40;
    cold.cold = { phase: 'frozen', timer: 3 };
    step(s, 0);
    step(s, 0);
    expect(cold).toMatchObject({ tile: { x: 1, y: 6 }, progress: 40, target: { x: 1, y: 6 } });
    expect(cold.cold).toEqual({ phase: 'frozen', timer: 1 });
    step(s, 0);
    expect(cold.cold).toEqual({ phase: 'dash', timer: 240 });
    expect(cold.progress).toBe(40 + difficulty(1).speeds.coldstart);
    expect(cold.target).toEqual(s.player.tile);
  });

  it('dashes along the BFS path to the player and freezes again after 240 ticks', () => {
    const s = aiState();
    s.player.tile = { x: 5, y: 4 };
    const e = enemy(s, 'coldstart');
    place(e, 1, 1);
    e.cold = { phase: 'dash', timer: 10 };
    expect(decideColdStart(s, e)).toEqual({ dir: 3, target: { x: 5, y: 4 } });
    e.cold = { phase: 'frozen', timer: 10 };
    expect(decideColdStart(s, e)).toEqual({ dir: 0, target: { x: 1, y: 1 } });
  });

  it('toggles dash → frozen with the level frozen duration', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    const cold = enemy(s, 'coldstart');
    place(cold, 1, 6);
    cold.cold = { phase: 'dash', timer: 1 };
    step(s, 0);
    expect(cold.cold).toEqual({ phase: 'frozen', timer: difficulty(1).coldFrozen });
  });
});

describe('Outage (random wander + darkness)', () => {
  it('picks among candidates with the seeded PRNG, so the choice changes with the seed', () => {
    const choices = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const s = aiState();
      s.rng = createRng(seed);
      const e = enemy(s, 'outage');
      place(e, 1, 1); // dir 0 at a corner: candidates D and R
      choices.add(decideOutage(s, e).dir);
    }
    expect([...choices].sort()).toEqual([2, 3]);
  });

  it('is deterministic for a given rng state and targets the chosen next tile', () => {
    const a = aiState();
    const b = aiState();
    a.rng = createRng(77);
    b.rng = createRng(77);
    place(enemy(a, 'outage'), 1, 1);
    place(enemy(b, 'outage'), 1, 1);
    const da = decideOutage(a, enemy(a, 'outage'));
    expect(decideOutage(b, enemy(b, 'outage'))).toEqual(da);
    expect(da.target).toEqual(da.dir === 2 ? { x: 2, y: 1 } : { x: 1, y: 2 });
  });

  it('with exactly one candidate it still consumes one rng draw', () => {
    const s = aiState();
    s.rng = createRng(5);
    const e = enemy(s, 'outage');
    place(e, 5, 1, 4); // corridor moving left: only candidate is left
    expect(candidateDirs(RING, e)).toEqual([4]);
    expect(decideOutage(s, e).dir).toBe(4);
    const ref = createRng(5);
    nextU32(ref);
    expect(s.rng).toEqual(ref);
    expect(s.rng).not.toEqual(createRng(5));
  });

  it('with no candidates it stays and draws nothing', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    const e = enemy(s, 'outage');
    place(e, s.maze.exit.x, s.maze.exit.y); // the sealed X pocket
    const before = { ...s.rng };
    expect(decideOutage(s, e).dir).toBe(0);
    expect(s.rng).toEqual(before);
  });

  it('darkens tiles within Manhattan distance 4, never while in the pen', () => {
    const s = aiState();
    const e = enemy(s, 'outage');
    e.mode = 'pen';
    e.tile = { x: 4, y: 2 };
    expect(isDark(s, 4, 2)).toBe(false);
    e.mode = 'active';
    expect(isDark(s, 4, 2)).toBe(true);
    expect(isDark(s, 8, 2)).toBe(true);
    expect(isDark(s, 6, 4)).toBe(true);
    expect(isDark(s, 9, 2)).toBe(false);
    expect(isDark(s, 7, 4)).toBe(false);
  });
});

describe('pen, release and order', () => {
  it('enemies are in ENEMY_ORDER at their row-major pen homes with level release delays', () => {
    const s = createGame(1, { maze: WALLED_OFF_MAZE });
    expect(s.enemies.map((e) => e.id)).toEqual(['latency', 'throttle', 'coldstart', 'outage']);
    s.enemies.forEach((e, i) => {
      expect(e.tile).toEqual(s.maze.pen[i]);
      expect(e.target).toEqual(s.maze.pen[i]);
      expect(e).toMatchObject({ mode: 'pen', dir: 0, progress: 0 });
    });
    expect(s.enemies.map((e) => e.releaseIn)).toEqual([0, 180, 360, 540]);
  });

  it('Latency (delay 0) releases on the first playing step onto X', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    expect(enemy(s, 'latency').mode).toBe('pen');
    step(s, 0);
    expect(enemy(s, 'latency')).toMatchObject({ mode: 'active', tile: s.maze.exit, dir: 0, progress: 0 });
  });

  it('a pen enemy counts down and releases in the step its releaseIn reaches 0', () => {
    const s = startPlaying(1, { maze: WALLED_OFF_MAZE });
    stepN(s, 179);
    expect(enemy(s, 'throttle')).toMatchObject({ mode: 'pen', releaseIn: 1 });
    step(s, 0);
    expect(enemy(s, 'throttle')).toMatchObject({ mode: 'active', releaseIn: 0, tile: s.maze.exit });
  });

  it('pen enemies do not count down outside playing', () => {
    const s = createGame(1, { maze: WALLED_OFF_MAZE });
    stepN(s, 119);
    expect(s.phase).toBe('ready');
    expect(s.enemies.map((e) => e.releaseIn)).toEqual([0, 180, 360, 540]);
  });

  it('a just-released enemy decides on the release tick and moves away from X', () => {
    const s = startPlaying(1);
    step(s, 0);
    const lat = enemy(s, 'latency');
    expect(lat.mode).toBe('active');
    expect(lat.dir).not.toBe(0);
    expect(lat.progress).toBe(difficulty(1).speeds.latency);
    expect(lat.tile).toEqual(s.maze.exit);
  });

  it('every enemy target is always populated', () => {
    const s = startPlaying(9);
    for (let i = 0; i < 600 && s.phase === 'playing'; i++) {
      step(s, ((i >> 5) % 4) + 1 as 1 | 2 | 3 | 4);
      for (const e of s.enemies) {
        expect(Number.isInteger(e.target.x) && Number.isInteger(e.target.y)).toBe(true);
      }
    }
  });
});
