/**
 * App-side game-over detection (binding, overview §6). After every `engine.step` and every QA mutator
 * call, `main.ts` calls `checkGameOver`; it fires exactly once per game, based on the phase rather than
 * on `state.events` (a QA `forceGameOver` event is cleared by the next step).
 */
import type { GameSummary } from '../arcade/cabinet';
import type { GameState, InputLog } from '../engine';

export interface Session {
  gameOverSent: boolean;
  /** Set by any QA mutator; a tainted game is never submitted remotely (overview §9.7). */
  tainted: boolean;
}

export function createSession(): Session {
  return { gameOverSent: false, tainted: false };
}

/** Called when a `startEngine` effect creates a new game. */
export function resetForNewGame(session: Session): void {
  session.gameOverSent = false;
  session.tainted = false;
}

/** True exactly once per game: the first call that sees `phase === 'gameOver'` (and marks the session). */
export function checkGameOver(state: GameState, session: Session): boolean {
  if (state.phase !== 'gameOver' || session.gameOverSent) return false;
  session.gameOverSent = true;
  return true;
}

/** The cabinet's `gameOver` payload for a finished game. */
export function summarize(state: GameState, inputLog: InputLog, tainted: boolean): GameSummary {
  return {
    seed: state.seed,
    score: state.score,
    level: state.level,
    bugsEaten: state.stats.bugsEaten,
    servicesUsed: { ...state.stats.servicesUsed },
    lastKiller: state.lastKiller,
    gameOverReason: state.gameOverReason ?? 'caught',
    inputLog: inputLog.map(([t, d]) => [t, d]),
    tainted,
  };
}
