import { describe, expect, it } from 'vitest';
import { startPlaying, stepN } from '../test-support/engine';
import { CATALOG_ORDER, PICKUP_TTL } from './constants';
import { cloneState, step } from './game';
import { occupiedTile } from './movement';
import { applyPowerUp, durationOf, isActive, maybeSpawnPickup } from './powerups';
import { createRng, pick } from './rng';
import { P5_MAZE, WARP_MAZE } from './test-fixtures';
import type { Enemy, EnemyId, GameState, PowerKind } from './types';

// WARP_MAZE:            pads 0 (3,1), 1 (8,1), 2 (3,5), 3 (8,5); P (1,6); slots (1,3), (10,5), (10,6)
//   0123456789012 3
// 0 ##############
// 1 #..W....W..#X#
// 2 #.##.##.##.#=#
// 3 #U.........#E#
// 4 #.##.##.##.#E#
// 5 #..W....W.U#E#
// 6 #P........U#E#
// 7 ##############

function warpGame(seed = 1): GameState {
  return startPlaying(seed, { maze: WARP_MAZE });
}

function enemy(s: GameState, id: EnemyId): Enemy {
  return s.enemies.find((e) => e.id === id) as Enemy;
}

function putPlayer(s: GameState, x: number, y: number): void {
  Object.assign(s.player, { tile: { x, y }, dir: 0, progress: 0 });
}

function putEnemy(s: GameState, id: EnemyId, x: number, y: number): Enemy {
  const e = enemy(s, id);
  Object.assign(e, { tile: { x, y }, dir: 0, progress: 0, mode: 'active', releaseIn: 0 });
  return e;
}

/** Put a pickup under the player so the next step's phase (4) collects it. */
function pickupUnderPlayer(s: GameState, kind: PowerKind): void {
  s.pickup = { kind, at: occupiedTile(s.player), ttl: PICKUP_TTL };
}

describe('timers', () => {
  it('Lambda picked at step T is active after steps T..T+359 and inactive after T+360', () => {
    const s = warpGame();
    pickupUnderPlayer(s, 'lambda');
    const samples: boolean[] = [];
    for (let i = 0; i <= 361; i++) {
      step(s, 0);
      samples.push(isActive(s, 'lambda'));
    }
    expect(samples.slice(0, 360).every(Boolean)).toBe(true);
    expect(samples[360]).toBe(false);
    expect(samples[361]).toBe(false);
    expect(s.active.lambda).toBeUndefined();
  });

  it('Lambda speed applies from the step after the pickup', () => {
    const s = warpGame();
    pickupUnderPlayer(s, 'lambda');
    step(s, 2);
    expect(s.player.progress).toBe(32);
    step(s, 2);
    expect(s.player.progress).toBe(80);
  });

  it('re-picking resets the timer to the full duration (no stacking)', () => {
    const s = warpGame();
    applyPowerUp(s, 'cloudwatch');
    stepN(s, 100);
    expect(s.active.cloudwatch).toBe(480 - 100);
    applyPowerUp(s, 'cloudwatch');
    expect(s.active.cloudwatch).toBe(480);
  });

  it('timers never go negative and only run while playing', () => {
    const s = warpGame();
    applyPowerUp(s, 'autoscaling');
    s.phase = 'ready';
    s.phaseTimer = 50;
    stepN(s, 10);
    expect(s.active.autoscaling).toBe(300);
  });

  it('Auto Scaling expiry removes the clone; CloudFront expiry resets warpLock', () => {
    const s = warpGame();
    applyPowerUp(s, 'autoscaling');
    applyPowerUp(s, 'cloudfront');
    s.player.warpLock = 2;
    s.active.autoscaling = 1;
    s.active.cloudfront = 1;
    step(s, 0);
    expect(s.clone).toBeNull();
    expect(s.player.warpLock).toBe(-1);
    expect(s.active).toEqual({});
  });
});

describe('collection and applyPowerUp', () => {
  it('collecting a pickup adds 50, sets the timer, counts the service, and emits powerUpPickup', () => {
    const s = warpGame();
    pickupUnderPlayer(s, 'cloudwatch');
    step(s, 0);
    expect(s.score).toBe(50);
    expect(s.pickup).toBeNull();
    expect(s.active.cloudwatch).toBe(480);
    expect(s.stats.servicesUsed.cloudwatch).toBe(1);
    expect(s.events).toContainEqual({ type: 'powerUpPickup', kind: 'cloudwatch' });
  });

  it('applyPowerUp applies exactly the collection effect without the 50 points', () => {
    const s = warpGame();
    applyPowerUp(s, 'shield');
    expect(s.score).toBe(0);
    expect(s.active.shield).toBe(600);
    expect(s.stats.servicesUsed.shield).toBe(1);
    expect(s.events).toEqual([{ type: 'powerUpPickup', kind: 'shield' }]);
  });

  it('only the player collects pickups; the clone ignores them', () => {
    const s = warpGame();
    applyPowerUp(s, 'autoscaling');
    s.pickup = { kind: 'lambda', at: { x: 1, y: 5 }, ttl: PICKUP_TTL };
    stepN(s, 8);
    expect(s.clone?.tile).toEqual({ x: 1, y: 5 });
    expect(s.pickup).not.toBeNull();
    expect(isActive(s, 'lambda')).toBe(false);
  });

  it('CloudWatch is a flag: active for its duration with every enemy target populated', () => {
    const s = warpGame();
    applyPowerUp(s, 'cloudwatch');
    step(s, 0);
    expect(isActive(s, 'cloudwatch')).toBe(true);
    expect(enemy(s, 'latency').mode).toBe('active');
    expect(enemy(s, 'latency').target).toEqual(s.player.tile);
    for (const e of s.enemies) expect(e.target).toBeDefined();
  });
});

describe('Shield', () => {
  it('a block removes the shield, sends the enemy home with releaseIn 120, scores 200 and grants 30 invuln', () => {
    const s = warpGame();
    applyPowerUp(s, 'shield');
    putEnemy(s, 'latency', 1, 6);
    step(s, 0);
    expect(s.phase).toBe('playing');
    expect(s.lives).toBe(3);
    expect(s.score).toBe(200);
    expect(isActive(s, 'shield')).toBe(false);
    expect(s.player.invuln).toBe(30);
    expect(s.stats.shieldBlocks).toBe(1);
    expect(s.events).toContainEqual({ type: 'shieldBlock', enemy: 'latency' });
    expect(enemy(s, 'latency')).toMatchObject({ mode: 'pen', releaseIn: 120, tile: s.maze.pen[0], dir: 0 });
  });

  it('two enemies colliding in the same tick: the first in id order is blocked, invuln covers the second', () => {
    const s = warpGame();
    applyPowerUp(s, 'shield');
    putEnemy(s, 'latency', 1, 6);
    putEnemy(s, 'throttle', 1, 6);
    step(s, 0);
    expect(s.phase).toBe('playing');
    expect(s.lives).toBe(3);
    expect(s.events.filter((e) => e.type === 'shieldBlock')).toEqual([{ type: 'shieldBlock', enemy: 'latency' }]);
    expect(enemy(s, 'throttle').mode).toBe('active');
  });

  it('re-picking Shield resets it to 600 and a later block increments shieldBlocks by exactly 1', () => {
    const s = warpGame();
    applyPowerUp(s, 'shield');
    stepN(s, 50);
    applyPowerUp(s, 'shield');
    expect(s.active.shield).toBe(600);
    putEnemy(s, 'latency', 1, 6);
    step(s, 0);
    expect(s.stats.shieldBlocks).toBe(1);
    expect(isActive(s, 'shield')).toBe(false);
    s.player.invuln = 0;
    putEnemy(s, 'throttle', 1, 6);
    step(s, 0);
    expect(s.phase).toBe('dying');
    expect(s.stats.shieldBlocks).toBe(1);
  });
});

describe('Auto Scaling clone', () => {
  it('a clone spawned by a pickup first advances in its spawn step', () => {
    const s = warpGame();
    pickupUnderPlayer(s, 'autoscaling');
    step(s, 0);
    expect(s.events).toContainEqual({ type: 'cloneSpawn', at: { x: 1, y: 6 } });
    expect(s.clone).toEqual({ tile: { x: 1, y: 6 }, dir: 1, progress: 32 });
  });

  it('the clone BFSes to the nearest bug and eats it at occ(clone) for 10 points', () => {
    const s = warpGame();
    applyPowerUp(s, 'autoscaling');
    stepN(s, 3);
    expect(s.score).toBe(0);
    step(s, 0); // progress 128 → occ(clone) = (1,5)
    expect(s.events).toContainEqual({ type: 'bug', at: { x: 1, y: 5 }, by: 'clone' });
    expect(s.score).toBe(10);
    expect(s.bugsEatenThisLevel).toBe(1);
    expect(s.stats.bugsEaten).toBe(1);
  });

  it('re-picking keeps the existing clone and emits no second cloneSpawn', () => {
    const s = warpGame();
    applyPowerUp(s, 'autoscaling');
    stepN(s, 20);
    const before = structuredClone(s.clone);
    s.events = [];
    applyPowerUp(s, 'autoscaling');
    expect(s.events).toEqual([{ type: 'powerUpPickup', kind: 'autoscaling' }]);
    expect(s.clone).toEqual(before);
    expect(s.active.autoscaling).toBe(300);
  });

  it('with no reachable bug the clone stays put', () => {
    const s = warpGame();
    s.bugs = s.bugs.map(() => 0);
    const pen = s.maze.pen[0] as { x: number; y: number };
    s.bugs[pen.y * s.maze.w + pen.x] = 1; // a bug only inside the sealed pen
    s.bugsLeft = 1;
    applyPowerUp(s, 'autoscaling');
    stepN(s, 10);
    expect(s.clone).toEqual({ tile: { x: 1, y: 6 }, dir: 0, progress: 0 });
  });

  it('enemies ignore the clone', () => {
    const s = warpGame();
    applyPowerUp(s, 'autoscaling');
    putEnemy(s, 'coldstart', 1, 6).cold = { phase: 'frozen', timer: 100 };
    s.player.invuln = 50;
    putPlayer(s, 5, 3);
    s.clone = { tile: { x: 1, y: 6 }, dir: 0, progress: 0 };
    step(s, 0);
    expect(s.phase).toBe('playing');
    expect(s.clone).not.toBeNull();
  });
});

describe('CloudFront warps', () => {
  it('standing still on pad i when granted warps to pad (i+1) % 4 next step and not back while staying', () => {
    const s = warpGame();
    putPlayer(s, 3, 5); // pad 2
    applyPowerUp(s, 'cloudfront');
    step(s, 0);
    expect(s.events).toContainEqual({ type: 'warp', from: 2, to: 3 });
    expect(s.player).toMatchObject({ tile: { x: 8, y: 5 }, progress: 0, warpLock: 3 });
    stepN(s, 30);
    expect(s.player.tile).toEqual({ x: 8, y: 5 });
  });

  it('cycles pads: leaving the arrival pad unlocks it, and arriving again warps onward', () => {
    const s = warpGame();
    putPlayer(s, 3, 5);
    applyPowerUp(s, 'cloudfront');
    step(s, 0); // → pad 3 (8,5)
    stepN(s, 8, 2); // walk right onto (9,5)
    expect(s.player.tile).toEqual({ x: 9, y: 5 });
    expect(s.player.warpLock).toBe(-1);
    let warped = false;
    for (let i = 0; i < 12 && !warped; i++) {
      step(s, 4);
      warped = s.events.some((e) => e.type === 'warp');
    }
    expect(s.events).toContainEqual({ type: 'warp', from: 3, to: 0 });
    expect(s.player).toMatchObject({ tile: { x: 3, y: 1 }, dir: 4, progress: 0, warpLock: 0 });
  });

  it('Lambda + CloudFront: crossing a pad with non-zero leftover progress warps and drops the leftover', () => {
    const s = warpGame();
    putPlayer(s, 1, 5);
    applyPowerUp(s, 'lambda');
    applyPowerUp(s, 'cloudfront');
    stepN(s, 10, 2); // 10 × 48 = 480 → (2,5) with 224
    expect(s.player).toMatchObject({ tile: { x: 2, y: 5 }, progress: 224 });
    const noWarp = cloneState(s);
    delete noWarp.active.cloudfront;
    step(noWarp, 2);
    expect(noWarp.player).toMatchObject({ tile: { x: 3, y: 5 }, progress: 16 });
    step(s, 2);
    expect(s.events).toContainEqual({ type: 'warp', from: 2, to: 3 });
    expect(s.player).toMatchObject({ tile: { x: 8, y: 5 }, dir: 2, progress: 0, warpLock: 3 });
  });

  it('pads do nothing while CloudFront is inactive', () => {
    const s = warpGame();
    putPlayer(s, 3, 5);
    stepN(s, 5);
    expect(s.player.tile).toEqual({ x: 3, y: 5 });
    expect(s.events.some((e) => e.type === 'warp')).toBe(false);
  });

  it('a warp onto a pad occupied by an enemy happens, and the collision resolves normally', () => {
    const s = warpGame();
    putPlayer(s, 3, 5);
    putEnemy(s, 'coldstart', 8, 5).cold = { phase: 'frozen', timer: 100 };
    applyPowerUp(s, 'cloudfront');
    step(s, 0);
    expect(s.events).toContainEqual({ type: 'warp', from: 2, to: 3 });
    expect(s.phase).toBe('dying');
    expect(s.lastKiller).toBe('coldstart');
  });
});

describe('pickup spawning', () => {
  it('spawns at the threshold: kind drawn first, then a slot excluding occ(player); ttl 600', () => {
    const s = warpGame();
    putPlayer(s, 10, 5); // on slot (10,5)
    s.bugsEatenThisLevel = 30;
    const ref = { ...s.rng };
    const kind = pick(ref, CATALOG_ORDER);
    const slot = pick(ref, [
      { x: 1, y: 3 },
      { x: 10, y: 6 },
    ]);
    expect(maybeSpawnPickup(s)).toBe(true);
    expect(s.pickup).toEqual({ kind, at: slot, ttl: 600 });
    expect(s.nextPickupThreshold).toBe(90);
    expect(s.rng).toEqual(ref);
    expect(s.events).toContainEqual({ type: 'powerUpSpawn', kind, at: slot });
  });

  it('with no slot left besides the player tile there is no spawn and no second draw', () => {
    const s = warpGame();
    putPlayer(s, 10, 5);
    s.maze.slots = [{ x: 10, y: 5 }];
    s.bugsEatenThisLevel = 30;
    const ref = { ...s.rng };
    pick(ref, CATALOG_ORDER);
    expect(maybeSpawnPickup(s)).toBe(false);
    expect(s.pickup).toBeNull();
    expect(s.rng).toEqual(ref);
    expect(s.nextPickupThreshold).toBe(90);
  });

  it('a threshold crossed while a pickup is present is skipped, not deferred', () => {
    const s = warpGame();
    s.pickup = { kind: 'shield', at: { x: 1, y: 3 }, ttl: 400 };
    s.bugsEatenThisLevel = 29;
    step(s, 2); // eats nothing yet
    stepN(s, 3, 2); // progress 128 → eats (2,6)
    expect(s.bugsEatenThisLevel).toBe(30);
    expect(s.nextPickupThreshold).toBe(90);
    expect(s.pickup).toMatchObject({ kind: 'shield', ttl: 396 });
    s.pickup = null;
    stepN(s, 8, 2); // eats (3,6): 31 bugs, below the next threshold
    expect(s.bugsEatenThisLevel).toBe(31);
    expect(s.pickup).toBeNull();
  });

  it('player and clone eating two bugs in one tick across a threshold spawns once', () => {
    const s = warpGame();
    Object.assign(s.player, { tile: { x: 1, y: 6 }, dir: 2, progress: 96 });
    s.active.autoscaling = 100;
    s.clone = { tile: { x: 1, y: 4 }, dir: 3, progress: 96 };
    s.bugsEatenThisLevel = 29;
    step(s, 2);
    expect(s.events.filter((e) => e.type === 'bug')).toHaveLength(2);
    expect(s.events.filter((e) => e.type === 'powerUpSpawn')).toHaveLength(1);
    expect(s.bugsEatenThisLevel).toBe(31);
    expect(s.nextPickupThreshold).toBe(90);
  });

  it('a pickup keeps ttl 600 on its spawn step, then loses 1 per playing step and vanishes at 0', () => {
    const s = warpGame();
    s.bugsEatenThisLevel = 30;
    step(s, 0);
    expect(s.pickup?.ttl).toBe(600);
    step(s, 0);
    expect(s.pickup?.ttl).toBe(599);
    (s.pickup as { ttl: number }).ttl = 1;
    step(s, 0);
    expect(s.pickup).toBeNull();
  });

  it('spawns follow thresholds 30, 90, 150, ...', () => {
    const s = startPlaying(4, { maze: P5_MAZE });
    for (const [eaten, next] of [
      [30, 90],
      [90, 150],
      [150, 210],
    ] as const) {
      s.pickup = null;
      s.bugsEatenThisLevel = eaten;
      expect(maybeSpawnPickup(s)).toBe(true);
      expect(s.nextPickupThreshold).toBe(next);
    }
  });
});

describe('death and effects', () => {
  it('death during an active Lambda clears it, and the next life starts at speed 32', () => {
    const s = warpGame();
    applyPowerUp(s, 'lambda');
    applyPowerUp(s, 'autoscaling');
    s.pickup = { kind: 'shield', at: { x: 1, y: 3 }, ttl: 100 };
    putEnemy(s, 'latency', 1, 6);
    step(s, 0);
    expect(s.phase).toBe('dying');
    expect(s.active).toEqual({});
    expect(s.clone).toBeNull();
    expect(s.pickup).toBeNull();
    while (s.phase !== 'playing') step(s, 0);
    step(s, 2);
    expect(s.player.progress).toBe(32);
  });

  it('durations come from services.json', () => {
    expect(durationOf('lambda')).toBe(360);
    expect(durationOf('shield')).toBe(600);
    expect(durationOf('autoscaling')).toBe(300);
    expect(durationOf('cloudfront')).toBe(480);
    expect(durationOf('cloudwatch')).toBe(480);
  });

  it('createRng based pick order is stable (sanity for spawn expectations)', () => {
    const a = createRng(1);
    const b = createRng(1);
    expect(pick(a, CATALOG_ORDER)).toBe(pick(b, CATALOG_ORDER));
  });
});
