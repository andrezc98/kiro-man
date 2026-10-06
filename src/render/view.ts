/** What the renderer reads each frame. Render never mutates any of it (overview §4.1). */
import type { CabinetState } from '../arcade/cabinet';
import type { GameState } from '../engine';
import type { ScoreEntry } from '../leaderboard/ranking';

/** The global leaderboard panel: `disabled` when the session is offline (no config.json). */
export interface GlobalBoard {
  status: 'disabled' | 'loading' | 'ok' | 'offline';
  list: readonly ScoreEntry[];
}

export interface RenderView {
  cabinet: CabinetState;
  /** The current (or last finished) game, null before the first start. */
  game: GameState | null;
  local: readonly ScoreEntry[];
  global: GlobalBoard;
  paused: boolean;
  muted: boolean;
  /** A fatal boot problem (e.g. MAZE ERROR) shown instead of the cabinet. */
  fatal: string | null;
}

/** Maze origin: rows 0..1 (16 px) are the HUD, the 40x28 grid of 8 px tiles fills the rest. */
export const TILE_PX = 8;
export const MAZE_Y = 16;

/** Zero-padded score digits (at least 6). */
export function scoreText(n: number, digits = 6): string {
  return String(Math.max(0, Math.floor(n))).padStart(digits, '0');
}

/** The high score shown in the HUD and attract: the best of the local table and the current score. */
export function highScore(local: readonly ScoreEntry[], current: number): number {
  return local.reduce((m, e) => Math.max(m, e.score), current);
}
