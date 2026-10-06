import type { EnemyId, PowerKind } from './types';

export const TICK_HZ = 60;
export const TILE_UNITS = 256;
export const HALF_TILE = 128;
export const MAZE_W = 40;
export const MAZE_H = 28;
/** 30 simulated minutes. The engine ends the game during the step at `MAX_TICKS - 1`. */
export const MAX_TICKS = 108000;

export const PLAYER_SPEED = 32;
export const LAMBDA_SPEED = 48;
export const CLONE_SPEED = 32;

export const READY_TICKS = 120;
export const DYING_TICKS = 90;
export const LEVEL_CLEAR_TICKS = 120;

export const PICKUP_TTL = 600;
export const FIRST_PICKUP_THRESHOLD = 30;
export const PICKUP_THRESHOLD_STEP = 60;

export const SCORE_BUG = 10;
export const SCORE_PICKUP = 50;
export const SCORE_SHIELD_BLOCK = 200;
export const LEVEL_CLEAR_BONUS_PER_LEVEL = 500;

export const SHIELD_INVULN_TICKS = 30;
export const SHIELD_RELEASE_TICKS = 120;
export const COLD_DASH_TICKS = 240;
export const DARK_RADIUS = 4;
export const THROTTLE_LOOKAHEAD = 4;

export const DEFAULT_START_LIVES = 3;
export const MIN_START_LIVES = 1;
export const MAX_START_LIVES = 9;

/** Difficulty stops increasing after level 7 (b = min(L-1, 6)). */
export const MAX_DIFFICULTY_STEP = 6;

/** Binding id order for `state.enemies`, per-tick loops, and ties. */
export const ENEMY_ORDER: readonly EnemyId[] = ['latency', 'throttle', 'coldstart', 'outage'];

/** Binding power-up order; must equal the `services.json` array order. */
export const CATALOG_ORDER: readonly PowerKind[] = ['lambda', 'shield', 'autoscaling', 'cloudfront', 'cloudwatch'];

export interface Difficulty {
  /** Units per tick. `coldstart` is the dash speed (frozen = 0). */
  speeds: Record<EnemyId, number>;
  /** Ticks in the pen after `ready` ends. */
  releaseDelays: Record<EnemyId, number>;
  /** Cold Start frozen-phase length in ticks. */
  coldFrozen: number;
}

/** Overview §5.5. */
export function difficulty(level: number): Difficulty {
  const b = Math.min(Math.max(level - 1, 0), MAX_DIFFICULTY_STEP);
  return {
    speeds: { latency: 22 + b, throttle: 29 + b, coldstart: 46 + b, outage: 26 + b },
    releaseDelays: {
      latency: 0,
      throttle: Math.max(60, 180 - 15 * b),
      coldstart: Math.max(120, 360 - 30 * b),
      outage: Math.max(180, 540 - 45 * b),
    },
    coldFrozen: Math.max(90, 180 - 15 * b),
  };
}
