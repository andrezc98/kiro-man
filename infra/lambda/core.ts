/**
 * The score API core (LB-5, LB-6, overview §7.4). It owns routing, the body-size cap, schema validation,
 * replay validation and status mapping. Storage, clock, ids and logging are injected, and nothing here
 * imports the AWS SDK, so every status code is unit tested from the root Vitest run.
 */
import { MAX_ENTRIES, normalize } from '../../src/leaderboard/ranking';
import type { ScoreEntry } from '../../src/leaderboard/ranking';
import { validateReplay } from '../../src/shared/replay';
import type { ReplayOpts } from '../../src/shared/replay';
import { parseSubmission } from '../../src/shared/submission';
import type { FieldError } from '../../src/shared/submission';

export type StoredScore = ScoreEntry & { createdAt: string; id: string };

export interface ScoreStore {
  put(e: StoredScore): Promise<void>;
  /** Highest scores first, at most `n`. */
  top(n: number): Promise<ScoreEntry[]>;
}

export interface HttpReq {
  method: string;
  path: string;
  body: string | null;
  isBase64Encoded: boolean;
}

export interface HttpRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void;

export interface CoreDeps {
  store: ScoreStore;
  /** ISO-8601 timestamp for `createdAt`. */
  now: () => string;
  uuid: () => string;
  log: Logger;
  maxBodyBytes: number;
  /**
   * Tests only: replay options (a small `maxTicks` is the only way to reach `replay_incomplete`, because
   * the engine always ends an honest game by `MAX_TICKS`). The deployed handler never sets it.
   */
  replayOpts?: ReplayOpts;
}

export const DEFAULT_MAX_BODY_BYTES = 131072;
export const SCORES_PATH = '/scores';

/** One JSON line per log record; request bodies are never passed in. */
export function jsonLogger(write: (line: string) => void): Logger {
  return (level, msg, fields = {}) => write(JSON.stringify({ level, msg, ...fields }));
}

function json(statusCode: number, body: unknown): HttpRes {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'UnknownError';
}

async function getScores(deps: CoreDeps): Promise<HttpRes> {
  try {
    const raw = await deps.store.top(MAX_ENTRIES);
    // Stored data goes through the ranking choke point too (LB-2.1): sorted, <= 10, valid initials only.
    return json(200, { scores: normalize(raw).list });
  } catch (e) {
    deps.log('error', 'storage read failed', { error: errorName(e) });
    return json(503, { error: 'storage_unavailable' });
  }
}

function invalid(deps: CoreDeps, details: FieldError[]): HttpRes {
  deps.log('info', 'invalid request', { fields: details.map((d) => d.field) });
  return json(400, { error: 'invalid_request', details });
}

async function postScore(req: HttpReq, deps: CoreDeps): Promise<HttpRes> {
  const raw = req.body ?? '';
  const decoded = req.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  // HTTP API's 10 MB payload cap can't be lowered, so the size limit is enforced here, after decoding (LB-5.1).
  if (decoded.byteLength > deps.maxBodyBytes) {
    deps.log('info', 'payload too large', { bytes: decoded.byteLength, maxBodyBytes: deps.maxBodyBytes });
    return json(413, { error: 'payload_too_large' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    return invalid(deps, [{ field: '(root)', message: 'body is not valid JSON' }]);
  }
  const sub = parseSubmission(parsed);
  if (!sub.ok) return invalid(deps, sub.error);

  const { initials, seed, inputLog, claimedScore } = sub.value;
  const verdict = validateReplay({ seed, inputLog, claimedScore }, deps.replayOpts);
  if (!verdict.ok) {
    deps.log('warn', verdict.reason, { seed, claimedScore, replayedScore: verdict.replayedScore, events: inputLog.length });
    return json(422, { error: verdict.reason });
  }

  const entry: StoredScore = { initials, score: verdict.score, level: verdict.level, createdAt: deps.now(), id: deps.uuid() };
  try {
    await deps.store.put(entry);
  } catch (e) {
    deps.log('error', 'storage write failed', { error: errorName(e) });
    return json(503, { error: 'storage_unavailable' });
  }
  deps.log('info', 'score accepted', { score: entry.score, level: entry.level, events: inputLog.length });
  return json(201, { accepted: true, score: entry.score, level: entry.level });
}

/**
 * `GET /scores` → 200 top 10; `POST /scores` → submission path; any other method on `/scores` → 405;
 * any other path (including `/scores/`) → 404. CORS preflight is answered by API Gateway, not here.
 */
export async function handle(req: HttpReq, deps: CoreDeps): Promise<HttpRes> {
  const method = req.method.toUpperCase();
  if (req.path !== SCORES_PATH) {
    deps.log('info', 'not found', { method, path: req.path });
    return json(404, { error: 'not_found' });
  }
  if (method === 'GET') return getScores(deps);
  if (method === 'POST') return postScore(req, deps);
  deps.log('info', 'method not allowed', { method });
  return json(405, { error: 'method_not_allowed' });
}
