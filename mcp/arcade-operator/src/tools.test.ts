import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { CATALOG_ORDER } from '../../../src/engine';
import type { InputLog } from '../../../src/engine';
import { validateReplay } from '../../../src/shared/replay';
import { recordGame } from '../../../src/test-support/engine';
import { DEFAULT_LOCAL_SCORES, NO_LOCAL_FILE_NOTE, getLeaderboard, listPowerUps, localScoresPath, validateReplayTool } from './tools';
import type { ToolDeps } from './tools';

const CWD = '/repo';
const LOCAL_PATH = resolve(CWD, DEFAULT_LOCAL_SCORES);
const API = 'https://api.example.test';

const LOCAL_SCORES = [
  { initials: 'KIR', score: 1200, level: 2 },
  { initials: 'AWS', score: 300, level: 1 },
];
const REMOTE_SCORES = [
  { initials: 'ZED', score: 9000, level: 4 },
  { initials: 'ABC', score: 50, level: 1 },
];

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
}

interface Fakes {
  deps: ToolDeps;
  logs: string[];
  fetched: string[];
  read: string[];
}

function fakes(opts: {
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
  fetch?: (url: string) => Promise<Response>;
  readError?: Error;
}): Fakes {
  const logs: string[] = [];
  const fetched: string[] = [];
  const read: string[] = [];
  const files = opts.files ?? {};
  const deps: ToolDeps = {
    fetch: async (input) => {
      const url = String(input);
      fetched.push(url);
      if (opts.fetch === undefined) throw new TypeError('network down');
      return opts.fetch(url);
    },
    readFile: async (path) => {
      read.push(path);
      if (opts.readError !== undefined) throw opts.readError;
      const text = files[path];
      if (text === undefined) throw enoent(path);
      return text;
    },
    env: opts.env ?? {},
    cwd: () => CWD,
    log: (m) => logs.push(m),
    timeoutSignal: () => new AbortController().signal,
  };
  return { deps, logs, fetched, read };
}

function payload(r: CallToolResult): Record<string, unknown> {
  const first = r.content[0];
  if (first === undefined || first.type !== 'text') throw new Error('expected a text content block');
  if (r.isError === true) return { errorText: first.text, ...(r.structuredContent ?? {}) };
  const parsed = JSON.parse(first.text) as Record<string, unknown>;
  expect(r.structuredContent).toEqual(parsed);
  return parsed;
}

const okJson = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('localScoresPath', () => {
  it('defaults to mcp/arcade-operator/data/local-scores.json under the working directory', () => {
    expect(localScoresPath({ env: {}, cwd: () => CWD })).toBe(LOCAL_PATH);
    expect(localScoresPath({ env: { KIROMAN_LOCAL_SCORES: '  ' }, cwd: () => CWD })).toBe(LOCAL_PATH);
  });

  it('honors KIROMAN_LOCAL_SCORES, relative to the working directory', () => {
    expect(localScoresPath({ env: { KIROMAN_LOCAL_SCORES: '/abs/s.json' }, cwd: () => CWD })).toBe('/abs/s.json');
    expect(localScoresPath({ env: { KIROMAN_LOCAL_SCORES: 'x/s.json' }, cwd: () => CWD })).toBe('/repo/x/s.json');
  });
});

describe('get_leaderboard', () => {
  it('local: reads and normalizes the local file', async () => {
    const unsorted = [...LOCAL_SCORES].reverse();
    const f = fakes({ files: { [LOCAL_PATH]: JSON.stringify(unsorted) } });
    const r = await getLeaderboard(f.deps, { source: 'local' });
    expect(r.isError).toBeUndefined();
    expect(payload(r)).toEqual({ source: 'local', path: LOCAL_PATH, scores: LOCAL_SCORES });
    expect(f.fetched).toEqual([]);
  });

  it('local: a missing file is an empty list with a note, not an error', async () => {
    const f = fakes({});
    const r = await getLeaderboard(f.deps, { source: 'local' });
    expect(r.isError).toBeUndefined();
    expect(payload(r)).toEqual({ source: 'local', path: LOCAL_PATH, scores: [], note: NO_LOCAL_FILE_NOTE });
    expect(f.logs.join('\n')).toContain(NO_LOCAL_FILE_NOTE);
  });

  it('local: drops invalid entries with a note and accepts the { scores } wrapper', async () => {
    const raw = { scores: [...LOCAL_SCORES, { initials: 'bad', score: 5, level: 1 }, { initials: 'NOP', score: -1, level: 1 }] };
    const f = fakes({ files: { [LOCAL_PATH]: JSON.stringify(raw) } });
    const p = payload(await getLeaderboard(f.deps, { source: 'local' }));
    expect(p.scores).toEqual(LOCAL_SCORES);
    expect(p.note).toBe('dropped 2 invalid entries');
  });

  it('local: invalid JSON and unreadable files are errors', async () => {
    const bad = await getLeaderboard(fakes({ files: { [LOCAL_PATH]: '{nope' } }).deps, { source: 'local' });
    expect(bad.isError).toBe(true);
    expect(payload(bad).errorText).toContain('not valid JSON');
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const unreadable = await getLeaderboard(fakes({ readError: denied }).deps, { source: 'local' });
    expect(unreadable.isError).toBe(true);
    expect(payload(unreadable).errorText).toContain('EACCES');
  });

  it('remote: reads KIROMAN_API_URL/scores and normalizes the list', async () => {
    const f = fakes({ env: { KIROMAN_API_URL: `${API}/` }, fetch: () => okJson({ scores: REMOTE_SCORES }) });
    const r = await getLeaderboard(f.deps, { source: 'remote' });
    expect(r.isError).toBeUndefined();
    expect(payload(r)).toEqual({ source: 'remote', apiUrl: `${API}/`, scores: REMOTE_SCORES });
    expect(f.fetched).toEqual([`${API}/scores`]);
    expect(f.read).toEqual([]);
  });

  it('remote: a missing URL, a network failure or an http error is isError', async () => {
    const noUrl = await getLeaderboard(fakes({ env: { KIROMAN_API_URL: '' } }).deps, { source: 'remote' });
    expect(noUrl.isError).toBe(true);
    expect(payload(noUrl).errorText).toContain('KIROMAN_API_URL is not set');
    const badUrl = await getLeaderboard(fakes({ env: { KIROMAN_API_URL: 'ftp://x' } }).deps, { source: 'remote' });
    expect(payload(badUrl).errorText).toContain('not a valid http(s) URL');
    const down = await getLeaderboard(fakes({ env: { KIROMAN_API_URL: API } }).deps, { source: 'remote' });
    expect(down.isError).toBe(true);
    expect(payload(down).errorText).toContain('network');
    const http = await getLeaderboard(
      fakes({ env: { KIROMAN_API_URL: API }, fetch: () => okJson({ error: 'boom' }, 503) }).deps,
      { source: 'remote' },
    );
    expect(payload(http).errorText).toContain('http 503');
  });

  it('auto (default): uses the remote list when it works', async () => {
    const f = fakes({ env: { KIROMAN_API_URL: API }, fetch: () => okJson({ scores: REMOTE_SCORES }) });
    const p = payload(await getLeaderboard(f.deps, {}));
    expect(p.source).toBe('remote');
    expect(p.scores).toEqual(REMOTE_SCORES);
  });

  it('auto: falls back to local with a note when the URL is missing', async () => {
    const f = fakes({ files: { [LOCAL_PATH]: JSON.stringify(LOCAL_SCORES) } });
    const r = await getLeaderboard(f.deps, undefined);
    expect(r.isError).toBeUndefined();
    const p = payload(r);
    expect(p.source).toBe('local');
    expect(p.scores).toEqual(LOCAL_SCORES);
    expect(p.note).toBe('KIROMAN_API_URL is not set; showing local scores');
    expect(f.fetched).toEqual([]);
  });

  it('auto: falls back to local with a note when the remote fails', async () => {
    const f = fakes({
      env: { KIROMAN_API_URL: API },
      files: { [LOCAL_PATH]: JSON.stringify(LOCAL_SCORES) },
      fetch: () => Promise.resolve(new Response('<html>', { status: 200 })),
    });
    const p = payload(await getLeaderboard(f.deps, { source: 'auto' }));
    expect(p.source).toBe('local');
    expect(p.scores).toEqual(LOCAL_SCORES);
    expect(p.note).toBe('remote leaderboard failed (bad response body); showing local scores');
  });

  it('auto: combines the fallback note with the missing-file note', async () => {
    const p = payload(await getLeaderboard(fakes({}).deps, { source: 'auto' }));
    expect(p).toEqual({
      source: 'local',
      path: LOCAL_PATH,
      scores: [],
      note: `KIROMAN_API_URL is not set; showing local scores; ${NO_LOCAL_FILE_NOTE}`,
    });
  });

  it('rejects an unknown source', async () => {
    const r = await getLeaderboard(fakes({}).deps, { source: 'cloud' });
    expect(r.isError).toBe(true);
    expect(payload(r).errorText).toBe('source must be one of auto, remote, local');
  });
});

describe('validate_replay', () => {
  // A real recorded game: the client recorder loop with a fixed turning pattern until the last life.
  const PATTERN = [2, 3, 4, 1] as const;
  const recorded = recordGame(0xc0ffee, (t) => PATTERN[Math.floor(t / 90) % 4] ?? 0);
  const seed = 0xc0ffee;
  const inputLog: InputLog = recorded.log;
  const honest = recorded.state.score;

  it('accepts an honest recording and agrees with the shared validateReplay', () => {
    expect(honest).toBeGreaterThan(0);
    const r = validateReplayTool({ seed, inputLog, claimedScore: honest });
    expect(r.isError).toBeUndefined();
    expect(payload(r)).toEqual({
      valid: true,
      status: 'accepted',
      replayedScore: honest,
      claimedScore: honest,
      level: recorded.state.level,
      ticks: recorded.state.tick,
    });
    expect(validateReplay({ seed, inputLog, claimedScore: honest }).ok).toBe(true);
  });

  it('accepts the committed sample exported by the headless browser run (data/sample-replay.json)', () => {
    const sample: unknown = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample-replay.json'), 'utf8'));
    const p = payload(validateReplayTool(sample));
    expect(p.valid).toBe(true);
    expect(p.status).toBe('accepted');
    expect(p.replayedScore).toBeGreaterThan(0);
  });

  it('reports replay_mismatch for a forged score', () => {
    const p = payload(validateReplayTool({ seed, inputLog, claimedScore: honest + 10 }));
    expect(p).toMatchObject({ valid: false, status: 'replay_mismatch', replayedScore: honest, claimedScore: honest + 10 });
  });

  it('reports replay_incomplete when the replay hits maxTicks (test-only opts)', () => {
    const p = payload(validateReplayTool({ seed, inputLog, claimedScore: honest }, { maxTicks: 10 }));
    expect(p).toMatchObject({ valid: false, status: 'replay_incomplete', ticks: 10 });
  });

  it('returns isError with field errors from the shared schema', () => {
    const r = validateReplayTool({ seed: -1, inputLog: [[5, 1], [5, 2]], claimedScore: 1.5 });
    expect(r.isError).toBe(true);
    const p = payload(r);
    expect(p.errorText).toContain('invalid replay input:');
    expect(p.errors).toEqual([
      { field: 'seed', message: 'must be an integer 0..4294967295' },
      { field: 'inputLog[1][0]', message: 'ticks must be strictly increasing' },
      { field: 'claimedScore', message: 'must be an integer 0..10000000' },
    ]);
  });

  it('rejects unknown keys (initials are not part of the replay input) and missing keys', () => {
    const extra = payload(validateReplayTool({ seed, inputLog, claimedScore: honest, initials: 'KIR' }));
    expect(extra.errors).toEqual([{ field: 'initials', message: 'unknown key' }]);
    const missing = payload(validateReplayTool({ seed }));
    expect(missing.errors).toEqual([
      { field: 'inputLog', message: 'is required' },
      { field: 'claimedScore', message: 'is required' },
    ]);
    expect(payload(validateReplayTool('nope')).errors).toEqual([{ field: '(root)', message: 'must be a JSON object' }]);
  });
});

describe('list_power_ups', () => {
  it('returns the services.json catalog in CATALOG_ORDER', () => {
    const r = listPowerUps();
    expect(r.isError).toBeUndefined();
    const p = payload(r) as { powerUps: Array<Record<string, unknown>> };
    expect(p.powerUps.map((d) => d.kind)).toEqual([...CATALOG_ORDER]);
    expect(p.powerUps[0]).toEqual({
      kind: 'lambda',
      label: 'LMB',
      name: 'AWS Lambda',
      durationTicks: 360,
      color: 9,
      effect: 'Player speed 48',
    });
    for (const d of p.powerUps) expect(Object.keys(d).sort()).toEqual(['color', 'durationTicks', 'effect', 'kind', 'label', 'name']);
  });
});
