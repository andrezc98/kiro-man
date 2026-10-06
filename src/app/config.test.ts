import { describe, expect, it } from 'vitest';
import { CONFIG_TIMEOUT_MS, CONFIG_URL, isValidApiUrl, loadConfig } from './config';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

function fetchReturning(respond: () => Response | Promise<Response>): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return respond();
  }) as typeof fetch;
  return { fetch: f, urls };
}

async function load(respond: () => Response | Promise<Response>) {
  const messages: string[] = [];
  const { fetch, urls } = fetchReturning(respond);
  const cfg = await loadConfig({ fetch, info: (m) => messages.push(m) });
  return { cfg, messages, urls };
}

describe('loadConfig', () => {
  it('reads ./config.json and returns a valid https apiUrl', async () => {
    const { cfg, messages, urls } = await load(() => json(200, { apiUrl: 'https://abc.execute-api.us-east-1.amazonaws.com' }));
    expect(cfg).toEqual({ apiUrl: 'https://abc.execute-api.us-east-1.amazonaws.com' });
    expect(urls).toEqual([CONFIG_URL]);
    expect(CONFIG_URL).toBe('./config.json');
    expect(messages).toEqual([]);
  });

  it('accepts http (local testing)', async () => {
    expect((await load(() => json(200, { apiUrl: 'http://localhost:3000' }))).cfg).toEqual({ apiUrl: 'http://localhost:3000' });
  });

  it.each<[string, () => Response]>([
    ['a 404', () => new Response('<html>not found</html>', { status: 404 })],
    ['invalid JSON', () => new Response('{nope', { status: 200 })],
    ['a non-object', () => json(200, ['https://x.test'])],
    ['a missing apiUrl', () => json(200, {})],
    ['a null apiUrl', () => json(200, { apiUrl: null })],
    ['a relative apiUrl', () => json(200, { apiUrl: '/api' })],
    ['a javascript: apiUrl', () => json(200, { apiUrl: 'javascript:alert(1)' })],
    ['an ftp apiUrl', () => json(200, { apiUrl: 'ftp://x.test' })],
    ['an empty apiUrl', () => json(200, { apiUrl: '' })],
  ])('%s means offline with one info line', async (_name, respond) => {
    const { cfg, messages } = await load(respond);
    expect(cfg).toEqual({ apiUrl: null });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^offline mode: /);
  });

  it('a network error means offline', async () => {
    const { cfg, messages } = await load(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(cfg).toEqual({ apiUrl: null });
    expect(messages).toEqual(['offline mode: config.json could not be fetched']);
  });

  it('times out after 2 s via the injected signal and goes offline', async () => {
    const ctl = new AbortController();
    const seen: number[] = [];
    const messages: string[] = [];
    const pending = loadConfig({
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        )) as typeof fetch,
      timeoutSignal: (ms) => {
        seen.push(ms);
        return ctl.signal;
      },
      info: (m) => messages.push(m),
    });
    ctl.abort();
    expect(await pending).toEqual({ apiUrl: null });
    expect(seen).toEqual([CONFIG_TIMEOUT_MS]);
    expect(CONFIG_TIMEOUT_MS).toBe(2000);
    expect(messages).toEqual(['offline mode: config.json timed out']);
  });

  it('the default signal really times out', async () => {
    const cfg = await loadConfig({
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof fetch,
      timeoutMs: 20,
      info: () => undefined,
    });
    expect(cfg).toEqual({ apiUrl: null });
  });
});

describe('isValidApiUrl', () => {
  it('accepts http(s) URLs only', () => {
    expect(isValidApiUrl('https://x.test/prod')).toBe(true);
    expect(isValidApiUrl('http://x.test')).toBe(true);
    expect(isValidApiUrl('x.test')).toBe(false);
    expect(isValidApiUrl('data:,x')).toBe(false);
    expect(isValidApiUrl(42)).toBe(false);
  });
});
