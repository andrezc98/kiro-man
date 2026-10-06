import { describe, expect, it } from 'vitest';
import type { InputLog } from '../../src/engine/input';
import type { ScoreEntry } from '../../src/leaderboard/ranking';
import { DEFAULT_MAX_BODY_BYTES, handle, jsonLogger } from './core';
import type { CoreDeps, HttpReq, LogLevel, ScoreStore, StoredScore } from './core';

/** The golden route from `src/shared/replay.test.ts`: replays to score 400, level 1. */
const SEED = 0x4b49524f;
const LOG: InputLog = [
  [120, 4],
  [200, 3],
  [260, 2],
  [330, 1],
  [400, 4],
  [470, 3],
  [560, 2],
  [640, 1],
  [700, 0],
  [760, 2],
  [900, 3],
  [1000, 4],
];
const HONEST = { initials: 'KIR', seed: SEED, inputLog: LOG, claimedScore: 400 };

interface LogRecord {
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown> | undefined;
}

function fakeStore(opts: { top?: unknown[]; failTop?: boolean; failPut?: boolean } = {}) {
  const puts: StoredScore[] = [];
  const topCalls: number[] = [];
  const store: ScoreStore = {
    async put(e) {
      if (opts.failPut) throw Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
      puts.push(e);
    },
    async top(n) {
      topCalls.push(n);
      if (opts.failTop) throw Object.assign(new Error('down'), { name: 'InternalServerError' });
      return (opts.top ?? []) as ScoreEntry[];
    },
  };
  return { store, puts, topCalls };
}

function setup(storeOpts: Parameters<typeof fakeStore>[0] = {}, extra: Partial<CoreDeps> = {}) {
  const fake = fakeStore(storeOpts);
  const logs: LogRecord[] = [];
  const deps: CoreDeps = {
    store: fake.store,
    now: () => '2025-01-01T00:00:00.000Z',
    uuid: () => '00000000-0000-4000-8000-000000000001',
    log: (level, msg, fields) => logs.push({ level, msg, fields }),
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    ...extra,
  };
  return { ...fake, logs, deps };
}

function req(method: string, path: string, body: string | null = null, isBase64Encoded = false): HttpReq {
  return { method, path, body, isBase64Encoded };
}

const post = (body: string | null, isBase64Encoded = false) => req('POST', '/scores', body, isBase64Encoded);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const bodyOf = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;

describe('core.handle POST /scores', () => {
  it('201: stores the replay-verified entry exactly once', async () => {
    const t = setup();
    const res = await handle(post(JSON.stringify(HONEST)), t.deps);
    expect(res.statusCode).toBe(201);
    expect(bodyOf(res)).toEqual({ accepted: true, score: 400, level: 1 });
    expect(t.puts).toEqual([
      { initials: 'KIR', score: 400, level: 1, createdAt: '2025-01-01T00:00:00.000Z', id: '00000000-0000-4000-8000-000000000001' },
    ]);
    expect(t.logs.at(-1)).toMatchObject({ level: 'info', msg: 'score accepted' });
  });

  it('201: a base64-encoded body is decoded first', async () => {
    const t = setup();
    const res = await handle(post(b64(JSON.stringify(HONEST)), true), t.deps);
    expect(res.statusCode).toBe(201);
    expect(t.puts).toHaveLength(1);
  });

  it('422 replay_mismatch: a claim the replay does not reproduce is not stored', async () => {
    const t = setup();
    const res = await handle(post(JSON.stringify({ ...HONEST, claimedScore: 410 })), t.deps);
    expect(res.statusCode).toBe(422);
    expect(bodyOf(res)).toEqual({ error: 'replay_mismatch' });
    expect(t.puts).toHaveLength(0);
    expect(t.logs).toContainEqual({
      level: 'warn',
      msg: 'replay_mismatch',
      fields: { seed: SEED, claimedScore: 410, replayedScore: 400, events: LOG.length },
    });
  });

  it('422 replay_incomplete: a replay that does not reach game over is rejected and not stored', async () => {
    const t = setup({}, { replayOpts: { maxTicks: 100 } });
    const res = await handle(post(JSON.stringify(HONEST)), t.deps);
    expect(res.statusCode).toBe(422);
    expect(bodyOf(res)).toEqual({ error: 'replay_incomplete' });
    expect(t.puts).toHaveLength(0);
    expect(t.logs.at(-1)).toMatchObject({ level: 'warn', msg: 'replay_incomplete' });
  });

  it.each([
    ['malformed JSON', '{"initials":'],
    ['an empty body', ''],
    ['a missing body', null],
  ])('400 invalid_request: %s', async (_name, body) => {
    const t = setup();
    const res = await handle(post(body), t.deps);
    expect(res.statusCode).toBe(400);
    expect(bodyOf(res)).toEqual({ error: 'invalid_request', details: [{ field: '(root)', message: 'body is not valid JSON' }] });
    expect(t.puts).toHaveLength(0);
  });

  it('400 invalid_request: schema errors are returned as field-level details', async () => {
    const t = setup();
    const res = await handle(post(JSON.stringify({ ...HONEST, initials: 'abc', extra: 1 })), t.deps);
    expect(res.statusCode).toBe(400);
    const body = bodyOf(res);
    expect(body.error).toBe('invalid_request');
    expect(body.details).toEqual([{ field: 'extra', message: 'unknown key' }]);
    const bad = await handle(post(JSON.stringify({ ...HONEST, initials: 'abc' })), t.deps);
    expect(bodyOf(bad).details).toEqual([{ field: 'initials', message: 'must match ^[A-Z]{3}$' }]);
    expect(t.puts).toHaveLength(0);
  });

  it('400 logs field names only, never the request body', async () => {
    const t = setup();
    await handle(post(JSON.stringify({ ...HONEST, initials: 'zzz' })), t.deps);
    expect(t.logs).toEqual([{ level: 'info', msg: 'invalid request', fields: { fields: ['initials'] } }]);
    expect(JSON.stringify(t.logs)).not.toContain('zzz');
  });

  it('413 payload_too_large: a plain body over the limit is rejected before parsing', async () => {
    const t = setup();
    const res = await handle(post('x'.repeat(DEFAULT_MAX_BODY_BYTES + 1)), t.deps);
    expect(res.statusCode).toBe(413);
    expect(bodyOf(res)).toEqual({ error: 'payload_too_large' });
    expect(t.logs).toEqual([
      { level: 'info', msg: 'payload too large', fields: { bytes: DEFAULT_MAX_BODY_BYTES + 1, maxBodyBytes: DEFAULT_MAX_BODY_BYTES } },
    ]);
  });

  it('413 counts bytes, not characters', async () => {
    const t = setup();
    // 65537 two-byte characters: fewer characters than the limit, more bytes.
    const res = await handle(post('é'.repeat(DEFAULT_MAX_BODY_BYTES / 2 + 1)), t.deps);
    expect(res.statusCode).toBe(413);
  });

  it('a body of exactly the limit passes the size check', async () => {
    const t = setup();
    const json = JSON.stringify(HONEST);
    const res = await handle(post(json + ' '.repeat(DEFAULT_MAX_BODY_BYTES - json.length)), t.deps);
    expect(res.statusCode).toBe(201);
  });

  it('413 payload_too_large: a base64 body over the limit after decoding', async () => {
    const t = setup();
    const res = await handle(post(b64('x'.repeat(DEFAULT_MAX_BODY_BYTES + 1)), true), t.deps);
    expect(res.statusCode).toBe(413);
    expect(t.puts).toHaveLength(0);
  });

  it('a base64 body over the limit only while encoded is accepted (measured after decoding)', async () => {
    const t = setup();
    const json = JSON.stringify(HONEST);
    const decoded = json + ' '.repeat(DEFAULT_MAX_BODY_BYTES - json.length);
    const encoded = b64(decoded);
    expect(encoded.length).toBeGreaterThan(DEFAULT_MAX_BODY_BYTES);
    const res = await handle(post(encoded, true), t.deps);
    expect(res.statusCode).toBe(201);
  });

  it('503 storage_unavailable: a failed write is logged at error level with the AWS error name', async () => {
    const t = setup({ failPut: true });
    const res = await handle(post(JSON.stringify(HONEST)), t.deps);
    expect(res.statusCode).toBe(503);
    expect(bodyOf(res)).toEqual({ error: 'storage_unavailable' });
    expect(t.logs.at(-1)).toEqual({
      level: 'error',
      msg: 'storage write failed',
      fields: { error: 'ProvisionedThroughputExceededException' },
    });
  });
});

describe('core.handle GET /scores', () => {
  it('200: the top 10, highest first, through the ranking choke point', async () => {
    const stored = [
      { initials: 'AAA', score: 100, level: 1 },
      { initials: 'BBB', score: 900, level: 3 },
      { initials: 'bad', score: 5000, level: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ initials: 'CCC', score: 200 + i, level: 2, createdAt: 'x' })),
    ];
    const t = setup({ top: stored });
    const res = await handle(req('GET', '/scores'), t.deps);
    expect(res.statusCode).toBe(200);
    expect(t.topCalls).toEqual([10]);
    const scores = bodyOf(res).scores as ScoreEntry[];
    expect(scores).toHaveLength(10);
    expect(scores[0]).toEqual({ initials: 'BBB', score: 900, level: 3 });
    expect(scores.map((s) => s.score)).toEqual([900, 209, 208, 207, 206, 205, 204, 203, 202, 201]);
    expect(scores.every((s) => Object.keys(s).length === 3)).toBe(true);
  });

  it('200: an empty table gives an empty list', async () => {
    const t = setup();
    const res = await handle(req('GET', '/scores'), t.deps);
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ scores: [] });
  });

  it('503 storage_unavailable: DynamoDB failing on read', async () => {
    const t = setup({ failTop: true });
    const res = await handle(req('GET', '/scores'), t.deps);
    expect(res.statusCode).toBe(503);
    expect(bodyOf(res)).toEqual({ error: 'storage_unavailable' });
    expect(t.logs).toEqual([{ level: 'error', msg: 'storage read failed', fields: { error: 'InternalServerError' } }]);
  });
});

describe('core.handle routing', () => {
  it.each(['PUT', 'DELETE', 'PATCH', 'OPTIONS'])('405 method_not_allowed: %s /scores', async (method) => {
    const t = setup();
    const res = await handle(req(method, '/scores', '{}'), t.deps);
    expect(res.statusCode).toBe(405);
    expect(bodyOf(res)).toEqual({ error: 'method_not_allowed' });
    expect(t.puts).toHaveLength(0);
    expect(t.topCalls).toHaveLength(0);
  });

  it.each([
    ['GET', '/scores/'],
    ['POST', '/scores/'],
    ['GET', '/foo'],
    ['GET', '/'],
    ['PUT', '/scores/1'],
  ])('404 not_found: %s %s', async (method, path) => {
    const t = setup();
    const res = await handle(req(method, path, JSON.stringify(HONEST)), t.deps);
    expect(res.statusCode).toBe(404);
    expect(bodyOf(res)).toEqual({ error: 'not_found' });
    expect(t.puts).toHaveLength(0);
  });

  it('every response is JSON', async () => {
    const t = setup();
    const responses = await Promise.all([
      handle(req('GET', '/scores'), t.deps),
      handle(post(JSON.stringify(HONEST)), t.deps),
      handle(post('nope'), t.deps),
      handle(req('PUT', '/scores'), t.deps),
      handle(req('GET', '/nope'), t.deps),
    ]);
    for (const r of responses) {
      expect(r.headers).toEqual({ 'content-type': 'application/json' });
      expect(() => JSON.parse(r.body)).not.toThrow();
    }
  });
});

describe('jsonLogger', () => {
  it('writes one JSON line with level, msg and fields', () => {
    const lines: string[] = [];
    jsonLogger((l) => lines.push(l))('warn', 'replay_mismatch', { seed: 1 });
    expect(lines).toEqual(['{"level":"warn","msg":"replay_mismatch","seed":1}']);
  });
});
