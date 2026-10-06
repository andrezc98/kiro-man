/**
 * arcade-operator tool handlers (overview §9.5). Pure-ish: `fetch`, `readFile`, the environment, the
 * working directory and the stderr logger are injected, so every handler is unit tested without a
 * network, a file system or a running MCP transport. `index.ts` only wires these to the MCP server.
 *
 * Real data: `scripts/screenshots.mjs` writes `mcp/arcade-operator/data/local-scores.json` (the browser's
 * normalized local top 10) and `data/sample-replay.json` (a real recorded game) after every headless run.
 */
import { resolve } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isValidApiUrl } from '../../../src/app/config';
import { CATALOG } from '../../../src/engine';
import { normalize } from '../../../src/leaderboard/ranking';
import type { ScoreEntry } from '../../../src/leaderboard/ranking';
import { createRemoteClient } from '../../../src/leaderboard/remoteClient';
import type { RemoteErr } from '../../../src/leaderboard/remoteClient';
import { replay } from '../../../src/shared/replay';
import type { ReplayOpts } from '../../../src/shared/replay';
import { parseReplayInput } from '../../../src/shared/submission';

export const DEFAULT_LOCAL_SCORES = 'mcp/arcade-operator/data/local-scores.json';
export const NO_LOCAL_FILE_NOTE = 'no local scores file';
export const LEADERBOARD_SOURCES = ['auto', 'remote', 'local'] as const;
export type LeaderboardSource = (typeof LEADERBOARD_SOURCES)[number];

export interface ToolDeps {
  fetch: typeof fetch;
  /** Reads a UTF-8 file; rejects with an `ENOENT` error code when it does not exist. */
  readFile: (path: string) => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  cwd: () => string;
  /** Diagnostics; the server routes this to stderr (stdout carries JSON-RPC). */
  log: (message: string) => void;
  /** Abort-signal factory for the 3 s remote timeout; defaults to `AbortSignal.timeout`. */
  timeoutSignal?: (ms: number) => AbortSignal;
}

function json(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function failure(message: string, payload: Record<string, unknown> = {}): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { error: message, ...payload },
    isError: true,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeRemoteErr(e: RemoteErr): string {
  switch (e.kind) {
    case 'http':
      return e.status === undefined ? 'http error' : `http ${e.status}`;
    case 'rejected':
      return `rejected: ${e.error}`;
    case 'bad_response':
      return 'bad response body';
    default:
      return e.kind;
  }
}

/** `KIROMAN_LOCAL_SCORES` if set and non-empty, else `<cwd>/mcp/arcade-operator/data/local-scores.json`. */
export function localScoresPath(deps: Pick<ToolDeps, 'env' | 'cwd'>): string {
  const configured = deps.env.KIROMAN_LOCAL_SCORES;
  if (configured !== undefined && configured.trim() !== '') return resolve(deps.cwd(), configured);
  return resolve(deps.cwd(), DEFAULT_LOCAL_SCORES);
}

type LocalRead =
  | { ok: true; scores: ScoreEntry[]; path: string; note?: string }
  | { ok: false; message: string; path: string };

async function readLocal(deps: ToolDeps): Promise<LocalRead> {
  const path = localScoresPath(deps);
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch (e) {
    if (isObject(e) && e.code === 'ENOENT') {
      deps.log(`get_leaderboard: ${NO_LOCAL_FILE_NOTE} at ${path}`);
      return { ok: true, scores: [], path, note: NO_LOCAL_FILE_NOTE };
    }
    return { ok: false, path, message: `cannot read local scores file ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, path, message: `local scores file ${path} is not valid JSON` };
  }
  // The file holds the normalized local list; a `{ scores: [...] }` wrapper (the API shape) is accepted too.
  const { list, dropped } = normalize(isObject(raw) && Array.isArray(raw.scores) ? raw.scores : raw);
  if (dropped > 0) {
    const note = `dropped ${dropped} invalid entr${dropped === 1 ? 'y' : 'ies'}`;
    deps.log(`get_leaderboard: ${note} from ${path}`);
    return { ok: true, scores: list, path, note };
  }
  return { ok: true, scores: list, path };
}

function localResult(r: Extract<LocalRead, { ok: true }>, fallbackNote?: string): CallToolResult {
  const notes = [fallbackNote, r.note].filter((n): n is string => n !== undefined);
  const payload: Record<string, unknown> = { source: 'local', path: r.path, scores: r.scores };
  if (notes.length > 0) payload.note = notes.join('; ');
  return json(payload);
}

/**
 * `get_leaderboard({ source = "auto" })`. Remote reads `KIROMAN_API_URL` + `/scores` (3 s timeout).
 * `auto` falls back to local (with a `note`) when the URL is missing or the remote fails; an explicit
 * `remote` failure is `isError`. A missing local file is an empty list with a note, not an error.
 */
export async function getLeaderboard(deps: ToolDeps, args: unknown): Promise<CallToolResult> {
  const source: unknown = isObject(args) && args.source !== undefined ? args.source : 'auto';
  if (typeof source !== 'string' || !(LEADERBOARD_SOURCES as readonly string[]).includes(source)) {
    return failure(`source must be one of ${LEADERBOARD_SOURCES.join(', ')}`);
  }
  const fromLocal = async (fallbackNote?: string): Promise<CallToolResult> => {
    const r = await readLocal(deps);
    return r.ok ? localResult(r, fallbackNote) : failure(r.message, { source: 'local', path: r.path });
  };
  if (source === 'local') return fromLocal();

  const apiUrl = (deps.env.KIROMAN_API_URL ?? '').trim();
  if (!isValidApiUrl(apiUrl)) {
    const why = apiUrl === '' ? 'KIROMAN_API_URL is not set' : 'KIROMAN_API_URL is not a valid http(s) URL';
    if (source === 'remote') return failure(`remote leaderboard unavailable: ${why}`, { source: 'remote' });
    deps.log(`get_leaderboard: ${why}; using local scores`);
    return fromLocal(`${why}; showing local scores`);
  }
  const client = createRemoteClient({
    apiUrl,
    fetch: deps.fetch,
    ...(deps.timeoutSignal === undefined ? {} : { timeoutSignal: deps.timeoutSignal }),
  });
  const top = await client.getTop();
  if (top.ok) return json({ source: 'remote', apiUrl, scores: top.value });
  const why = `remote leaderboard failed (${describeRemoteErr(top.error)})`;
  if (source === 'remote') return failure(why, { source: 'remote', apiUrl });
  deps.log(`get_leaderboard: ${why}; using local scores`);
  return fromLocal(`${why}; showing local scores`);
}

/**
 * `validate_replay({ seed, inputLog, claimedScore })`: the shared submission schema without initials,
 * then the same server-grade replay the Lambda runs. `status` uses the Lambda's vocabulary.
 * `opts` is for tests only (a small `maxTicks` makes `replay_incomplete` reachable); the server never sets it.
 */
export function validateReplayTool(args: unknown, opts: ReplayOpts = {}): CallToolResult {
  const parsed = parseReplayInput(args);
  if (!parsed.ok) {
    const lines = parsed.error.map((e) => `- ${e.field}: ${e.message}`);
    return failure(`invalid replay input:\n${lines.join('\n')}`, { errors: parsed.error });
  }
  const sub = parsed.value;
  const r = replay(sub.seed, sub.inputLog, opts);
  const complete = r.status === 'complete';
  const valid = complete && r.score === sub.claimedScore;
  const status = valid ? 'accepted' : complete ? 'replay_mismatch' : 'replay_incomplete';
  return json({
    valid,
    status,
    replayedScore: r.score,
    claimedScore: sub.claimedScore,
    level: r.level,
    ticks: r.ticks,
  });
}

/** `list_power_ups()`: the validated `src/content/services.json` catalog, in `CATALOG_ORDER`. */
export function listPowerUps(): CallToolResult {
  return json({ powerUps: CATALOG.map((d) => ({ ...d })) });
}
