import { COLD_DASH_TICKS, difficulty } from '../constants';
import { bfsNextStep } from '../maze';
import type { ColdState, Dir, Enemy, GameState, Vec } from '../types';

/** Cold Start state right after release: frozen for `coldFrozen` ticks. */
export function initialCold(level: number): ColdState {
  return { phase: 'frozen', timer: difficulty(level).coldFrozen };
}

/** Phase-(6) turn bookkeeping: `timer -= 1`; at 0 toggle frozen ↔ dash and reset the timer for the new phase. */
export function tickCold(cold: ColdState, level: number): void {
  cold.timer -= 1;
  if (cold.timer > 0) return;
  if (cold.phase === 'frozen') {
    cold.phase = 'dash';
    cold.timer = COLD_DASH_TICKS;
  } else {
    cold.phase = 'frozen';
    cold.timer = difficulty(level).coldFrozen;
  }
}

/** Target: its own tile while frozen, the player's tile while dashing. */
export function coldStartTarget(state: GameState, enemy: Enemy): Vec {
  if (enemy.cold?.phase === 'dash') return { x: state.player.tile.x, y: state.player.tile.y };
  return { x: enemy.tile.x, y: enemy.tile.y };
}

/** Cold Start: frozen (never moves) or dashing along a BFS path to the player. */
export function decideColdStart(state: GameState, enemy: Enemy): { dir: Dir | 0; target: Vec } {
  const target = coldStartTarget(state, enemy);
  if (enemy.cold?.phase !== 'dash') return { dir: 0, target };
  return { dir: bfsNextStep(state.maze, enemy.tile, target), target };
}
