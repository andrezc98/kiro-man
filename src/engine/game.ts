import {
  CATALOG_ORDER,
  DEFAULT_START_LIVES,
  LAMBDA_SPEED,
  LEVEL_CLEAR_BONUS_PER_LEVEL,
  LEVEL_CLEAR_TICKS,
  MAX_START_LIVES,
  MAX_TICKS,
  MIN_START_LIVES,
  PLAYER_SPEED,
  READY_TICKS,
  FIRST_PICKUP_THRESHOLD,
} from './constants';
import { capturePrevOcc, resolveCollisions } from './collision';
import { createEnemies, updateEnemies } from './enemies';
import { reverse } from './input';
import { LEVELS, levelFor } from './levels';
import { initialBugs, loadMazeOrThrow } from './maze';
import { advanceMover, occupiedTile, playerDecide, reverseMidTile } from './movement';
import {
  collectPickup,
  isActive,
  maybeSpawnPickup,
  tickPickup,
  tickPowerUps,
  updateClone,
  warpCheck,
} from './powerups';
import { createRng } from './rng';
import { addScore, eatBugAt } from './scoring';
import type { Dir, GameConfig, GameState, Maze, PowerKind } from './types';

export { isDark } from './enemies';

function mazeForLevel(config: GameConfig, level: number): Maze {
  return loadMazeOrThrow(config.maze ?? levelFor(level).ascii);
}

function zeroServices(): Record<PowerKind, number> {
  const out = {} as Record<PowerKind, number>;
  for (const k of CATALOG_ORDER) out[k] = 0;
  return out;
}

/** Reset table (life start and level start). Bugs are untouched. */
function resetPositions(state: GameState): void {
  const spawn = state.maze.spawn;
  state.player = {
    tile: { x: spawn.x, y: spawn.y },
    dir: 0,
    progress: 0,
    desired: 0,
    facing: 0,
    invuln: 0,
    warpLock: -1,
  };
  state.enemies = createEnemies(state.maze, state.level);
  state.active = {};
  state.clone = null;
  state.pickup = null;
}

/** Level start: load the layout for `state.level`, reload bugs, reset counters and positions. */
function startLevel(state: GameState): void {
  state.maze = mazeForLevel(state.config, state.level);
  state.bugs = initialBugs(state.maze);
  state.bugsLeft = state.bugs.reduce((n, b) => n + b, 0);
  state.bugsEatenThisLevel = 0;
  state.nextPickupThreshold = FIRST_PICKUP_THRESHOLD;
  resetPositions(state);
}

/**
 * Initial state (binding): phase `ready`, `phaseTimer = 120`, tick 0, level 1, `lives = startLives`, score 0,
 * no events, reset table applied. Throws `RangeError` for `startLives` outside integer 1..9 and
 * `InvalidMazeError` for an invalid maze (shipped layouts are all validated here).
 */
export function createGame(seed: number, config: Partial<GameConfig> = {}): GameState {
  const startLives = config.startLives ?? DEFAULT_START_LIVES;
  if (!Number.isInteger(startLives) || startLives < MIN_START_LIVES || startLives > MAX_START_LIVES) {
    throw new RangeError(`startLives must be an integer in ${MIN_START_LIVES}..${MAX_START_LIVES}, got ${startLives}`);
  }
  const cfg: GameConfig = config.maze === undefined ? { startLives } : { startLives, maze: [...config.maze] };
  if (cfg.maze === undefined) {
    for (const level of LEVELS) loadMazeOrThrow(level.ascii);
  }
  const s = seed >>> 0;
  const maze = mazeForLevel(cfg, 1);
  const state: GameState = {
    seed: s,
    rng: createRng(s),
    tick: 0,
    phase: 'ready',
    phaseTimer: READY_TICKS,
    level: 1,
    lives: startLives,
    score: 0,
    maze,
    bugs: [],
    bugsLeft: 0,
    bugsEatenThisLevel: 0,
    nextPickupThreshold: FIRST_PICKUP_THRESHOLD,
    player: { tile: { x: 0, y: 0 }, dir: 0, progress: 0, desired: 0, facing: 0, invuln: 0, warpLock: -1 },
    clone: null,
    enemies: [],
    pickup: null,
    active: {},
    stats: { bugsEaten: 0, servicesUsed: zeroServices(), shieldBlocks: 0 },
    lastKiller: null,
    gameOverReason: null,
    events: [],
    config: cfg,
  };
  startLevel(state);
  return state;
}

/** Phase (4): invuln decrement, mid-tile reversal, advance, eat, collect, warp check. */
function playerPhase(state: GameState): void {
  const p = state.player;
  p.invuln = Math.max(0, p.invuln - 1);
  let tileChanged = false;
  if (p.progress > 0 && p.dir !== 0 && p.desired === reverse(p.dir)) tileChanged = reverseMidTile(p);
  const speed = isActive(state, 'lambda') ? LAMBDA_SPEED : PLAYER_SPEED;
  if (advanceMover(state.maze, p, speed, playerDecide(state.maze, p.desired))) tileChanged = true;
  if (p.dir !== 0) p.facing = p.dir;
  eatBugAt(state, occupiedTile(p), 'player');
  collectPickup(state);
  warpCheck(state, tileChanged);
}

/** Binding 11-phase playing step, phases (2)..(9). */
function playingStep(state: GameState): void {
  tickPowerUps(state);
  const prev = capturePrevOcc(state);
  playerPhase(state);
  updateClone(state);
  updateEnemies(state);
  resolveCollisions(state, prev);
  const spawned = maybeSpawnPickup(state);
  tickPickup(state, spawned);
  if (state.phase === 'playing' && state.bugsLeft === 0) {
    const bonus = LEVEL_CLEAR_BONUS_PER_LEVEL * state.level;
    addScore(state, bonus);
    state.phase = 'levelClear';
    state.phaseTimer = LEVEL_CLEAR_TICKS;
    state.events.push({ type: 'levelClear', level: state.level, bonus });
    state.active = {};
    state.clone = null;
    state.pickup = null;
  }
}

/** Non-playing phases: count down; at 0 the transition happens in this same step. */
function timedPhaseStep(state: GameState): void {
  state.phaseTimer -= 1;
  if (state.phaseTimer > 0) return;
  state.phaseTimer = 0;
  if (state.phase === 'ready') {
    state.phase = 'playing';
  } else if (state.phase === 'dying') {
    if (state.lives <= 0) {
      state.phase = 'gameOver';
      state.gameOverReason = 'caught';
      state.events.push({ type: 'gameOver', reason: 'caught' });
    } else {
      resetPositions(state);
      state.phase = 'ready';
      state.phaseTimer = READY_TICKS;
    }
  } else if (state.phase === 'levelClear') {
    state.level += 1;
    startLevel(state);
    state.phase = 'ready';
    state.phaseTimer = READY_TICKS;
  }
}

function isGameOver(state: GameState): boolean {
  return state.phase === 'gameOver';
}

/** Advances the simulation by exactly one 60 Hz tick, mutating `state` in place. */
export function step(state: GameState, input: Dir): void {
  state.events = [];
  // A gameOver-phase step changes nothing but `events` and `tick` (GE-7.3), so the input rule is moot there.
  if (state.phase === 'gameOver') {
    state.tick += 1;
    return;
  }
  if (input !== 0) state.player.desired = input;
  if (state.phase === 'playing') playingStep(state);
  else timedPhaseStep(state);
  // Phase (10): the time limit, checked in every phase (the phase may have changed above).
  if (!isGameOver(state) && state.tick === MAX_TICKS - 1) {
    state.phase = 'gameOver';
    state.lastKiller = null;
    state.gameOverReason = 'timeLimit';
    state.events.push({ type: 'gameOver', reason: 'timeLimit' });
  }
  state.tick += 1;
}

/** QA: ends the game immediately (called between steps; the next step clears the event). */
export function forceGameOver(state: GameState): void {
  state.lives = 0;
  state.phase = 'gameOver';
  state.gameOverReason = 'qa';
  state.lastKiller = null;
  state.events.push({ type: 'gameOver', reason: 'qa' });
}

/** Deep copy; continuing the copy gives the same results as continuing the original. */
export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}
