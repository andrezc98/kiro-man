import { describe, expect, it } from 'vitest';
import type { Submission } from '../shared/submission';
import { REMOTE_TIMEOUT_MS, createRemoteClient } from './remoteClient';

const SUB: Submission = { initials: 'KIR', seed: 7, inputLog: [[0, 2]], claimedScore: 120 };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fake fetch that records calls and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that only settles when its signal aborts (like a real hung request). */
function hangingFetch(): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
}

function client(f: typeof fetch, apiUrl = 'https://api.example.test') {
  return createRemoteClient({ apiUrl, fetch: f });
}

describe('remoteClient.submit status mapping', () => {
  it.each([201, 200])('%i with the accepted body is ok (extra fields allowed)', async (status) => {
    const { fetch } = fakeFetch(() => json(status, { accepted: true, score: 120, level: 2, id: 'x' }));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: true, value: { score: 120, level: 2 } });
  });

  it('posts the submission as JSON to <apiUrl>/scores', async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { accepted: true, score: 120, level: 1 }));
    await client(fetch).submit(SUB);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.test/scores');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(SUB);
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('normalizes a trailing slash on apiUrl', async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { accepted: true, score: 1, level: 1 }));
    await client(fetch, 'https://api.example.test/prod//').submit(SUB);
    expect(calls[0]?.url).toBe('https://api.example.test/prod/scores');
  });

  it('204 (no body) is bad_response', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'bad_response' } });
  });

  it.each<[string, unknown]>([
    ['accepted:false', { accepted: false, score: 1, level: 1 }],
    ['a missing score', { accepted: true, level: 1 }],
    ['a float level', { accepted: true, score: 1, level: 1.5 }],
    ['a string score', { accepted: true, score: '1', level: 1 }],
    ['an array', [{ accepted: true, score: 1, level: 1 }]],
  ])('a 2xx with %s is bad_response', async (_name, body) => {
    const { fetch } = fakeFetch(() => json(201, body));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'bad_response' } });
  });

  it('a 2xx HTML body is bad_response', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>hi</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'bad_response' } });
  });

  it.each<[number, string]>([
    [400, 'invalid_request'],
    [413, 'payload_too_large'],
    [422, 'replay_mismatch'],
  ])('%i is rejected with body.error', async (status, error) => {
    const { fetch } = fakeFetch(() => json(status, { error }));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'rejected', error } });
  });

  it('a 422 without an error field is still rejected', async () => {
    const { fetch } = fakeFetch(() => new Response('nope', { status: 422 }));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'rejected', error: 'http_422' } });
  });

  it.each([500, 503, 404, 429, 302])('%i is http with the status', async (status) => {
    const { fetch } = fakeFetch(() => json(status, { error: 'x' }));
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'http', status } });
  });

  it('a throwing fetch is network', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await client(fetch).submit(SUB)).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('an abort from the injected timeout signal is timeout', async () => {
    const ctl = new AbortController();
    const seen: number[] = [];
    const c = createRemoteClient({
      apiUrl: 'https://api.example.test',
      fetch: hangingFetch(),
      timeoutSignal: (ms) => {
        seen.push(ms);
        return ctl.signal;
      },
    });
    const pending = c.submit(SUB);
    ctl.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'timeout' } });
    expect(seen).toEqual([REMOTE_TIMEOUT_MS]);
    expect(REMOTE_TIMEOUT_MS).toBe(3000);
  });

  it('the default signal times a hung request out after timeoutMs', async () => {
    const c = createRemoteClient({ apiUrl: 'https://api.example.test', fetch: hangingFetch(), timeoutMs: 20 });
    expect(await c.submit(SUB)).toEqual({ ok: false, error: { kind: 'timeout' } });
  });

  it('an abort while reading the body is timeout', async () => {
    const ctl = new AbortController();
    const res = { status: 200, json: () => Promise.reject(new DOMException('aborted', 'AbortError')) } as unknown as Response;
    const c = createRemoteClient({
      apiUrl: 'https://api.example.test',
      fetch: (async () => {
        ctl.abort();
        return res;
      }) as typeof fetch,
      timeoutSignal: () => ctl.signal,
    });
    expect(await c.submit(SUB)).toEqual({ ok: false, error: { kind: 'timeout' } });
  });
});

describe('remoteClient.getTop', () => {
  it('GETs <apiUrl>/scores and normalizes the list', async () => {
    const scores = [
      { initials: 'BBB', score: 100, level: 1 },
      { initials: 'bad', score: 999, level: 1 },
      { initials: 'AAA', score: 300, level: 2, createdAt: 'x' },
    ];
    const { fetch, calls } = fakeFetch(() => json(200, { scores }));
    expect(await client(fetch, 'https://api.example.test/').getTop()).toEqual({
      ok: true,
      value: [
        { initials: 'AAA', score: 300, level: 2 },
        { initials: 'BBB', score: 100, level: 1 },
      ],
    });
    expect(calls[0]?.url).toBe('https://api.example.test/scores');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('maps failures without throwing', async () => {
    const cases: Array<[() => Response, unknown]> = [
      [() => json(503, { error: 'storage_unavailable' }), { kind: 'http', status: 503 }],
      [() => json(200, { top: [] }), { kind: 'bad_response' }],
      [() => new Response('not json', { status: 200 }), { kind: 'bad_response' }],
      [
        () => {
          throw new TypeError('offline');
        },
        { kind: 'network' },
      ],
    ];
    for (const [respond, error] of cases) {
      const { fetch } = fakeFetch(respond);
      expect(await client(fetch).getTop()).toEqual({ ok: false, error });
    }
    const hung = createRemoteClient({ apiUrl: 'https://api.example.test', fetch: hangingFetch(), timeoutMs: 20 });
    expect(await hung.getTop()).toEqual({ ok: false, error: { kind: 'timeout' } });
  });

  it('never throws even when the signal factory throws', async () => {
    const c = createRemoteClient({
      apiUrl: 'https://api.example.test',
      fetch: fakeFetch(() => json(200, { scores: [] })).fetch,
      timeoutSignal: () => {
        throw new Error('boom');
      },
    });
    await expect(c.getTop()).resolves.toEqual({ ok: false, error: { kind: 'network' } });
    await expect(c.submit(SUB)).resolves.toEqual({ ok: false, error: { kind: 'network' } });
  });
});
