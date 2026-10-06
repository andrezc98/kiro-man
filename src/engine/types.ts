/** Binding core types (game-engine/design.md "Core types" and "GameState shape"). */
import type { Rng } from './rng';

/** 0 none, 1 up, 2 right, 3 down, 4 left. */
export type Dir = 0 | 1 | 2 | 3 | 4;

export interface Vec {
  x: number;
  y: number;
}

/** Cell kinds stored in `Maze.cells`. `Bug` is a floor tile that starts a level with a bug on it. */
export const Tile = {
  Wall: 0,
  Floor: 1,
  Bug: 2,
  Spawn: 3,
  Pen: 4,
  Door: 5,
  Exit: 6,
  Slot: 7,
  Pad: 8,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export type EnemyId = 'latency' | 'throttle' | 'coldstart' | 'outage';

/** CATALOG_ORDER = services.json array order = this union's order. */
export type PowerKind = 'lambda' | 'shield' | 'autoscaling' | 'cloudfront' | 'cloudwatch';

export type Phase = 'ready' | 'playing' | 'dying' | 'levelClear' | 'gameOver';

export type GameOverReason = 'caught' | 'timeLimit' | 'qa';

export interface Mover {
  tile: Vec;
  dir: Dir;
  /** 0..255 units toward `tile + dir` (256 units = one tile). */
  progress: number;
}

export interface GameConfig {
  /** Default 3, integer 1..9. */
  startLives: number;
  /** Tests only: overrides `levelFor(L)` for every level. */
  maze?: readonly string[];
}

/** All lists are row-major (y, then x). */
export interface Maze {
  w: number;
  h: number;
  cells: Tile[];
  spawn: Vec;
  exit: Vec;
  pen: Vec[];
  slots: Vec[];
  pads: Vec[];
}

export type MazeError =
  | { kind: 'bad_size'; w: number; h: number }
  | { kind: 'bad_char'; x: number; y: number; ch: string }
  | { kind: 'border_open'; x: number; y: number }
  | { kind: 'count'; tile: 'P' | 'X' | 'E' | 'U' | 'W'; found: number }
  | { kind: 'unreachable_bug'; x: number; y: number }
  | { kind: 'exit_not_above_door'; x: number; y: number }
  | { kind: 'unreachable_tile'; tile: 'U' | 'W'; x: number; y: number };

export type GameEvent =
  | { type: 'bug'; at: Vec; by: 'player' | 'clone' }
  | { type: 'powerUpSpawn'; kind: PowerKind; at: Vec }
  | { type: 'powerUpPickup'; kind: PowerKind }
  | { type: 'shieldBlock'; enemy: EnemyId }
  | { type: 'death'; enemy: EnemyId }
  | { type: 'levelClear'; level: number; bonus: number }
  | { type: 'gameOver'; reason: GameOverReason }
  | { type: 'cloneSpawn'; at: Vec }
  | { type: 'warp'; from: number; to: number };

export interface Player extends Mover {
  desired: Dir;
  /** Last non-zero direction the player moved in. */
  facing: Dir;
  invuln: number;
  /** Pad index the player arrived on by warp, or -1. */
  warpLock: number;
}

export interface ColdState {
  phase: 'frozen' | 'dash';
  timer: number;
}

export interface Enemy extends Mover {
  id: EnemyId;
  mode: 'pen' | 'active';
  releaseIn: number;
  target: Vec;
  cold?: ColdState;
}

export interface Pickup {
  kind: PowerKind;
  at: Vec;
  ttl: number;
}

export interface GameStats {
  bugsEaten: number;
  servicesUsed: Record<PowerKind, number>;
  shieldBlocks: number;
}

export interface GameState {
  seed: number;
  rng: Rng;
  tick: number;
  phase: Phase;
  phaseTimer: number;
  level: number;
  lives: number;
  score: number;
  maze: Maze;
  /** 0/1 per cell, row-major. A plain array so JSON equality works. */
  bugs: number[];
  bugsLeft: number;
  bugsEatenThisLevel: number;
  nextPickupThreshold: number;
  player: Player;
  clone: Mover | null;
  /** Always in ENEMY_ORDER. */
  enemies: Enemy[];
  pickup: Pickup | null;
  /** Remaining ticks per active power-up. */
  active: Partial<Record<PowerKind, number>>;
  stats: GameStats;
  lastKiller: EnemyId | null;
  gameOverReason: GameOverReason | null;
  events: GameEvent[];
  config: GameConfig;
}

/** Engine-local result type (the engine may only import from src/engine; src/shared/result.ts mirrors it). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
