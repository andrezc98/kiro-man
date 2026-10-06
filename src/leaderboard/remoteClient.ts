/**
 * Remote leaderboard client (LB-7, overview §7.2). `fetch` and the timeout signal are injected so it is
 * testable without a network. Never throws: every failure is a `RemoteErr`.
 *
 * Binding status mapping for `submit`: any 2xx whose body matches `{accepted: true, score: int,
 * level: int}` (extra fields allowed) is ok; any other 2xx is `bad_response`; 400/413/422 are
 * `rejected` with `body.error`; other non-2xx are `http`; a thrown fetch is `network`; an abort is
 * `timeout`; a body that is not JSON is `bad_response`.
 */
import { err, ok } from '../shared/result';
import type { Result } from '../shared/result';
import type { Submission } from '../shared/submission';
import { normalize } from './ranking';
import type { ScoreEntry } from './ranking';

export type RemoteErr =
  | { kind: 'network' | 'timeout' | 'http'; status?: number }
  | { kind: 'bad_response' }
  | { kind: 'rejected'; error: string };

export const REMOTE_TIMEOUT_MS = 3000;
const REJECTED_STATUSES: readonly number[] = [400, 413, 422];

export interface RemoteClientOpts {
  apiUrl: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  /** Abort-signal factory; defaults to `AbortSignal.timeout`. */
  timeoutSignal?: (ms: number) => AbortSignal;
}

export interface RemoteClient {
  getTop(): Promise<Result<ScoreEntry[], RemoteErr>>;
  submit(s: Submission): Promise<Result<{ score: number; level: number }, RemoteErr>>;
}

/** Thrown inside a request to short-circuit to a mapped error. */
class Mapped {
  constructor(readonly error: RemoteErr) {}
}

const BAD_BODY = Symbol('bad body');

function isAbort(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function createRemoteClient(opts: RemoteClientOpts): RemoteClient {
  const base = opts.apiUrl.replace(/\/+$/, '');
  const url = `${base}/scores`;
  const timeoutMs = opts.timeoutMs ?? REMOTE_TIMEOUT_MS;
  const makeSignal = opts.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
  const doFetch = opts.fetch;

  /** Runs one request; the body is read inside the same timeout window. */
  async function request(init: RequestInit): Promise<{ status: number; body: unknown }> {
    const signal = makeSignal(timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal });
    } catch (e) {
      throw new Mapped(isAbort(e, signal) ? { kind: 'timeout' } : { kind: 'network' });
    }
    let body: unknown = BAD_BODY;
    try {
      body = await res.json();
    } catch (e) {
      if (isAbort(e, signal)) throw new Mapped({ kind: 'timeout' });
    }
    return { status: res.status, body };
  }

  async function guarded<T>(run: () => Promise<Result<T, RemoteErr>>): Promise<Result<T, RemoteErr>> {
    try {
      return await run();
    } catch (e) {
      return err(e instanceof Mapped ? e.error : { kind: 'network' });
    }
  }

  return {
    getTop: () =>
      guarded(async () => {
        const { status, body } = await request({ method: 'GET' });
        if (status < 200 || status > 299) return err({ kind: 'http', status });
        if (!isObject(body) || !Array.isArray(body.scores)) return err({ kind: 'bad_response' });
        return ok(normalize(body.scores).list);
      }),

    submit: (s: Submission) =>
      guarded(async () => {
        const { status, body } = await request({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initials: s.initials,
            seed: s.seed,
            inputLog: s.inputLog,
            claimedScore: s.claimedScore,
          }),
        });
        if (status >= 200 && status <= 299) {
          if (
            isObject(body) &&
            body.accepted === true &&
            Number.isInteger(body.score) &&
            Number.isInteger(body.level)
          ) {
            return ok({ score: body.score as number, level: body.level as number });
          }
          return err({ kind: 'bad_response' });
        }
        if (REJECTED_STATUSES.includes(status)) {
          const error = isObject(body) && typeof body.error === 'string' ? body.error : `http_${status}`;
          return err({ kind: 'rejected', error });
        }
        return err({ kind: 'http', status });
      }),
  };
}
