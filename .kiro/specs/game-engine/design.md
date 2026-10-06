# Design — game-engine

## Overview

`src/engine` is a pure, deterministic, DOM-free state machine: `createGame(seed, config)` builds a JSON-serializable `GameState`, and `step(state, dir)` advances it by one 60 Hz tick in place. `src/shared/replay.ts` drives it from an input log. The browser, the Lambda (`infra/lambda`), and the MCP server (`mcp/arcade-operator`) import the same code, which makes server-side replay validation possible. The stack is TypeScript 5.9.3 strict, tested with Vitest 5.0.3 and fast-check 4.10.2 (see `../_design-overview.md` §4.2).

## Quality bar / no scope cuts

The requirements are the floor: four distinct AIs, five power-ups, smooth fixed-point movement, rising difficulty, properties P2–P5 at ≥ 100 runs, and the edge-case unit tests listed below. No TODOs. The reviewer rejects partial work.

## Modules and APIs

| File | Exports |
|---|---|
| `rng.ts` | `type Rng = { s: number }`; `createRng(seed)`; `nextU32(r)`; `nextInt(r, n)` (n ≥ 1, uses `nextU32 % n`); `pick(r, arr) = arr[nextInt(r, arr.length)]` (throws `RangeError` on an empty array, which is a programming error) |
| `types.ts` | `Dir`, `Vec`, `Tile` enum, `Maze`, `Mover`, `Enemy`, `EnemyId = 'latency'\|'throttle'\|'coldstart'\|'outage'`, `PowerKind`, `Pickup`, `Phase`, `GameEvent`, `GameState`, `GameConfig` |
| `constants.ts` | `TICK_HZ=60`, `TILE_UNITS=256`, `MAZE_W=40`, `MAZE_H=28`, `MAX_TICKS=108000`, speeds, phase durations, score values, and `difficulty(level)` returning `{ speeds, releaseDelays, coldFrozen }` |
| `input.ts` | `type InputLog = [number, Dir][]`; `createRecorder()` → `{ record(tick, dir), log }` (records changes only); `DIR_VEC`, `reverse(d)`, `DIR_ORDER = [1,4,3,2]` (U, L, D, R) |
| `maze.ts` | `parseMaze(ascii: string[]) → Result<Maze, MazeError[]>`; `validateMaze(maze) → MazeError[]`; `isPassable(maze, x, y)` (out of bounds = false); `bfsNextStep(maze, from, to) → Dir \| 0`; `bfsNearest(maze, from, predicate) → Dir \| 0`; `reachableFrom(maze, p) → Uint8Array` |
| `levels.ts` | `LEVELS: { name, ascii }[]` (3 layouts), `levelFor(L)` |
| `movement.ts` | `advanceMover(maze, m, speed, decide)` (the core fixed-point step; `decide(m) → Dir` is called at every center); `occupiedTile(m)` |
| `enemies/*.ts` | `decideLatency`, `decideThrottle`, `decideColdStart`, `decideOutage`, each `(state, enemy) → { dir, target }`; `index.ts` `updateEnemies(state)`; `pathing.ts` greedy chooser |
| `powerups.ts` | `maybeSpawnPickup(state)`, `applyPowerUp(state, kind)` (also used by QA hooks and P3 grants; it applies exactly the collection effect: `active[kind] = duration`, the clone spawn rule, `stats.servicesUsed[kind]++`, and a `powerUpPickup` event. It does NOT add the 50-point pickup score, which the pickup-collection path adds), `tickPowerUps(state)`, `isActive(state, kind)` |
| `collision.ts` | `resolveCollisions(state)` |
| `scoring.ts` | `addScore(state, pts)` |
| `game.ts` | `createGame(seed, config?)`, `step(state, dir)`, `cloneState(s)`, `forceGameOver(state)` (QA), `isDark(state, x, y)` |
| `src/shared/replay.ts` | `replay(seed, log, opts)`, `validateReplay(sub, opts)` |

## GameState shape

```ts
interface GameState {
  seed: number; rng: { s: number }; tick: number; phase: Phase; phaseTimer: number;
  level: number; lives: number; score: number; maze: Maze; bugs: Uint8Array-like number[]; bugsLeft: number;
  bugsEatenThisLevel: number; nextPickupThreshold: number;
  player: Mover & { desired: Dir; facing: Dir; invuln: number; warpLock: number /* pad index or -1 */ };
  clone: (Mover & { }) | null;
  enemies: Enemy[]; // Enemy = Mover & { id, mode: 'pen'|'active', releaseIn, target: Vec, cold?: { phase:'frozen'|'dash', timer } }
  pickup: { kind: PowerKind; at: Vec; ttl: number } | null;
  active: Partial<Record<PowerKind, number>>; // remaining ticks
  stats: { bugsEaten: number; servicesUsed: Record<PowerKind, number>; shieldBlocks: number };
  lastKiller: EnemyId | null; gameOverReason: 'caught' | 'timeLimit' | 'qa' | null;
  events: GameEvent[]; config: GameConfig;
}
```

`bugs` is a plain `number[]` (0/1, row-major) rather than a typed array, so `JSON.stringify` equality works in P4. `enemies` is always in `ENEMY_ORDER`.

## Core types (binding)

```ts
type Dir = 0 | 1 | 2 | 3 | 4;              // none, up, right, down, left
type Vec = { x: number; y: number };
type EnemyId = 'latency' | 'throttle' | 'coldstart' | 'outage';
const ENEMY_ORDER: readonly EnemyId[] = ['latency', 'throttle', 'coldstart', 'outage'];
type PowerKind = 'lambda' | 'shield' | 'autoscaling' | 'cloudfront' | 'cloudwatch';
// CATALOG_ORDER = services.json array order = the PowerKind order above
type Phase = 'ready' | 'playing' | 'dying' | 'levelClear' | 'gameOver';
interface Mover { tile: Vec; dir: Dir; progress: number /* 0..255 */ }
interface GameConfig { startLives: number /* default 3, 1..9 */; maze?: readonly string[] /* tests only; overrides levelFor(L) for every level */ }
interface Maze { w: number; h: number; cells: Tile[] /* row-major */; spawn: Vec; exit: Vec; pen: Vec[]; slots: Vec[]; pads: Vec[] } // all lists row-major (y, then x)
type MazeError =
  | { kind: 'bad_size'; w: number; h: number } | { kind: 'bad_char'; x: number; y: number; ch: string }
  | { kind: 'border_open'; x: number; y: number } | { kind: 'count'; tile: 'P'|'X'|'E'|'U'|'W'; found: number }
  | { kind: 'unreachable_bug'; x: number; y: number } | { kind: 'exit_not_above_door'; x: number; y: number }
  | { kind: 'unreachable_tile'; tile: 'U' | 'W'; x: number; y: number };
type GameEvent =
  | { type: 'bug'; at: Vec; by: 'player'|'clone' } | { type: 'powerUpSpawn'; kind: PowerKind; at: Vec }
  | { type: 'powerUpPickup'; kind: PowerKind } | { type: 'shieldBlock'; enemy: EnemyId }
  | { type: 'death'; enemy: EnemyId } | { type: 'levelClear'; level: number; bonus: number }
  | { type: 'gameOver'; reason: 'caught'|'timeLimit'|'qa' } | { type: 'cloneSpawn'; at: Vec } | { type: 'warp'; from: number; to: number };
```

`parseMaze` checks size (must be 40x28 for shipped levels; tests may use 5..40 x 5..28) and characters. `validateMaze` checks everything else. `createGame` validates the `config.maze` override too and throws `InvalidMazeError` on failure. `bfsNextStep` and `bfsNearest` return `Dir` (0 = no step).

mulberry32 is pinned exactly:

```ts
export function createRng(seed: number): Rng { return { s: seed | 0 }; }
export function nextU32(r: Rng): number { r.s = (r.s + 0x6D2B79F5) | 0; let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) >>> 0; }
```

Golden values (computed with Node 22): seed 0 → `1144304738, 1416247, 958946056, 627933444`; seed 1 → `2693262067, 11749833, 2265367787, 4213581821`.

## Key decisions

**In-place mutation, not immutable copies.** A replay of up to 108,000 ticks inside a Lambda has to be fast. Copying a 1,120-cell bug array every tick would add about 120M element copies per replay. In-place mutation with no module state keeps the engine pure from the caller's point of view: the same inputs give the same outputs, and the only side effects land on the state object the caller passed in.

**Tile + progress fixed-point movement.** This model keeps entities on a grid with integer state only, makes the wall invariant structural (movement only starts toward passable tiles), and gives smooth rendering through interpolation. Free x/y with AABB collision was rejected because it brings in floats and corner-snapping bugs.

**Input handling (binding).** At the top of `step(state, dir)`, right after `events = []`, in every phase except `gameOver`: if `dir !== 0` then `player.desired = dir`. `dir === 0` leaves `desired` unchanged, so releasing all keys keeps the player moving until it hits a wall (arcade style). The recorder starts with `last = 0`, so a game with no key presses has `inputLog = []`.

**`step` order within `playing` (binding).**

```
 (1) events = []
 (2) tickPowerUps: for k in CATALOG_ORDER with active[k] > 0: active[k] -= 1;
     if it hits 0: delete active[k]; k==='autoscaling' → clone = null; k==='cloudfront' → player.warpLock = -1
 (3) prevOcc = occupiedTile of player and of each enemy (captured here, before any movement)
 (4) player: invuln = max(0, invuln-1); mid-tile reversal check (desired === reverse(dir) && progress > 0);
     advanceMover at speed isActive('lambda') ? 48 : 32; eat bug / collect pickup at occupied tile
     (pickup sets active[k] = duration); warp check
 (5) clone: advance (speed 32, target nearest bug) + eat bug (clone ignores pickups)
 (6) enemies in ENEMY_ORDER: pen countdown/release, AI decide at centers, advance
 (7) resolveCollisions
 (8) maybeSpawnPickup; then, for a pickup that existed before this step, ttl -= 1 and remove at 0
     (a pickup spawned this step keeps ttl 600)
 (9) level-clear check (only if phase is still 'playing')
(10) time-limit check: if phase !== 'gameOver' && tick === MAX_TICKS - 1 → gameOver, reason 'timeLimit'
(11) tick++
```

**Non-playing steps (binding).** `events = []` runs first in every phase, `gameOver` included. If `phase === 'gameOver'`, the step only does `tick++` and returns (the input rule is skipped, GE-7.3). Otherwise the input rule applies, then `phaseTimer -= 1`; if it reaches 0 the transition happens in that same step (emitting its events, e.g. `gameOver` with reason `caught` when `dying` ends with 0 lives); then step (10); then `tick++`. The next step is the first step of the new phase. `tick` increments in every phase, so recorded ticks map to calls one-to-one, and every real game ends during the step at tick `MAX_TICKS - 1` or earlier.

**Initial state (binding).** `createGame` returns `phase = 'ready'`, `phaseTimer = 120`, `tick = 0`, `level = 1`, `lives = config.startLives`, `score = 0`, `events = []`, `lastKiller = null`, `gameOverReason = null`, `bugsEatenThisLevel = 0`, `nextPickupThreshold = 30`, `rng = createRng(seed >>> 0)`, with the reset table below applied. It throws `RangeError` if `startLives` is not an integer in 1..9 (programming error).

**Game-over observation.** Consumers detect game over by `state.phase === 'gameOver'`, not by scanning `events`. `forceGameOver` (QA, called between steps) pushes a `gameOver` event that the next step clears; the app's phase check catches it regardless (overview §6).

**Timer semantics (binding).** `isActive(s, k) := (s.active[k] ?? 0) > 0`. A pickup collected in step T sets `active[k] = duration` in phase (4). Steps T+1 … T+duration-1 decrement it in phase (2) to `duration-1 … 1`, and step T+duration decrements it to 0 and removes it. Sampled after each step, `isActive` is true after steps T … T+duration-1 (exactly `duration` samples) and false after step T+duration, unless re-picked. Lambda's speed applies from step T+1 (the pickup happens after the speed was chosen in step T). Re-picking resets to `duration`, and re-picking `autoscaling` keeps the existing clone (no second clone, no second `cloneSpawn`).

**Pickup spawning (binding).** `bugsEatenThisLevel` counts bugs eaten by the player and the clone. `maybeSpawnPickup`: `if (bugsEatenThisLevel >= nextPickupThreshold) { nextPickupThreshold += 60; if (pickup === null) spawn }`. Thresholds are 30, 90, 150, … (start 30, +60 each). A threshold crossed while a pickup is on the field is skipped, not deferred. Spawn draws `kind = pick(rng, CATALOG_ORDER)` first, then `slot = pick(rng, maze.slots excluding occ(player))`. If no slot remains, no spawn and no second rng draw. Only the player collects pickups.

**Collision (binding).** For each released enemy `e` in `ENEMY_ORDER`: collision iff `occ(player) == occ(e)` OR (`occ(player) == prevOcc(e)` AND `occ(e) == prevOcc(player)`), where `occ(m) = progress < 128 ? tile : tile + dir`. Collisions are skipped while `player.invuln > 0` and for pen enemies. With Shield active, the first colliding enemy in `ENEMY_ORDER` is blocked (shield removed, +200, `invuln = 30`, `shieldBlock` event, enemy sent home); `invuln` then suppresses the rest this tick. Without Shield, the first colliding enemy kills: `phase='dying'`, `phaseTimer=90`, `lives -= 1`, `lastKiller = e.id`, `death` event, then `active = {}`, `clone = null`, `pickup = null`. When `dying` ends with `lives === 0`: `phase='gameOver'`, `gameOverReason='caught'`, `gameOver` event.

**Spawn, pen, release and resets (binding).**
- Pen homes: enemy `i` in `ENEMY_ORDER` has `home = maze.pen[i]` (row-major `E` tiles). In the pen: `tile = home, dir = 0, progress = 0, target = home`, and it does not move.
- Release: in phase (6), a pen enemy with `releaseIn === 0` releases this step; otherwise `releaseIn -= 1`, and if that reaches 0 it releases in the same step (Latency, delay 0, releases on the first `playing` step). On release the enemy is placed at `X` with `dir = 0, progress = 0, mode = 'active'`, and its AI decides on the same tick. Cold Start gets `cold = { phase: 'frozen', timer: difficulty(L).coldFrozen }` (the release tick decrements nothing). On each later phase-(6) turn: `cold.timer -= 1`; if it hits 0 it toggles (frozen → `{dash, 240}`, dash → `{frozen, coldFrozen}`); then it decides or advances using the new phase. While frozen, its `target` is its own tile and it does not advance, even mid-tile.
- Outage decisions: candidates (non-reverse passable directions, or the reverse only at a dead end) are listed in `DIR_ORDER` (U, L, D, R), and `pick(rng, candidates)` is called even with exactly one candidate, so each decision consumes exactly one draw. With zero candidates it stays and draws nothing.
- Shield block: the enemy returns to `home`, `mode = 'pen'`, `releaseIn = 120`, `cold` removed.
- Life start (after `dying`) and level start: player `tile = P, dir = 0, desired = 0, facing = 0, progress = 0, invuln = 0, warpLock = -1`; every enemy at home in the pen with `releaseIn = difficulty(level).releaseDelays[id]`; `active = {}`, `clone = null`, `pickup = null`. Bugs persist across a death. A new level reloads bugs from the layout and sets `bugsEatenThisLevel = 0`, `nextPickupThreshold = 30`.
- Pads: `maze.pads` (row-major `W` tiles) are pads 0..3. Warp check at the end of phase (4), only while `isActive('cloudfront')` (binding):

  ```
  i = index of player.tile in maze.pads (-1 if none)
  if (i === -1) player.warpLock = -1
  else if (i !== player.warpLock && (tileChangedThisStep || player.progress === 0)) {
    j = (i + 1) % 4; player.tile = pads[j]; player.progress = 0  // dir kept, leftover dropped
    player.warpLock = j; emit { type: 'warp', from: i, to: j }
  }
  ```

  `tileChangedThisStep` is true when the reversal or `advanceMover` changed `player.tile` in this step's phase (4). A player standing still on a pad when CloudFront starts warps on the next step. A player crossing a pad with leftover progress (speed 48) warps and loses the leftover. Expiry and the reset table set `warpLock = -1`.
- Clone timing: a clone spawned by a pickup in phase (4) of step T first advances in phase (5) of step T.
- `facing` = the last non-zero `dir` the player moved in.

**AI edge rules (binding).** `reverse(0) = 0`, so a just-released enemy (`dir = 0`) treats every passable direction as a candidate. BFS ignores the no-reverse rule and treats other entities as non-blocking. `bfsNextStep` returning 0 (target unreachable or same tile) means the enemy stays at its center that tick. `isDark` is false while Outage is in the pen.

**BFS vs greedy.** Latency and the Cold Start dash use BFS, so they are strong but slow or intermittent. Throttle uses greedy targeting ahead of the player, so it ambushes in corridors. Outage is random. Together these give four visibly different behaviors. BFS runs only at tile centers (roughly every 8–12 ticks per enemy) on 1,120 tiles, which is cheap.

**Throttle target clamp.** The target is `player.tile + 4·DIR_VEC[facing]`, clamped to `[0,39]×[0,27]`. It may be a wall, and greedy distance still works. If `facing === 0`, the target is the player tile.

**Clone targeting.** `bfsNearest(maze, clone.tile, tile has bug)`. If no bug is reachable, the clone stays put. Ties are broken by BFS order. The clone eats the bug at `occ(clone)`, same as the player.

**Level clear (binding).** Level clear (step 9) sets `active = {}`, `clone = null`, `pickup = null` immediately (GE-6.10). The reset table re-applies it at the next level start.

**Seeds.** `seed >>> 0`. mulberry32 with seed 0 is valid.

## Edge cases (each needs a unit test)

- The player at a dead end holding into a wall stops at the center (`progress` 0, dir 0).
- Reversal at `progress` 1 and at 255.
- Leftover progress is dropped when the next direction is blocked.
- A swap-tile collision when the player and an enemy face each other across one tile boundary.
- Shield active and two enemies colliding in the same tick: the first in id order is blocked, then the 30-tick invulnerability covers the second.
- Picking up the same kind twice resets the timer. Re-picking Shield while active resets `active.shield` to 600, and a later block increments `stats.shieldBlocks` by exactly 1 (the shield is still a single charge).
- Lambda + CloudFront active: the player crosses a pad with non-zero leftover progress and warps (`progress === 0` at the arrival pad, `warp` event emitted).
- A player standing still on pad i when CloudFront is granted warps to pad (i+1) % 4 on the next step and does not warp back while it stays on the arrival pad.
- Outage with one candidate still consumes one rng draw (rng state differs from a no-draw run).
- Cold Start: on the step its frozen timer hits 0 it toggles to dash and moves in that same step.
- `createGame` with `startLives` 0, 10, or 1.5 throws `RangeError`; the initial state matches the "Initial state" list.
- A `gameOver`-phase step leaves `events` empty and only increments `tick`; `forceGameOver` then one `step` leaves `events` empty but `phase === 'gameOver'`.
- A pickup spawn when every `U` slot except the player's is excluded.
- A warp when the destination pad is occupied by an enemy: the warp happens and collision resolves normally.
- The clone when 0 bugs are reachable.
- Death during an active Lambda clears it, and the next life starts at speed 32.
- Level clear on the same tick the player would be killed: collisions resolve before the level-clear check, so death wins. The eaten bug stays eaten (`bugsLeft` may be 0). If lives remain, the level-clear check fires on the first `playing` step after respawn. If lives = 0, there is no clear bonus.
- `forceGameOver` sets `lives=0`, `phase='gameOver'`, `gameOverReason='qa'`, `lastKiller=null` and emits `gameOver`.
- Replay with an empty log, with events whose tick is ≥ the final `state.tick` (no effect), and timing out at `maxTicks`.
- Time-limit last tick: in the walled-off time-limit maze, the client recorder loop holds dir 0 until tick 107999 and then presses a passable direction, recording `[[107999, dir]]`. The recorder's final state has `player.desired === dir` and `player.progress > 0` (the event was applied in the final step). `replay(seed, [[107999, dir]])` returns `complete`, a `finalState` that is `JSON.stringify`-equal to the recorder's, and the same score; `validateReplay` accepts it, and a replay that dropped the event would not be deep-equal (asserted by comparing with `replay(seed, [])`).
- `pick` on an empty array throws.
- Releasing all keys (`dir = 0`) keeps the player moving until a wall; a game with no key presses records `inputLog = []`.
- Time limit: with a `config.maze` where the player is walled off from all enemies, `replay(seed, [])` returns `status: 'complete'`, `finalState.gameOverReason === 'timeLimit'`, `ticks === MAX_TICKS`.
- Power-up timer boundary: Lambda picked at step T is active after steps T..T+359 and inactive after T+360.
- A threshold crossed while a pickup is on the field is skipped (next spawn waits for the following threshold); player + clone eating two bugs in one tick across a threshold spawns once.
- Re-picking Auto Scaling keeps the existing clone and emits no second `cloneSpawn`.
- Shield block returns the enemy to its row-major pen home with `releaseIn = 120`.

## Error handling

The engine has no I/O. `parseMaze` returns `Result` errors (recoverable, not logged). `services.json` is validated at module load (`kind` set equals `PowerKind`, order equals `CATALOG_ORDER`, `durationTicks` integer 1..3600, `color` 0..15, `label` `^[A-Z]{3}$`); a failure throws `Error("services.json invalid: ...")`, which is fatal and covered by a unit test. `createGame` throws `InvalidMazeError` with the error list for an invalid maze, which is fatal. `pick([])` throws `RangeError`, also fatal. `createGame` throws `RangeError` for `startLives` outside integer 1..9, also fatal. The engine never logs. Callers (app, Lambda, MCP) catch and log as described in overview §10. `step` on a `gameOver` state sets `events = []` and increments `tick`, nothing else.

## Invariant ownership

| Invariant | Owner |
|---|---|
| No entity in a wall | `movement.ts advanceMover` (only module that changes tiles) and the warp code in `game.ts` (pads are floor by validation) |
| Bugs reachable | `validateMaze`, called by `createGame` |
| Timers ≥ 0 / exact duration | `powerups.ts tickPowerUps` |
| Determinism | rng.ts + steering + guard test S1 |

## Testability

Everything is unit-testable with no mocks: hand-built small mazes through `parseMaze` and a `config.maze` override in `GameConfig`, used by tests only. Shared test mazes (`P5_MAZE`, the walled-off time-limit maze, the warp maze) live in `src/engine/test-fixtures.ts`, which is imported only by tests and is validated by its own unit test. Integration-level tests are the replay golden test and the perf test. Properties are listed below.

## Correctness Properties

| ID | Property | Requirement |
|---|---|---|
| P2a | Random grids (5..20, random walls/bugs, 1 spawn): the set of `(x,y)` in `unreachable_bug` errors from `validateMaze` equals the set of bug tiles an independent flood-fill oracle does not reach from `P`; other error kinds are ignored | GE-2.3 |
| P2b | Every shipped level passes `validateMaze` (incl. `unreachable_tile`), for every bug index BFS from `P` reaches it, and `reachableFrom(maze, spawn)` includes `maze.exit` | GE-2.1, GE-2.3 |
| P3 | Random seed, input log (≤ 3000 ticks, `startLives` 1..3), and grants `fc.array(fc.tuple(fc.integer({min:0,max:2999}), fc.constantFrom(...CATALOG_ORDER)), {maxLength: 8})`; before the step at each granted tick, while `phase === 'playing'`, the test calls `applyPowerUp(state, kind)`. After every `step`, the player, the clone, and every enemy have `tile` and (if `progress>0`) `tile+dir` passable. The main `fc.assert` is unseeded with no coverage assertion; a second `fc.assert` of the same property with `{ numRuns: PBT_RUNS, seed: 0x4b49524f }` asserts counters showing ≥ 1 run with a clone, ≥ 1 `warp` event, and ≥ 1 step with Lambda active; `movement.coverage.test.ts` pins one deterministic case hitting all three | GE-3.6 |
| P4 | Random seed + input log: two runs give `JSON.stringify`-equal final state and equal score; a mid-run `cloneState` continued gives the same | GE-1, GE-8.2 |
| P5 | Fixture `P5_MAZE` (`test-fixtures.ts`): valid maze, `X` and pen sealed off by `#` from `P`'s region (enemies release but never reach the player), ≥ 100 bugs reachable from `P`; its `U` and `W` tiles lie in `P`'s region, so it satisfies the `unreachable_tile` rule (only `X` and the pen are sealed). Generator: `kind ∈ CATALOG_ORDER`, optional re-pick `R ∈ [T+1, T+duration+60]`, input always dir 0. T is the first `playing` step (step through `ready` with dir 0, then set `state.pickup = {kind, at: occ(player), ttl: 600}` so phase (4) of T collects it; the same placement before step R). Sample after every step through `max(T, R) + duration + 60`. Assert: every timer ≥ 0 after every step; `isActive` after step s is true iff `s ∈ [T, T+d-1] ∪ [R, R+d-1]` (d = duration); without re-pick the second interval is empty (true after T..T+d-1, exactly `d` samples, false after T+d). The union also covers `R === T+d` (phase (2) removes the timer, then phase (4) re-collects it) and `R > T+d`. A clone lives ≤ 660 ticks and eats ≤ 84 bugs at speed 32, so the level can't clear inside the window | GE-6.4 |

All use `numRuns: PBT_RUNS` (200).
