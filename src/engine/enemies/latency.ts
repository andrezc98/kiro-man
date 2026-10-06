import { bfsNextStep } from '../maze';
import type { Dir, Enemy, GameState, Vec } from '../types';

/** Latency: slow, direct BFS pursuit of the player's tile. */
export function latencyTarget(state: GameState): Vec {
  return { x: state.player.tile.x, y: state.player.tile.y };
}

export function decideLatency(state: GameState, enemy: Enemy): { dir: Dir | 0; target: Vec } {
  const target = latencyTarget(state);
  return { dir: bfsNextStep(state.maze, enemy.tile, target), target };
}
