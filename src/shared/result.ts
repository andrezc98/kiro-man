/**
 * `Result<T, E>` shared by the browser adapters, the Lambda core and the MCP tools (leaderboard design).
 * The engine may only import from src/engine, so the type itself is defined in `src/engine/types.ts`
 * and re-exported here unchanged.
 */
import type { Result } from '../engine/types';

export type { Result };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
