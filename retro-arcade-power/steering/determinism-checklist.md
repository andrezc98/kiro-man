# Determinism checklist

A deterministic game produces the same state from the same seed and the same input log on every machine, every run. That property is what makes server-side replay validation, golden regression tests and property-based tests possible. This checklist is what to verify before any new mechanic is merged.

## 1. Split pure simulation from the shell

Keep the simulation in its own directories that never touch the browser or the clock:

```
src/engine/   pure: state, rules, AI, PRNG
src/shared/   pure: replay, submission schema (shared with the server)
src/app/      shell: clock, keyboard, seed generation, DOM
src/render/   shell: reads state, never mutates it
```

The pure directories must not mention any of these, even in comments:

| Forbidden | Use instead |
|---|---|
| `Math.random()` | a seeded PRNG whose state lives in the game state |
| `Date.now()`, `performance.now()`, `new Date()` | `state.tick` (integer step counter) |
| `setTimeout`, `setInterval`, `requestAnimationFrame` | a countdown field decremented once per step |
| `window`, `document`, `localStorage`, `fetch`, `crypto` | injected adapters in the shell |

Enforce it with a static test so it cannot regress:

```ts
// tests/static/guard.test.ts (excerpt)
const FORBIDDEN = [/\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/, /\bnew\s+Date\b/, /\bwindow\b/];
for (const file of pureFiles) {
  const src = readFileSync(file, 'utf8');
  for (const re of FORBIDDEN) expect(re.test(src), `${file} uses ${re}`).toBe(false);
}
```

## 2. Seeded PRNG stored in state

Use a small, fully specified generator. mulberry32 uses only 32-bit integer operations, so it is identical in every JavaScript engine:

```ts
export interface Rng { s: number }

export function createRng(seed: number): Rng {
  return { s: seed | 0 };
}

export function nextU32(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

export function nextInt(r: Rng, n: number): number {
  return nextU32(r) % n;
}

export function pick<T>(r: Rng, arr: readonly T[]): T {
  return arr[nextInt(r, arr.length)] as T;
}
```

Pin golden values in a unit test (seed 0 gives `1144304738, 1416247, 958946056, 627933444`) so an accidental edit is caught.

Rules:

- The PRNG state lives in the game state (`state.rng`), never in a module variable.
- Draw the same number of values on every path. If an AI "picks among candidates", call `pick` even when there is a single candidate, so the draw count never depends on map geometry.
- Fix the iteration order of everything that draws: entity arrays in a constant order, candidate directions in a constant order (for example up, left, down, right).

## 3. Integer math only

Floats are deterministic in IEEE 754 for basic operations, but it is easy to slip in `Math.sin`, `Math.pow` or different association orders that diverge across engines or refactors. Use integers:

```ts
export const TILE_UNITS = 256; // fixed point: 256 units per tile

mover.progress += mover.speed;        // speed in units per tick, e.g. 32
if (mover.progress >= TILE_UNITS) {
  mover.tile = { x: mover.tile.x + dx, y: mover.tile.y + dy };
  mover.progress -= TILE_UNITS;
}
```

Convert to pixels only in the renderer: `px = tile.x * 8 + dx * progress * 8 / 256`, then `Math.floor`.

## 4. Plain-JSON state, no hidden state

- The whole game is one plain object: numbers, strings, booleans, arrays, plain objects. No classes with private fields, no `Map`/`Set` (their iteration order depends on insertion history), no closures.
- `structuredClone(state)` gives an independent copy for tests and for rewinding.
- No module-level mutable variables anywhere in the simulation.

## 5. One step function, fixed phase order

```ts
export function step(state: GameState, input: Dir): void {
  state.events = [];          // 1. always first, in every phase
  tickPowerUps(state);        // 2. timers
  capturePrevious(state);     // 3. positions for swap collisions
  movePlayer(state, input);   // 4.
  moveClone(state);           // 5.
  moveEnemies(state);         // 6. in a constant order
  resolveCollisions(state);   // 7.
  maybeSpawnPickup(state);    // 8.
  checkLevelClear(state);     // 9.
  checkTimeLimit(state);      // 10. bounded games make replays terminate
  state.tick++;               // 11.
}
```

Write the order down and treat it as binding: changing it changes every replay.

## 6. Events out, never in

The step fills `state.events` (`bug`, `death`, `warp`, ...). Rendering and audio read them to play sounds and effects. Nothing the shell does feeds back into the simulation except the input direction.

## 7. Bounded games

End every game within a maximum tick count (for example 108000 ticks = 30 simulated minutes). Then any replay terminates, and a server can cap its work per request.

## 8. Tests that prove it

- Golden regression: a fixed seed and input log replay to a stored score, level and tick count.
- Property: for any seed and input log, two independent replays give deep-equal final states.
- Property: for any seed, input log and power-up grants, every mover stays on passable tiles.
- Property: timers are never negative and are active for exactly their duration.
- Run property tests with at least 100 cases each (fast-check `numRuns`).

## Pre-merge checklist

- [ ] No forbidden API in the pure directories (static guard green).
- [ ] Every random draw goes through the state's PRNG, in a fixed order, with a path-independent count.
- [ ] Every timer is a tick countdown.
- [ ] No floats in the simulation.
- [ ] State is plain JSON; no module state.
- [ ] Step phase order unchanged, or the change is documented and the golden replay updated on purpose.
- [ ] A property test covers the new mechanic.
