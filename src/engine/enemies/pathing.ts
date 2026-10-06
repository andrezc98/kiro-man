import { DIR_ORDER, DIR_VEC, reverse } from '../input';
import { canStep } from '../maze';
import type { Dir, Maze, Mover, Vec } from '../types';

/**
 * Non-reverse passable directions in DIR_ORDER (U, L, D, R); the reverse only at a dead end.
 * `reverse(0) = 0`, so a mover with `dir = 0` gets every passable direction. Empty only for an enclosed tile.
 */
export function candidateDirs(maze: Maze, m: Mover): Dir[] {
  const back = reverse(m.dir);
  const out: Dir[] = [];
  for (const d of DIR_ORDER) {
    if (d !== back && canStep(maze, m.tile, d)) out.push(d);
  }
  if (out.length === 0 && back !== 0 && canStep(maze, m.tile, back)) out.push(back);
  return out;
}

/**
 * Greedy chooser: among the candidates, the direction whose neighbor tile minimizes the squared Euclidean
 * distance to `target`. Ties keep the earliest candidate (DIR_ORDER). Returns 0 with no candidates.
 */
export function greedyDir(maze: Maze, m: Mover, target: Vec): Dir | 0 {
  let best: Dir | 0 = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const d of candidateDirs(maze, m)) {
    const v = DIR_VEC[d] as Vec;
    const dx = m.tile.x + v.x - target.x;
    const dy = m.tile.y + v.y - target.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

export function clampToGrid(maze: Maze, v: Vec): Vec {
  return {
    x: Math.min(Math.max(v.x, 0), maze.w - 1),
    y: Math.min(Math.max(v.y, 0), maze.h - 1),
  };
}
