import { THROTTLE_LOOKAHEAD } from '../constants';
import { DIR_VEC } from '../input';
import type { Dir, Enemy, GameState, Vec } from '../types';
import { clampToGrid, greedyDir } from './pathing';

/** Throttle: cut-off target `player.tile + 4 × facing`, clamped to the grid (may be a wall). */
export function throttleTarget(state: GameState): Vec {
  const p = state.player;
  const v = DIR_VEC[p.facing] as Vec;
  return clampToGrid(state.maze, {
    x: p.tile.x + THROTTLE_LOOKAHEAD * v.x,
    y: p.tile.y + THROTTLE_LOOKAHEAD * v.y,
  });
}

export function decideThrottle(state: GameState, enemy: Enemy): { dir: Dir | 0; target: Vec } {
  const target = throttleTarget(state);
  return { dir: greedyDir(state.maze, enemy, target), target };
}
