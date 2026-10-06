import { SCORE_BUG } from './constants';
import type { GameState, Vec } from './types';

export function addScore(state: GameState, pts: number): void {
  state.score += pts;
}

/**
 * Eats the bug at `at` if one is there: +10, counters updated (the clone's bugs count toward
 * `bugsEatenThisLevel` too), and a `bug` event. Returns true when a bug was eaten.
 */
export function eatBugAt(state: GameState, at: Vec, by: 'player' | 'clone'): boolean {
  const { maze } = state;
  if (at.x < 0 || at.y < 0 || at.x >= maze.w || at.y >= maze.h) return false;
  const idx = at.y * maze.w + at.x;
  if (state.bugs[idx] !== 1) return false;
  state.bugs[idx] = 0;
  state.bugsLeft -= 1;
  state.bugsEatenThisLevel += 1;
  state.stats.bugsEaten += 1;
  addScore(state, SCORE_BUG);
  state.events.push({ type: 'bug', at: { x: at.x, y: at.y }, by });
  return true;
}
