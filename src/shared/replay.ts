/**
 * Server-grade replay of an input log (overview §5.9, binding). The client recorder applies the same rule,
 * so client and server agree tick for tick. Shared by the browser, the Lambda and the MCP server.
 */
import { MAX_TICKS, createGame, step } from '../engine';
import type { Dir, GameConfig, GameState, InputLog } from '../engine';

export interface ReplayOpts {
  maxTicks?: number;
  startLives?: number;
  /** Tests only (same as `GameConfig.maze`): the walled-off time-limit and perf cases. Never set by servers. */
  maze?: readonly string[];
}

function gameConfig(opts: ReplayOpts): Partial<GameConfig> {
  const cfg: Partial<GameConfig> = {};
  if (opts.startLives !== undefined) cfg.startLives = opts.startLives;
  if (opts.maze !== undefined) cfg.maze = [...opts.maze];
  return cfg;
}

export interface ReplayResult {
  status: 'complete' | 'timeout';
  score: number;
  level: number;
  ticks: number;
  finalState: GameState;
}

export function replay(seed: number, log: InputLog, opts: ReplayOpts = {}): ReplayResult {
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const s = createGame(seed, gameConfig(opts));
  let i = 0;
  let held: Dir = 0;
  while (s.phase !== 'gameOver' && s.tick < maxTicks) {
    // Same rule as the client recorder: apply every event recorded for this tick before stepping it.
    while (i < log.length && log[i]![0] === s.tick) {
      held = log[i]![1];
      i++;
    }
    step(s, held);
  }
  return {
    status: s.phase === 'gameOver' ? 'complete' : 'timeout',
    score: s.score,
    level: s.level,
    ticks: s.tick,
    finalState: s,
  };
}

export type ValidateReplayResult =
  | { ok: true; score: number; level: number }
  | { ok: false; reason: 'replay_incomplete' | 'replay_mismatch'; replayedScore: number };

/**
 * Accepts iff the replay is `complete` and its score equals `claimedScore`.
 * `replay_incomplete` (status `timeout`) takes precedence over `replay_mismatch`.
 */
export function validateReplay(
  sub: { seed: number; inputLog: InputLog; claimedScore: number },
  opts: ReplayOpts = {},
): ValidateReplayResult {
  const r = replay(sub.seed, sub.inputLog, opts);
  if (r.status !== 'complete') return { ok: false, reason: 'replay_incomplete', replayedScore: r.score };
  if (r.score !== sub.claimedScore) return { ok: false, reason: 'replay_mismatch', replayedScore: r.score };
  return { ok: true, score: r.score, level: r.level };
}
