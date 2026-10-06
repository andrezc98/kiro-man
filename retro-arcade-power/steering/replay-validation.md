# Replay validation

With a deterministic engine, a high-score submission does not have to be trusted. The client sends the seed and its input log; the server runs the same engine code over them and accepts the score only if it reproduces exactly.

## 1. Record input as change events

```ts
export type Dir = 0 | 1 | 2 | 3 | 4;              // none, up, right, down, left
export type InputLog = Array<[tick: number, dir: Dir]>;

export function createRecorder() {
  const log: InputLog = [];
  let last: Dir = 0;                              // a game with no key presses records []
  return {
    record(tick: number, dir: Dir): void {
      if (dir !== last) { log.push([tick, dir]); last = dir; }
    },
    log,
  };
}
```

Each event means "from this tick on, the held direction is `dir`". Ticks strictly increase. A 30-minute game is typically a few hundred events, far smaller than a frame-by-frame log.

## 2. Replay with the same rule the client used

```ts
export function replay(seed: number, log: InputLog, opts: { maxTicks?: number } = {}) {
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const s = createGame(seed);
  let i = 0;
  let held: Dir = 0;
  while (s.phase !== 'gameOver' && s.tick < maxTicks) {
    while (i < log.length && log[i]![0] === s.tick) { held = log[i]![1]; i++; } // same rule as the recorder
    step(s, held);
  }
  return { status: s.phase === 'gameOver' ? 'complete' : 'timeout', score: s.score, level: s.level, ticks: s.tick };
}

export function validateReplay(sub: { seed: number; inputLog: InputLog; claimedScore: number }) {
  const r = replay(sub.seed, sub.inputLog);
  if (r.status !== 'complete') return { ok: false, reason: 'replay_incomplete', replayedScore: r.score } as const;
  if (r.score !== sub.claimedScore) return { ok: false, reason: 'replay_mismatch', replayedScore: r.score } as const;
  return { ok: true, score: r.score, level: r.level } as const;
}
```

Because the engine ends every game by `MAX_TICKS`, an honest replay is always `complete`, and the server's work per request is bounded.

## 3. Validate the shape before replaying

Parse untrusted input into a typed value with field-level errors and never throw:

| Field | Rule |
|---|---|
| `initials` | `^[A-Z]{3}$` (leaderboard submissions only) |
| `seed` | integer 0..4294967295 |
| `inputLog` | array of at most 10000 `[tick, dir]` pairs, tick integer 0..MAX_TICKS-1 strictly increasing, dir integer 0..4 |
| `claimedScore` | integer 0..10000000 |
| any other key | rejected |

```ts
const parsed = parseSubmission(JSON.parse(body));
if (!parsed.ok) return { statusCode: 400, body: JSON.stringify({ error: 'invalid_request', details: parsed.error }) };
const v = validateReplay(parsed.value);
if (!v.ok) return { statusCode: 422, body: JSON.stringify({ error: v.reason, replayedScore: v.replayedScore }) };
await store.put({ initials: parsed.value.initials, score: v.score, level: v.level });
return { statusCode: 201, body: JSON.stringify({ accepted: true, score: v.score, level: v.level }) };
```

Also cap the request body (for example 128 KiB) before parsing.

## 4. Share one engine build between client and server

Bundle the same `src/engine` and `src/shared` sources into the Lambda (esbuild via `NodejsFunction`) and into the MCP server. Compile them once with a DOM-free `lib` (`"lib": ["ES2022"]`) so nothing browser-only can sneak in.

## 5. Validate a replay from Kiro

The power's `arcade-operator` MCP server exposes the same validation:

```json
{ "name": "validate_replay", "arguments": { "seed": 3735928559, "inputLog": [[120, 2], [300, 3]], "claimedScore": 40 } }
```

It returns `{ valid, status, replayedScore, claimedScore, level, ticks }` with `status` one of `accepted`, `replay_mismatch`, `replay_incomplete`, or `isError: true` with the schema's field errors.

## 6. Tests

- Golden: a pinned seed and log replay to a stored score, level and tick count.
- Property: a recording made by the client loop always validates with its own score, and never with `score + k` for `k != 0`.
- Property: the parser accepts every valid submission and rejects each single-field corruption with that field named.
- Edge: an event at the last legal tick (`MAX_TICKS - 1`) is applied and counts.

## What it does not stop

A bot can play a real game and submit it honestly. Replay validation proves the score is reachable with that input, not that a human produced it. Pair it with API throttling and size limits.
