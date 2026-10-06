import { HALF_TILE, TILE_UNITS } from './constants';
import { DIR_VEC, reverse } from './input';
import { canStep } from './maze';
import type { Dir, Maze, Mover, Vec } from './types';

/** Decision callback, called at every tile center the mover passes or stands on. */
export type Decide = (m: Mover) => Dir | 0;

export function addDir(t: Vec, d: Dir): Vec {
  const v = DIR_VEC[d] as Vec;
  return { x: t.x + v.x, y: t.y + v.y };
}

/** `occ(m) = progress < 128 ? tile : tile + dir`. */
export function occupiedTile(m: Mover): Vec {
  return m.progress < HALF_TILE ? { x: m.tile.x, y: m.tile.y } : addDir(m.tile, m.dir);
}

/**
 * The core fixed-point step (the only code that moves a mover between tiles).
 *
 * - At a center (`progress === 0`) the mover asks `decide` and starts moving only toward a passable tile;
 *   otherwise it stops with `dir = 0`.
 * - On `progress >= 256`: `tile += dir`, `progress -= 256`. With leftover progress the mover re-decides at the
 *   new center and keeps the leftover only if the new direction is passable; otherwise it stops at the center.
 *   With zero leftover it stays at the center keeping `dir`, and decides on its next call.
 *
 * Speeds are < 256, so a single call crosses at most one tile boundary. Returns true when `tile` changed.
 */
export function advanceMover(maze: Maze, m: Mover, speed: number, decide: Decide): boolean {
  if (speed <= 0) return false;
  if (m.progress === 0) {
    const d = decide(m);
    if (d === 0 || !canStep(maze, m.tile, d)) {
      m.dir = 0;
      return false;
    }
    m.dir = d;
  }
  if (m.dir === 0) {
    m.progress = 0;
    return false;
  }
  m.progress += speed;
  if (m.progress < TILE_UNITS) return false;
  m.tile = addDir(m.tile, m.dir);
  const leftover = m.progress - TILE_UNITS;
  m.progress = 0;
  if (leftover > 0) {
    const d = decide(m);
    if (d !== 0 && canStep(maze, m.tile, d)) {
      m.dir = d;
      m.progress = leftover;
    } else {
      m.dir = 0;
    }
  }
  return true;
}

/**
 * Mid-tile reversal: `tile = tile + dir`, `progress = 256 - progress`, `dir` flipped, so the on-screen
 * position is unchanged. Returns true when applied (the tile changed).
 */
export function reverseMidTile(m: Mover): boolean {
  if (m.dir === 0 || m.progress === 0) return false;
  m.tile = addDir(m.tile, m.dir);
  m.progress = TILE_UNITS - m.progress;
  m.dir = reverse(m.dir);
  return true;
}

/** Player decision at a center: buffered turn, else keep going, else stop. */
export function playerDecide(maze: Maze, desired: Dir): Decide {
  return (m) => {
    if (desired !== 0 && canStep(maze, m.tile, desired)) return desired;
    if (m.dir !== 0 && canStep(maze, m.tile, m.dir)) return m.dir;
    return 0;
  };
}
