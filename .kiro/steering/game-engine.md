---
inclusion: fileMatch
fileMatchPattern: "src/**/*.ts"
---

# KIRO-MAN determinism rules

These rules bind the pure, deterministic directories: `src/engine`, `src/shared`, `src/arcade`, `src/content` and `src/leaderboard/ranking.ts`. The same engine code runs in the browser, in the score-validation Lambda and in the arcade-operator MCP server, and the server replays a submitted input log tick by tick. Any hidden source of nondeterminism lets an honest score be rejected or a forged one slip through.

The steering file is matched on `src/**/*.ts` (plain glob, no brace pattern), so it is also loaded for `src/app`, `src/render` and `src/audio`. Those layers may use the browser, but they only read engine state; they never mutate it.

## Forbidden in the pure directories

`Math.random`, `Date.now`, `performance.now`, `new Date`, `crypto`, `window`, `document`, `localStorage`, `fetch`, `setTimeout`, `setInterval`, `requestAnimationFrame`. The static guard (`tests/static/guard.test.ts`) scans for these names as whole words, including in comments and test names, and fails the build.

`src/engine` imports only from `src/engine` and `src/content/services.json`.

Only `src/app` touches wall-clock time and generates the game seed.

## Randomness: seeded PRNG in state

Bad:

```ts
const dir = candidates[Math.floor(Math.random() * candidates.length)];
```

Good:

```ts
import { pick, nextInt } from './rng';
const dir = pick(state.rng, candidates); // mulberry32 state lives in GameState.rng
const slot = nextInt(state.rng, slots.length);
```

## Time: tick counters, not clocks

Bad:

```ts
const expiresAt = Date.now() + 6000;
if (Date.now() > expiresAt) deactivate();
```

Good:

```ts
state.active.lambda = durationOf('lambda'); // 360 ticks = 6 simulated seconds
// in tickPowerUps, once per playing step:
state.active.lambda = Math.max(0, (state.active.lambda ?? 0) - 1);
```

## Rules

- Fixed 60 Hz tick: `GameState.tick` advances once per `step`. 60 ticks are one simulated second.
- Integer-only simulation math. Positions are fixed point with `TILE_UNITS = 256` per tile. Divisions to pixels happen in `src/render`, never in the engine.
- No module-level mutable state. Everything lives in the plain-JSON `GameState`, so `cloneState` and replay work.
- Iterate in the binding orders: `ENEMY_ORDER` for enemies, `CATALOG_ORDER` for power-ups, `DIR_ORDER` (U, L, D, R) for direction candidates.
- Events pattern: `step` first sets `state.events = []`, then refills it. Render and audio consume events and never feed anything back. Game-over detection in the app is phase based.
- Follow the binding 11-phase playing step order in `.kiro/specs/_design-overview.md` section 5.8.
- Every new mechanic needs a property test (fast-check, `{ numRuns: PBT_RUNS }` from `src/test-support/pbt.ts`) in a `*.property.test.ts` file next to the source, plus unit tests for its edge cases.
