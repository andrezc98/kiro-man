import { ENEMY_ORDER, SHIELD_RELEASE_TICKS, difficulty } from '../constants';
import { advanceMover } from '../movement';
import type { Dir, Enemy, EnemyId, GameState, Maze, Vec } from '../types';
import { coldStartTarget, decideColdStart, initialCold, tickCold } from './coldStart';
import { decideLatency } from './latency';
import { decideOutage } from './outage';
import { decideThrottle, throttleTarget } from './throttle';

export { candidateDirs, clampToGrid, greedyDir } from './pathing';
export { decideLatency, latencyTarget } from './latency';
export { decideThrottle, throttleTarget } from './throttle';
export { coldStartTarget, decideColdStart, initialCold, tickCold } from './coldStart';
export { decideOutage, isDark } from './outage';

type Decision = { dir: Dir | 0; target: Vec };

const DECIDERS: Readonly<Record<EnemyId, (state: GameState, enemy: Enemy) => Decision>> = {
  latency: decideLatency,
  throttle: decideThrottle,
  coldstart: decideColdStart,
  outage: decideOutage,
};

/** Enemy `i` in ENEMY_ORDER lives at the row-major pen tile `maze.pen[i]`. */
export function homeOf(maze: Maze, id: EnemyId): Vec {
  const home = maze.pen[ENEMY_ORDER.indexOf(id)] as Vec;
  return { x: home.x, y: home.y };
}

/** A fresh enemy waiting at home in the pen. */
export function penEnemy(maze: Maze, id: EnemyId, releaseIn: number): Enemy {
  const home = homeOf(maze, id);
  return { id, tile: home, dir: 0, progress: 0, mode: 'pen', releaseIn, target: { x: home.x, y: home.y } };
}

/** Reset-table enemies for a level: all home, release delays from `difficulty(level)`. */
export function createEnemies(maze: Maze, level: number): Enemy[] {
  const delays = difficulty(level).releaseDelays;
  return ENEMY_ORDER.map((id) => penEnemy(maze, id, delays[id]));
}

/** Shield block: back home in the pen with `releaseIn = 120` and no Cold Start state. */
export function sendHome(state: GameState, enemy: Enemy): void {
  const home = homeOf(state.maze, enemy.id);
  enemy.tile = home;
  enemy.dir = 0;
  enemy.progress = 0;
  enemy.mode = 'pen';
  enemy.releaseIn = SHIELD_RELEASE_TICKS;
  enemy.target = { x: home.x, y: home.y };
  delete enemy.cold;
}

function release(state: GameState, enemy: Enemy): void {
  enemy.tile = { x: state.maze.exit.x, y: state.maze.exit.y };
  enemy.dir = 0;
  enemy.progress = 0;
  enemy.mode = 'active';
  if (enemy.id === 'coldstart') enemy.cold = initialCold(state.level);
}

/** The live target shown by CloudWatch. Outage keeps the target of its last decision. */
function refreshTarget(state: GameState, enemy: Enemy): void {
  if (enemy.id === 'latency') enemy.target = { x: state.player.tile.x, y: state.player.tile.y };
  else if (enemy.id === 'throttle') enemy.target = throttleTarget(state);
  else if (enemy.id === 'coldstart') enemy.target = coldStartTarget(state, enemy);
}

function moveEnemy(state: GameState, enemy: Enemy, speed: number): void {
  const decide = DECIDERS[enemy.id];
  advanceMover(state.maze, enemy, speed, () => {
    const d = decide(state, enemy);
    enemy.target = d.target;
    return d.dir;
  });
}

/**
 * Phase (6): every enemy in ENEMY_ORDER. Pen countdown and release (a pen enemy with `releaseIn === 0`
 * releases this step; otherwise `releaseIn -= 1`, releasing in the same step if it reaches 0), then the AI
 * decides at centers and advances. Cold Start: decrement → toggle → decide/advance (not on its release step).
 */
export function updateEnemies(state: GameState): void {
  const speeds = difficulty(state.level).speeds;
  for (const enemy of state.enemies) {
    let releasedNow = false;
    if (enemy.mode === 'pen') {
      if (enemy.releaseIn > 0) enemy.releaseIn -= 1;
      if (enemy.releaseIn > 0) continue;
      release(state, enemy);
      releasedNow = true;
    }
    if (enemy.id === 'coldstart') {
      const cold = enemy.cold ?? initialCold(state.level);
      enemy.cold = cold;
      if (!releasedNow) tickCold(cold, state.level);
      if (cold.phase === 'frozen') {
        enemy.target = coldStartTarget(state, enemy);
        continue;
      }
    }
    refreshTarget(state, enemy);
    moveEnemy(state, enemy, speeds[enemy.id]);
  }
}
