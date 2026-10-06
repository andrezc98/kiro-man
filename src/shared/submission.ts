/**
 * The shared submission schema (LB-4, overview §7.3), used by the browser, the Lambda and the MCP
 * server. Parsing is total: any input gives a `Result` with field-level errors, never a throw.
 */
import { MAX_TICKS } from '../engine/constants';
import type { Dir, InputLog } from '../engine';
import { err, ok } from './result';
import type { Result } from './result';

export interface Submission {
  initials: string;
  seed: number;
  inputLog: InputLog;
  claimedScore: number;
}

export type ReplayInput = Omit<Submission, 'initials'>;

export interface FieldError {
  field: string;
  message: string;
}

export const MAX_LOG_EVENTS = 10000;
export const MAX_SEED = 4294967295;
export const MAX_CLAIMED_SCORE = 10000000;
const INITIALS_RE = /^[A-Z]{3}$/;

const SUBMISSION_KEYS = ['initials', 'seed', 'inputLog', 'claimedScore'] as const;
const REPLAY_KEYS = ['seed', 'inputLog', 'claimedScore'] as const;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isPlainObject(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null && !Array.isArray(u);
}

/** Validates the input log; stops at the first bad event so the error list stays small. */
function parseLog(v: unknown, errors: FieldError[]): InputLog {
  if (!Array.isArray(v)) {
    errors.push({ field: 'inputLog', message: 'must be an array' });
    return [];
  }
  if (v.length > MAX_LOG_EVENTS) {
    errors.push({ field: 'inputLog', message: `must have at most ${MAX_LOG_EVENTS} events` });
    return [];
  }
  const log: InputLog = [];
  let prev = -1;
  for (let i = 0; i < v.length; i++) {
    const item: unknown = v[i];
    const field = `inputLog[${i}]`;
    if (!Array.isArray(item) || item.length !== 2) {
      errors.push({ field, message: 'must be a [tick, dir] pair' });
      return [];
    }
    const [tick, dir] = item as [unknown, unknown];
    if (!isInt(tick, 0, MAX_TICKS - 1)) {
      errors.push({ field: `${field}[0]`, message: `tick must be an integer 0..${MAX_TICKS - 1}` });
      return [];
    }
    if (tick <= prev) {
      errors.push({ field: `${field}[0]`, message: 'ticks must be strictly increasing' });
      return [];
    }
    if (!isInt(dir, 0, 4)) {
      errors.push({ field: `${field}[1]`, message: 'dir must be an integer 0..4' });
      return [];
    }
    prev = tick;
    log.push([tick, dir as Dir]);
  }
  return log;
}

function parseFields(u: unknown, keys: readonly string[]): Result<Record<string, unknown>, FieldError[]> {
  if (!isPlainObject(u)) return err([{ field: '(root)', message: 'must be a JSON object' }]);
  const errors: FieldError[] = [];
  for (const k of Object.keys(u)) {
    if (!keys.includes(k)) errors.push({ field: k, message: 'unknown key' });
  }
  for (const k of keys) {
    if (!Object.hasOwn(u, k)) errors.push({ field: k, message: 'is required' });
  }
  return errors.length > 0 ? err(errors) : ok(u);
}

function parseCommon(o: Record<string, unknown>, errors: FieldError[]): ReplayInput {
  if (!isInt(o.seed, 0, MAX_SEED)) errors.push({ field: 'seed', message: `must be an integer 0..${MAX_SEED}` });
  const inputLog = parseLog(o.inputLog, errors);
  if (!isInt(o.claimedScore, 0, MAX_CLAIMED_SCORE)) {
    errors.push({ field: 'claimedScore', message: `must be an integer 0..${MAX_CLAIMED_SCORE}` });
  }
  return { seed: o.seed as number, inputLog, claimedScore: o.claimedScore as number };
}

/** A full leaderboard submission: exactly `initials`, `seed`, `inputLog`, `claimedScore`. */
export function parseSubmission(u: unknown): Result<Submission, FieldError[]> {
  const fields = parseFields(u, SUBMISSION_KEYS);
  if (!fields.ok) return fields;
  const o = fields.value;
  const errors: FieldError[] = [];
  if (typeof o.initials !== 'string' || !INITIALS_RE.test(o.initials)) {
    errors.push({ field: 'initials', message: 'must match ^[A-Z]{3}$' });
  }
  const common = parseCommon(o, errors);
  if (errors.length > 0) return err(errors);
  return ok({ initials: o.initials as string, ...common });
}

/** The MCP `validate_replay` input: the same rules without `initials` (exactly the other three keys). */
export function parseReplayInput(u: unknown): Result<ReplayInput, FieldError[]> {
  const fields = parseFields(u, REPLAY_KEYS);
  if (!fields.ok) return fields;
  const errors: FieldError[] = [];
  const common = parseCommon(fields.value, errors);
  return errors.length > 0 ? err(errors) : ok(common);
}
