import { DARK_RADIUS } from '../constants';
import { pick } from '../rng';
import { addDir } from '../movement';
import type { Dir, Enemy, GameState, Vec } from '../types';
import { candidateDirs } from './pathing';

/**
 * Outage: uniform random wander. Candidates are in DIR_ORDER and `pick` is called even with a single
 * candidate, so every decision consumes exactly one draw. With no candidates it stays and draws nothing.
 * Its target is the chosen next tile.
 */
export function decideOutage(state: GameState, enemy: Enemy): { dir: Dir | 0; target: Vec } {
  const candidates = candidateDirs(state.maze, enemy);
  if (candidates.length === 0) return { dir: 0, target: { x: enemy.tile.x, y: enemy.tile.y } };
  const dir = pick(state.rng, candidates);
  return { dir, target: addDir(enemy.tile, dir) };
}

/** Every tile within Manhattan distance 4 of a released Outage is dark. False while Outage is in the pen. */
export function isDark(state: GameState, x: number, y: number): boolean {
  const outage = state.enemies.find((e) => e.id === 'outage');
  if (outage === undefined || outage.mode === 'pen') return false;
  return Math.abs(x - outage.tile.x) + Math.abs(y - outage.tile.y) <= DARK_RADIUS;
}
