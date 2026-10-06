# KIRO-MAN: Outage in the Data Center — Requirements & Technical Design Overview

Status: design pass 3, approved for implementation. All 31 pass-1 findings, all 19 pass-2 findings, and all 12 pass-3 findings (`.agents/tasks/design-review.md`) are resolved; responses are in section 13. Where this document and a per-feature spec disagree, the "binding" rules in sections 5–9 of this document win. This document is the umbrella for four feature specs:

| Spec | Folder | Scope |
|---|---|---|
| coin-credit-system | `.kiro/specs/coin-credit-system/` | Coins, credits, cabinet screen flow (attract → play → incident report → initials → high scores) |
| game-engine | `.kiro/specs/game-engine/` | Deterministic sim: maze, movement, collisions, 4 enemy AIs, 5 power-ups, levels, scoring, replay |
| leaderboard | `.kiro/specs/leaderboard/` | Local top-10, remote client, submission schema, server replay validation, CDK backend |
| arcade-presentation | `.kiro/specs/arcade-presentation/` | Canvas renderer, palette, pixel font, sprites, CRT overlay, WebAudio SFX, headless screenshots |

Kiro tooling (steering, hooks, agents, MCP, powers, packaged power) is specified in section 9 of this document; it is not a separate spec because it has no runtime behavior to property-test, but every item in it is required.

---

## 1. Summary

A browser arcade maze-chase game. The player is the Kiro ghost, eating "bugs" in a server-rack data center at 3 AM while four incident-themed enemies (Latency, Throttle, Cold Start, Outage) chase it. AWS-service power-ups (Lambda, Shield, Auto Scaling, CloudFront, CloudWatch) are part of the gameplay itself. It is framed as a coin-op cabinet: attract mode, INSERT COIN, credits, three lives, an Incident Report on game over with a sourced AWS fact, and three-initial high scores. The simulation is deterministic, so a serverless backend (CDK, synth only) can replay a submitted input log with the same engine code and reject forged scores. The repo also has to show off all seven Kiro features plus a packaged Kiro power.

## 2. Quality bar / no scope cuts (binding on planner, coder, reviewer)

The user changed the brief: there is enough time, so nothing gets cut and the "MVP first, cut from the bottom" framing no longer applies. Everything below is REQUIRED. The reviewer MUST reject the work if any item is missing, stubbed, or half-done.

1. All four enemy AIs, each with the distinct behavior in section 5.6.
2. All five power-ups working end to end, each with a timer, HUD indicator, and SFX.
3. CRT scanline overlay and WebAudio sound effects (coin, start, eat, power-up, shield block, death, level clear, game over).
4. The `arcade-operator` MCP server with all three tools working against real data.
5. The packaged `retro-arcade-power` in both layouts: `POWER.md` + `steering/` (the format the installed Kiro reads) and `plugin.json` + `skills/` (the lesson5 format), plus `mcp.json`, a bundled server, and a README. Its local install is tried in the Kiro Powers panel and the result is recorded.
6. Headless browser verification (Playwright) that produces committed screenshots in `docs/screenshots/` and fails on any console error.
7. Polished retro visuals and game feel: smooth sub-tile movement interpolated at 60 Hz, input buffering at corners, sprite animation frames, readable HUD, screen transitions ("READY", "LEVEL CLEAR", death animation), difficulty that increases each level.
8. Thorough testing: every property in section 8 implemented with fast-check at `numRuns >= 100`, plus unit tests for the edge cases listed in each spec.
9. Clean modular architecture: the module boundaries in section 4 are respected and enforced by the static guard test (section 8, S1).
10. No `TODO`, `FIXME`, `XXX`, `not implemented`, or placeholder bodies in `src/`, `infra/`, `mcp/`, `scripts/`, `retro-arcade-power/`, `tests/`. The static guard test checks for these tokens using the single scan definition in section 8 (S1).
11. A complete README: what the game is, controls, how to run, test, build, synth, take screenshots, run cfn-lint, MCP/power setup, a map of how each of the seven Kiro features is used (with file paths), the security note for the unauthenticated API, and the trademark disclaimer.

## 3. Assumptions

- A1. "Shield" means AWS Shield (DDoS protection). In game it absorbs one enemy hit.
- A2. Kiro's power installer reads `POWER.md` with YAML front-matter (verified from every power in `~/.kiro/powers/installed/`, e.g. `aws-infrastructure-as-code/` has `POWER.md`, `mcp.json`, `steering/`). `plugin.json` + `skills/` follow the lesson5 layout. Both are shipped (section 9.6).
- A3. Kiro spawns workspace MCP servers with the workspace root as cwd, so relative `args` paths resolve from the repo root. The README documents the absolute-path fallback.
- A4. The Kiro shell tool name for `PreToolUse` matching is not certain, so the matcher covers both `execute_bash` and `shell`.
- A5. The agent `model` field is left out so Kiro's default model is used. Lesson7's example id may not exist for every account, and an invalid id would break the agent.
- A6. No real AWS resources and no deploy. `cdk deploy` is documented but never run.
- A8. Hook trigger names `PreToolUse` and `PostTaskExec` come from the brief and are not in the course notes (only `PostFileSave` is). The coder creates each of those two hooks once through Kiro's hook UI and copies the generated trigger name; if it differs, the generated name wins and the README notes it. The confirm-deploy script fails closed via exit code 2 so it still blocks even if the JSON `ask` payload isn't honored.
- A9. Brace-glob support in steering `fileMatchPattern` is unverified, so only plain globs are used (section 9.2). The coder opens `src/engine/rng.ts` once in Kiro, confirms `game-engine.md` is listed as included, and records it in the README.
- A7. Facts in `aws-facts.json` are drafted in section 7.5. During implementation the coder MUST check each one with the AWS documentation MCP server and record the doc URL. Any fact that can't be verified gets replaced.

## 4. Architecture

### 4.1 Layers and dependency rules

```
                 ┌──────────────── browser only ────────────────┐
 index.html ──►  src/app (bootstrap, fixed-timestep loop, keyboard, qa hooks)
                    │            │              │            │
                    ▼            ▼              ▼            ▼
              src/render     src/audio    src/leaderboard/  src/arcade (pure)
              (canvas)       (WebAudio)   browser adapters   cabinet + credits
                    │            │          (localStorage,       │
                    └─────┬──────┘           fetch)              │
                          ▼                    │                 │
               ┌──────────── pure, DOM-free, deterministic ──────┴───────┐
               │ src/engine   src/shared (replay, submission)            │
               │ src/leaderboard/ranking.ts   src/content (catalog/facts)│
               └──────────────────────────────────────────────────────────┘
                          ▲                         ▲
     infra/lambda (Node 22 Lambda)        mcp/arcade-operator (Node stdio)
```

Rules (enforced by static guard test S1 and by `infra/tsconfig.json` compiling `src/engine` + `src/shared` with `lib: ["ES2022"]` and no DOM types):

- `src/engine`, `src/shared`, `src/arcade`, `src/content`, `src/leaderboard/ranking.ts` MUST NOT reference `Math.random`, `Date.now`, `performance.now`, `new Date`, `crypto`, `window`, `document`, `localStorage`, `fetch`, `setTimeout`, `setInterval`, or `requestAnimationFrame`.
- `src/engine` imports only from `src/engine` and `src/content/services.json`.
- `src/render` and `src/audio` read engine state; they never mutate it.
- Only `src/app` touches wall-clock time and generates the game seed.

### 4.2 Technology stack (locked)

| Concern | Choice | Exact version |
|---|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | typescript 5.9.3 (5.x picked over 7.x so the Vite/Vitest/CDK toolchains stay compatible) |
| Bundler/dev server | Vite | vite 8.3.2 |
| Tests | Vitest + fast-check | vitest 5.0.3, fast-check 4.10.2 |
| Node types | @types/node | 22.20.5 |
| Headless verification | Playwright (Chromium) | playwright 1.63.0 |
| IaC | AWS CDK v2 (TypeScript) | aws-cdk-lib 2.272.0, aws-cdk 2.1144.0, constructs 10.8.1 |
| CDK app runner / Lambda bundler | tsx, esbuild | tsx 4.23.15, esbuild 0.28.2 |
| Lambda SDK | AWS SDK v3 | @aws-sdk/client-dynamodb 3.1146.0, @aws-sdk/lib-dynamodb 3.1146.0 |
| MCP server | MCP TS SDK + zod | @modelcontextprotocol/sdk 1.32.1, zod 4.6.5 |
| Runtime | Node 22 locally; Lambda `NODEJS_22_X` | — |
| Package manager | npm, exact versions (`"save-exact": true` in `.npmrc`), lockfiles committed | — |

There are three npm packages, each with its own `package.json` and lockfile: the repo root (game + all Vitest tests), `infra/`, and `mcp/arcade-operator/`. The root package has `"type": "module"`.

TypeScript settings (binding, finding #13): root and `infra/tsconfig.json` both use `"module": "ESNext", "moduleResolution": "Bundler", "resolveJsonModule": true, "verbatimModuleSyntax": true, "target": "ES2022"`, strict. Infra adds `"lib": ["ES2022"], "types": ["node"]` (no DOM), includes `bin`, `lib`, `lambda`, `test`, `../src/engine`, `../src/shared`, `../src/content`, `../src/leaderboard/ranking.ts`, and sets `"exclude": ["../src/**/*.test.ts", "../src/test-support/**", "lambda/**/*.test.ts", "cdk.out"]` so root and lambda test files (which import fast-check, installed only at the root) are never type-checked by infra; the root `tsc` covers them. `infra/package.json` scripts: `"synth": "cdk synth --quiet"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest --run --dir test"` (`--dir` limits discovery to `infra/test/`, so only `stack.test.ts` runs; a bare `test` filter would also match `lambda/*.test.ts`, whose fast-check imports only resolve from the root. The lambda core tests run from the root). Relative imports are extensionless; JSON uses default imports. `infra/package.json` devDependencies: `aws-cdk 2.1144.0`, `esbuild 0.28.2`, `tsx 4.23.15`, `@types/node 22.20.5`, `vitest 5.0.3`, `typescript 5.9.3`. `mcp/arcade-operator/package.json`: dependencies `@modelcontextprotocol/sdk 1.32.1`, `zod 4.6.5`; devDependency `esbuild 0.28.2`; script `"build": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js && node scripts/copy-to-power.mjs"`. `dist/` is gitignored, so `npm run build:mcp` is a documented prerequisite. `public/config.json` is gitignored.

### 4.3 Folder layout

```
kiro-man/
  index.html  vite.config.ts  vitest.config.ts  tsconfig.json  package.json  .npmrc  README.md
  public/                         # static; config.json is gitignored (runtime API config)
  src/
    engine/      rng.ts types.ts constants.ts input.ts maze.ts levels.ts movement.ts
                 collision.ts powerups.ts scoring.ts game.ts index.ts
                 enemies/ index.ts pathing.ts latency.ts throttle.ts coldStart.ts outage.ts
    shared/      replay.ts submission.ts
    arcade/      credits.ts cabinet.ts initials.ts
    leaderboard/ ranking.ts localStore.ts remoteClient.ts
    content/     services.json aws-facts.json facts.ts
    render/      palette.ts font.ts sprites.ts renderer.ts hud.ts crt.ts
                 screens/ attract.ts playing.ts incident.ts initials.ts highscores.ts
    audio/       sfx.ts
    app/         main.ts loop.ts keyboard.ts config.ts qa.ts a11y.ts session.ts
    styles.css
  tests/static/  guard.test.ts            # forbidden APIs, TODO tokens, boundaries
  scripts/       confirm-deploy.mjs screenshots.mjs cfn-lint.sh
  infra/         package.json cdk.json tsconfig.json
                 bin/kiro-man.ts lib/kiro-man-stack.ts
                 lambda/ scores-handler.ts core.ts dynamo-store.ts
  mcp/arcade-operator/ package.json tsconfig.json src/index.ts src/tools.ts scripts/copy-to-power.mjs
                 data/local-scores.json data/sample-replay.json (both written by scripts/screenshots.mjs) dist/ (built, gitignored)
  retro-arcade-power/ POWER.md plugin.json mcp.json README.md server/arcade-operator.mjs (copied bundle, committed)
                 steering/*.md  skills/deterministic-canvas-games/SKILL.md references/*.md
  docs/          screenshots/*.png cfn-lint-report.txt power-iac-validation.md
  .kiro/         specs/ steering/ hooks/ agents/ settings/mcp.json
```

Test files sit next to their sources: `*.test.ts` for unit tests and `*.property.test.ts` for PBT. `vitest.config.ts` includes `src/**/*.test.ts`, `tests/**/*.test.ts`, `infra/lambda/**/*.test.ts`, and `mcp/arcade-operator/src/**/*.test.ts`. The root package declares the MCP SDK and zod as devDependencies (same exact versions) so the MCP tool tests resolve from the root. It also declares `esbuild 0.28.2`: `NodejsFunction` local bundling runs `npx --no-install esbuild` with the repo root (`projectRoot`) as the working directory, so esbuild must resolve from the root as well as from `infra/`.

### 4.4 npm scripts (root)

| Script | Command |
|---|---|
| `dev` | `vite` |
| `build` | `tsc --noEmit && vite build` |
| `preview` | `vite preview --port 4173 --strictPort` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest --run` |
| `test:unit` | `vitest --run --exclude "**/*.property.test.ts"` |
| `test:pbt` | `vitest --run property` (filename filter matches `*.property.test.ts`) |
| `build:mcp` | `npm --prefix mcp/arcade-operator run build` |
| `synth` | `npm --prefix infra run synth` |
| `cfn-lint` | `bash scripts/cfn-lint.sh` |
| `verify:browser` | `npm run build && node scripts/screenshots.mjs` |

## 5. Game engine design (summary; full detail in `game-engine/design.md`)

### 5.1 Determinism model

- PRNG: mulberry32 over a 32-bit state stored in `GameState.rng`, so the state stays plain JSON. `nextU32`, `nextInt(n)`, and `pick(arr)` take and update the state (`pick(r, arr) = arr[nextInt(r, arr.length)]`). Only `Math.imul` and integer ops are used. The implementation is pinned in `game-engine/design.md` ("Core types"), with golden values: seed 0 → `1144304738, 1416247, 958946056, 627933444`; seed 1 → `2693262067, 11749833, 2265367787, 4213581821`.
- Core types (`Phase`, `GameConfig`, `Maze`, `MazeError`, `GameEvent`, `ENEMY_ORDER`, `CATALOG_ORDER`) are defined verbatim in `game-engine/design.md` and are binding.
- Time: the integer `GameState.tick`, incremented once per `step`. 60 ticks = 1 simulated second. No floats in the sim. Positions use fixed-point integers with `TILE_UNITS = 256` per tile.
- API: `createGame(seed: number, config?: Partial<GameConfig>): GameState` and `step(state: GameState, input: Dir): void`. `step` mutates the caller-owned state in place for replay speed. There are no module-level mutable variables. `cloneState` uses `structuredClone`, which is available in Node 22 and browsers and is not on the forbidden list.
- Events: the first thing `step` does, in every phase including `gameOver`, is `state.events = []`; the step then refills it (`bug`, `powerUpSpawn`, `powerUpPickup`, `shieldBlock`, `death`, `levelClear`, `gameOver`, `cloneSpawn`, `warp`). Render and audio consume these and never feed anything back. Events are for SFX and visuals only. Game-over detection in the app is phase-based, not event-based (section 6).
- Initial state (binding): `createGame` returns `phase = 'ready'`, `phaseTimer = 120`, `tick = 0`, `level = 1`, `lives = config.startLives`, `score = 0`, `events = []`, with the reset table (5.6) applied. `createGame` throws `RangeError` if `startLives` is not an integer in 1..9 (programming error).
- Non-playing steps (binding): `events = []`; if `phase === 'gameOver'`, only `tick++` and return (the input rule is skipped there, so a `gameOver` step changes nothing else, GE-7.3); otherwise apply the input rule (5.2). Otherwise `phaseTimer -= 1`; if it reaches 0 the transition happens in that same step (and emits its events); then the time-limit check (5.8 step 10); then `tick++`. The next step is the first step of the new phase.

### 5.2 Input model

- `Dir`: `0 none, 1 up, 2 right, 3 down, 4 left`.
- `InputLog = Array<[tick: number, dir: Dir]>`. Each event means "from this tick on, the held direction is `dir`." Ticks strictly increase. The recorder only emits an event when the held direction changes.
- The client loop, before each `step`, reads the held direction from the keyboard. If it differs from the last recorded one, the loop pushes `[state.tick, dir]`, then calls `step(state, dir)`. The server replays the same way (see `src/shared/replay.ts`).
- Binding: `dir !== 0` sets `player.desired = dir`; `dir === 0` leaves `desired` unchanged, so the player keeps moving until a wall. The recorder starts with `last = 0`, so a game with no key presses has `inputLog = []`. Mid-tile reversal is evaluated at the start of the player phase, before `progress += speed`.

### 5.3 Maze

- The grid is 40 x 28 tiles of 8 px: rows 2..29 of the 320x240 canvas. Rows 0..1 (16 px) are the HUD.
- Map legend (ASCII in `levels.ts`): `#` rack wall, `.` bug, ` ` floor, `P` player spawn, `E` enemy pen floor, `=` pen door (impassable to everyone), `X` pen exit tile (floor directly above the door), `U` power-up spawn slot (floor), `W` CloudFront edge location (floor with a bug-free warp pad).
- All tile lists (`pen`, `slots`, `pads`) are in row-major order (y, then x). `W` tiles in that order are pads 0..3.
- There are three original layouts: `HALL-A "us-east-3am"`, `HALL-B "cold aisle"`, `HALL-C "hot aisle"`. Level `L` uses `LEVELS[(L-1) % 3]`. Each layout has exactly 1 `P`, 1 `X`, 4..8 `E`, 3..6 `U`, exactly 4 `W`, a solid border, no pellet unreachable from `P`, every `U` and `W` reachable from `P`, and (shipped levels, checked by P2b) `X` reachable from `P`.
- `parseMaze(ascii)` returns `Result<Maze, MazeError[]>`. `validateMaze(maze)` checks the counts above plus reachability: BFS over player-passable tiles from `P` must reach every `.` tile (`unreachable_bug`) and every `U` and `W` tile (`unreachable_tile`, `{ kind: 'unreachable_tile'; tile: 'U' | 'W'; x; y }`). `X` reachability is not a `validateMaze` rule (test fixtures such as `P5_MAZE` seal it off on purpose); P2b asserts it for every shipped level. Shipped levels are validated at module load in tests (P2) and again in `createGame`, which throws `InvalidMazeError` because a shipped invalid maze is a programming error.

### 5.4 Movement

- Each mover has `tile {x,y}`, `dir`, `progress` (0..255 toward `tile + dir`), and `speed` in units per tick.
- At a tile center (`progress === 0`) the mover picks a direction. Movement starts only if the destination tile is passable, so `tile` and `tile + dir` are always passable. That is the wall invariant (P3).
- On `progress >= 256`: `tile += dir` and `progress -= 256`. The mover re-decides at the new center and carries the leftover progress only if the new direction is passable. Otherwise leftover is set to 0 and the mover stops at the center.
- Player turning: the desired direction is buffered. At a center the mover turns if the desired direction is passable, otherwise continues if the current one is, otherwise stops. A reversal mid-tile is applied right away (`tile = tile + dir`, `progress = 256 - progress`, dir flipped), so the controls feel responsive.
- Render interpolation: `px = tile.x*8 + dx*progress*8/256`. That division is done in render (floats are allowed there), never in the engine.

### 5.5 Speeds and difficulty (units/tick; 256 = one tile)

`b = min(L-1, 6)` where `L` is the level.

| Mover | Speed |
|---|---|
| Player | 32 (Lambda active: 48) |
| Auto Scaling clone | 32 |
| Latency | 22 + b |
| Throttle | 29 + b |
| Outage | 26 + b |
| Cold Start dash | 46 + b; frozen = 0 |

Enemy release delays after `ready` ends (ticks): Latency 0, Throttle `max(60, 180-15b)`, Cold Start `max(120, 360-30b)`, Outage `max(180, 540-45b)`. Cold Start frozen duration is `max(90, 180-15b)` and dash duration is 240.

### 5.6 Enemy AI (distinct behaviors)

All enemies decide only at tile centers, and decisions are deterministic.

- **Latency** (slow, direct pursuit): BFS shortest path to the player's tile. BFS neighbor order is U, L, D, R. Target = player tile.
- **Throttle** (cut-off): target = player tile + 4 × player facing direction, clamped to the grid. Moves greedily: among non-reverse passable directions it picks the one minimizing squared Euclidean distance from the neighbor tile to the target. Tie-break U, L, D, R. Reversal is allowed only at a dead end.
- **Cold Start** (freeze then dash): alternates `frozen` (does not move, even mid-tile, and its target is its own tile) and `dash` (BFS toward the player at dash speed). It starts frozen after release.
- **Outage** (random wander + darkness): at each center it picks uniformly with the PRNG among non-reverse passable directions (reverse only at a dead end). Candidates are listed in `DIR_ORDER` (U, L, D, R), and `pick(rng, candidates)` is called even when there is exactly one candidate, so every Outage decision consumes exactly one draw. If there are no candidates at all (an enclosed single tile, impossible in a valid maze), it stays and draws nothing. Its target is the chosen next tile. Darkness: every tile within Manhattan distance 4 of Outage's tile is "dark". `isDark(state, x, y)` is a pure helper. Render draws dark tiles in palette 1/0 and hides bugs there. Bugs still exist and can be eaten.
- Order (binding): `ENEMY_ORDER = ['latency','throttle','coldstart','outage']`. `state.enemies` always uses this order, and "id order" means this order everywhere.
- Pen: enemy `i` has `home = maze.pen[i]` (row-major `E` tiles) and waits there with `dir = 0, progress = 0, target = home` (render bobs it using `tick`). Release timing (binding): in phase (6), a pen enemy with `releaseIn === 0` releases this step; otherwise `releaseIn -= 1`, and if that reaches 0 it releases in the same step (so Latency, delay 0, releases on the first `playing` step). On release it is placed on `X` with `dir = 0, progress = 0`, and its AI decides that same tick. Cold Start starts `{frozen, coldFrozen}` and toggles frozen ↔ dash (240) when its timer hits 0. Order within its phase-(6) turn (binding): `cold.timer -= 1`; if it hits 0, toggle (and reset the timer for the new phase); then decide or advance using the new phase. The release tick does not decrement (release sets the timer and decides). A Shield block sends the enemy home with `mode = 'pen'`, `releaseIn = 120`, `cold` cleared.
- Edge rules: `reverse(0) = 0`, so a just-released enemy considers every passable direction. BFS ignores the no-reverse rule and other entities. `bfsNextStep` returning 0 means the enemy stays at its center that tick. `isDark` is false while Outage is in the pen.
- Resets (life start and level start): player at `P` with `dir = desired = facing = 0`, `progress = 0`, `invuln = 0`, `warpLock = -1`; every enemy home with `releaseIn = difficulty(level).releaseDelays[id]`; `active = {}`, `clone = null`, `pickup = null`. Bugs persist across a death. A new level reloads bugs and sets `bugsEatenThisLevel = 0`, `nextPickupThreshold = 30`.
- `state.enemies[i].target` is always populated, and CloudWatch renders it.

### 5.7 Power-ups

Definitions live in `src/content/services.json`, the single source of truth that the engine, render, and MCP all read. Schema (binding): a JSON array whose order is `CATALOG_ORDER`; each item `{ "kind": "lambda", "label": "LMB", "name": "AWS Lambda", "durationTicks": 360, "color": 9, "effect": "Player speed 48" }`, then shield, autoscaling, cloudfront, cloudwatch. Validated at engine module load (kinds/order exact, label `^[A-Z]{3}$`, duration integer 1..3600, color 0..15).

| Kind | Label | Duration (ticks) | Effect |
|---|---|---|---|
| `lambda` | LMB | 360 (6 s) | Player speed 48 |
| `shield` | SHD | 600 (10 s) | The next enemy collision is absorbed: shield removed, enemy sent to pen, +200, player invulnerable 30 ticks |
| `autoscaling` | ASG | 300 (5 s) | Spawns a clone at the player tile; the clone BFSes to the nearest bug at speed 32 and eats bugs (+10 each); enemies ignore it; it is removed on expiry |
| `cloudfront` | CDN | 480 (8 s) | The 4 `W` pads become warps. Arriving on pad i (tile changed this step, or standing still on it) teleports the player to pad (i+1) mod 4, same direction, `progress = 0`, leftover progress dropped. The arrival pad does not trigger until the player has left it (`warpLock`). Exact rule below |
| `cloudwatch` | CWT | 480 (8 s) | Render overlays each enemy's `target` tile and a line to it |

- Spawning (binding): `bugsEatenThisLevel` counts bugs eaten by the player and the clone. `maybeSpawnPickup`: `if (bugsEatenThisLevel >= nextPickupThreshold) { nextPickupThreshold += 60; if (pickup === null) spawn }` (thresholds 30, 90, 150, …). A threshold crossed while a pickup is present is skipped, not deferred. Spawn draws `kind = pick(rng, CATALOG_ORDER)` first, then `slot = pick(rng, slots in row-major order excluding occ(player))`. A pickup spawned this step keeps ttl 600; older pickups lose 1 ttl per playing step and vanish at 0. Only the player collects pickups; the clone ignores them.
- Timers (binding): `tickPowerUps` runs first in every `playing` step (full order in 5.8). `isActive(s,k) := (s.active[k] ?? 0) > 0`. A pickup collected in step T sets `active[k] = duration`; `isActive` sampled after steps T … T+duration-1 is true (exactly `duration` samples) and false after step T+duration, unless re-picked. Re-picking resets to `duration` (no stacking). Timers never go negative (P5). On expiry: `autoscaling` → `clone = null`; `cloudfront` → `warpLock = -1`.
- `applyPowerUp(state, kind)` (binding; used by QA hooks and P3 grants) applies exactly the collection effect: `active[kind] = duration`, the clone spawn rule, `stats.servicesUsed[kind]++`, and a `powerUpPickup` event. It does NOT add the 50-point pickup score; the pickup-collection path adds that.
- Auto Scaling clone: spawns at `player.tile` with `dir = 0, progress = 0` and emits `cloneSpawn`. The clone eats the bug at `occ(clone)`, same as the player. A clone spawned in phase (4) of step T first advances in phase (5) of step T. Re-picking while a clone exists resets the timer and keeps the existing clone (no second clone or event).
- Warp check (binding), at the end of player phase (4), only while `isActive('cloudfront')`:

  ```
  i = index of player.tile in maze.pads (-1 if none)
  if (i === -1) player.warpLock = -1
  else if (i !== player.warpLock && (tileChangedThisStep || player.progress === 0)) {
    j = (i + 1) % 4
    player.tile = pads[j]; player.progress = 0   // dir kept, leftover dropped
    player.warpLock = j; emit { type: 'warp', from: i, to: j }
  }
  ```

  `tileChangedThisStep` is true when `advanceMover` (or a reversal) changed `player.tile` in this step's phase (4). Standing still on a pad when CloudFront starts therefore warps on the next step (progress 0). Crossing a pad with leftover progress (Lambda speed 48) warps and drops the leftover. When CloudFront is inactive, `warpLock` is only reset by expiry (5.7 timers) and the reset table.
- Shield re-pick: re-picking Shield while active resets `active.shield` to 600. It is still a single charge, so a later block increments `stats.shieldBlocks` by exactly 1.
- Death and level clear clear every active effect, the clone, and any pickup on the field (GE-6.10). Level clear (step 9) sets `active = {}`, `clone = null`, `pickup = null` immediately; the reset table re-applies it at the next level start.
- `state.stats.servicesUsed: Record<Kind, number>` counts pickups for the Incident Report.

### 5.8 Phases, scoring, lives

- Phases: `ready` (120 ticks) → `playing` → `dying` (90 ticks) → `ready` or `gameOver`, plus `playing` → `levelClear` (120 ticks) → `ready` (next level). Movement and timers only advance in `playing`. A `gameOver`-phase step clears `events` and increments `tick`, nothing else (5.1).
- Scoring: bug 10, pickup 50, shield block 200, level clear `500 × L`. Lives start at 3 (configurable for tests), with no extra lives.
- Playing step order (binding): (1) `events = []`; (2) `tickPowerUps`; (3) capture `prevOcc` of player and each enemy; (4) player: `invuln = max(0, invuln-1)`, reversal check, advance (48 iff `isActive('lambda')`, else 32), eat bug / collect pickup, warp check; (5) clone advance + eat; (6) enemies in `ENEMY_ORDER`; (7) `resolveCollisions`; (8) `maybeSpawnPickup`, then pickup ttl; (9) level-clear check; (10) time-limit check; (11) `tick++`.
- Collision (binding): with `occ(m) = progress < 128 ? tile : tile + dir`, enemy `e` collides iff `occ(player) == occ(e)` OR (`occ(player) == prevOcc(e)` AND `occ(e) == prevOcc(player)`). Skipped while `player.invuln > 0` and for pen enemies. Enemies are checked in `ENEMY_ORDER`; with Shield the first is blocked and the 30-tick `invuln` covers the rest. `state.lastKiller` records the killer id.
- Level clear (step 9, binding): `bugsLeft === 0` while still `playing` → `+500 × L`, `phase = 'levelClear'`, `phaseTimer = 120`, `levelClear` event, and `active = {}`, `clone = null`, `pickup = null` immediately. The reset table re-applies the clear at the next level start.
- Level clear vs death on the same tick: death wins. The eaten bug stays eaten (`bugsLeft` may be 0). If lives remain, level clear fires on the first `playing` step after respawn; if lives = 0, there is no clear bonus.
- Time limit (binding): in step (10), in every phase, `if (phase !== 'gameOver' && tick === MAX_TICKS - 1) { phase = 'gameOver'; lastKiller = null; gameOverReason = 'timeLimit'; emit gameOver }`. `GameState.gameOverReason: 'caught' | 'timeLimit' | 'qa' | null`; a normal final death sets `'caught'`, `forceGameOver` sets `'qa'`. Every real game therefore ends within `MAX_TICKS` steps and every recorded tick is ≤ 107999.

### 5.9 Replay (`src/shared/replay.ts`)

The replay loop is pinned (binding); the client recorder applies the same rule (5.2), so client and server agree tick for tick:

```ts
export interface ReplayOpts { maxTicks?: number; startLives?: number }
export interface ReplayResult { status: 'complete' | 'timeout'; score: number; level: number; ticks: number; finalState: GameState }

export function replay(seed: number, log: InputLog, opts: ReplayOpts = {}): ReplayResult {
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const s = createGame(seed, opts.startLives === undefined ? {} : { startLives: opts.startLives });
  let i = 0;
  let held: Dir = 0;
  while (s.phase !== 'gameOver' && s.tick < maxTicks) {
    while (i < log.length && log[i]![0] === s.tick) { held = log[i]![1]; i++; } // same rule as the client recorder
    step(s, held);
  }
  return { status: s.phase === 'gameOver' ? 'complete' : 'timeout', score: s.score, level: s.level, ticks: s.tick, finalState: s };
}

export function validateReplay(sub: { seed: number; inputLog: InputLog; claimedScore: number }, opts: ReplayOpts = {}):
  { ok: true; score: number; level: number } | { ok: false; reason: 'replay_incomplete' | 'replay_mismatch'; replayedScore: number };
```

`ReplayOpts` also has a tests-only `maze?: readonly string[]`, passed through as `GameConfig.maze` (so the pinned `createGame` call receives `{ startLives?, maze? }`); the walled-off time-limit cases and the perf test use it, and the Lambda and MCP server never set it.

`MAX_TICKS = 108000` (30 simulated minutes). The engine ends the game during the step at `tick === MAX_TICKS - 1`, after which `tick === MAX_TICKS`, so an honest replay with the default `maxTicks` is always `complete`. `timeout` only happens with a smaller test `maxTicks`. An event recorded at tick 107999 is applied before that final step and counts. Log events whose tick is ≥ the final `state.tick` are never reached and therefore have no effect. Because ticks strictly increase (enforced by `parseSubmission`), the `log[i][0] === s.tick` rule never skips a reachable event. `validateReplay` calls `replay(sub.seed, sub.inputLog, opts)` and accepts if and only if `status === 'complete'` and `score === claimedScore`; otherwise `replay_incomplete` (status `timeout`) takes precedence over `replay_mismatch`.

## 6. Coin/credit & cabinet design (summary; detail in `coin-credit-system/design.md`)

- `credits.ts`: `insertCoin(c)` returns `min(c+1, 99)` and an `accepted` flag. `tryStart(c)` returns `{started: c>=1, credits: c>=1 ? c-1 : c}`. All functions are pure.
- `cabinet.ts`: a pure reducer `reduce(state, event) → {state, effects[]}`. Screens: `attract`, `playing`, `incident`, `initials`, `highscores`. Events and effects (copied from `coin-credit-system/design.md`):

```ts
type CabinetEvent =
  | { type: 'coin' } | { type: 'start'; seed: number } | { type: 'confirm' }
  | { type: 'gameOver'; summary: GameSummary; qualifies: boolean }
  | { type: 'initialsKey'; key: InitialsKey } | { type: 'uiTick' }
  | { type: 'remoteStatus'; status: 'idle'|'submitting'|'verified'|'rejected'|'offline'; detail?: string }
  | { type: 'localSaved'; rank: number | null };
type Effect =
  | { type: 'sfx'; name: SfxName } | { type: 'startEngine'; seed: number }
  | { type: 'saveLocalScore'; entry: { initials: string; score: number; level: number } }
  | { type: 'submitRemote'; submission: { initials: string; seed: number; inputLog: InputLog; claimedScore: number } };
```

- Credits persist only in memory (a power cycle resets the cabinet, like real hardware).
- Keys (binding, finding #1): coin is `C` on every screen except `initials`, and `5` on every screen. On `initials`, every `/^[a-zA-Z]$/` key maps only to `initialsKey({char})`, only Arrow keys navigate, Enter confirms, and C/M/P/WASD have no hotkey meaning. `M` (mute) works on every screen except `initials`; `P` and WASD only while `playing`. `src/app/keyboard.ts` exports a pure `mapKey(screen, key)` tested in `keyboard.test.ts`.
- Root cause on the Incident Report: `lastKiller !== null` → `"<NAME> CAUGHT KIRO"` (LATENCY, THROTTLE, COLD START, OUTAGE); `timeLimit` → `"SHIFT ENDED (30:00)"`; `qa` → `"MANUAL FAILOVER"`.
- If `inputLog.length > 10000` at game over, no `submitRemote` is emitted and `remoteStatus = 'rejected'` with detail "LOG TOO LONG" (unit test in `cabinet.test.ts`).
- `remoteStatus` transitions (binding): when `reduce` emits `submitRemote` it sets `remoteStatus = 'submitting'` in the same result. When the emission is suppressed: tainted → `idle`; offline → `offline`; log too long → `rejected` with `remoteDetail = 'LOG TOO LONG'`. Later `remoteStatus` events from the effect executor set `verified` / `rejected` / `offline`.
- Game-over detection in the app (binding): `src/app/main.ts` does not scan `state.events` for game over. After every `engine.step` call and after every QA mutator call, it runs `if (state.phase === 'gameOver' && !session.gameOverSent) { session.gameOverSent = true; dispatch({ type: 'gameOver', summary, qualifies }) }`. `session.gameOverSent` is reset when a `startEngine` effect creates a new game. The check is the pure helper `checkGameOver(state, session)` in `src/app/session.ts`, unit tested in `session.test.ts`. Audio still plays the game-over SFX from the `gameOver` event when one is present in `state.events`. The cabinet still ignores a second `gameOver` while on `incident` (defense in depth).
- `online` is decided once: `main.ts` awaits `loadConfig()` (≤ 2 s) and then calls `initialCabinet(apiUrl !== null)`.

## 7. Leaderboard & backend design (summary; detail in `leaderboard/design.md`)

### 7.1 Local

`ranking.ts` (pure): `insertScore(list, entry) → {list, rank | null}` keeps the list sorted by score descending. On equal scores the earlier entry ranks higher. Length is capped at 10. `qualifies(list, score)` returns true when `score > 0` and (length < 10 or score > the lowest score). `localStore.ts` wraps an injected `Storage`-like object under key `kiroman.highscores.v1`, validates on load, and drops invalid entries.

### 7.2 Remote client

`remoteClient.ts` takes an injected `fetch` and `apiUrl`. `getTop()` and `submit(sub)` use a 3 s timeout through an injected `AbortSignal` factory, and both return a `Result` without throwing. The app reads `./config.json` (`{"apiUrl": "https://..."}`) at boot with a 2 s timeout. If the file is missing or invalid, the game runs offline for the session: local scores only, and the high-score screen shows "OFFLINE".

Status mapping (binding): any 2xx whose body matches `{accepted: true, score: int, level: int}` → ok → `verified`; a 2xx with any other body → `bad_response` → `offline`; 400/413/422 → `{kind:'rejected', error: body.error}` → `rejected`; any other non-2xx (`http`), network, timeout, or unparseable body (`bad_response`) → `offline`. A failed `getTop` shows OFFLINE in the global panel and does not change `online`.

### 7.3 Submission schema (`src/shared/submission.ts`, shared by Lambda + MCP)

| Field | Rule |
|---|---|
| `initials` | required string, `^[A-Z]{3}$` |
| `seed` | required integer, 0..4294967295 |
| `inputLog` | required array, length 0..10000. Each item is `[tick, dir]` with tick an integer in 0..MAX_TICKS-1, strictly increasing, and dir an integer in 0..4 |
| `claimedScore` | required integer, 0..10,000,000 |
| Unknown keys | rejected |

### 7.4 CDK stack `KiroManStack` (environment-agnostic, synth only)

- DynamoDB `ScoresTable`: `PAY_PER_REQUEST`, PK `pk` (S, always `"GLOBAL"`), SK `sk` (S, `${score.toString().padStart(10,'0')}#${isoTime}#${uuid}`), `RemovalPolicy.DESTROY` (demo project, documented).
- Lambda `ScoresFn`: `NodejsFunction`, `NODEJS_22_X`, entry `lambda/scores-handler.ts`, 1024 MB, 15 s timeout, env `TABLE_NAME`, `MAX_BODY_BYTES=131072`. Bundled by the local esbuild (an infra devDependency), so no Docker is needed. Logs: `logGroup: new logs.LogGroup(this, 'ScoresFnLogs', { retention: RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY })`. Granted only `dynamodb:PutItem` and `dynamodb:Query` on the table (the handler's write and read calls; least privilege).
- HTTP API `ScoresApi`: routes `ANY /scores` and `ANY /{proxy+}` through one `HttpLambdaIntegration`, so the Lambda answers 404/405 itself (`core.handle`: GET/POST on `/scores` handled, other methods 405, other paths incl. `/scores/` 404). OPTIONS preflight is answered by API Gateway's `corsPreflight`. A stack assertion checks both routes. CORS allows origin `*`, methods GET/POST/OPTIONS, header `content-type`. `createDefaultStage: false` plus an explicit `$default` stage with `autoDeploy` and `throttle: { rateLimit: 10, burstLimit: 20 }`.
- Request size: HTTP API's fixed 10 MB payload cap can't be lowered, so the Lambda enforces 128 KiB (after base64 decoding) and returns 413. The input log is capped at 10,000 events.
- Hosting: S3 bucket (block all public access, `enforceSSL`, S3-managed encryption, `autoDeleteObjects`, DESTROY) plus a CloudFront `Distribution` using `S3BucketOrigin.withOriginAccessControl`, `defaultRootObject: index.html`, and `REDIRECT_TO_HTTPS`. If `../dist` exists at synth time, a `BucketDeployment` uploads it along with `Source.jsonData('config.json', { apiUrl: api.apiEndpoint })`, with its own `LogGroup` (one week, DESTROY) for the deployment handler. Otherwise the stack adds an `Annotations.addWarningV2` and skips the deployment, so synth still works before a build.
- Outputs: `ApiUrl`, `SiteUrl`, `TableName`.
- Synth without credentials works because the stack is environment-agnostic, does no context lookups, and bundles locally. Running `npx cdk synth` may print a credentials/notices warning, which the README calls harmless.
- Security note (README, required): the API is unauthenticated. The mitigations are stage throttling, the body-size and input-log caps, strict schema validation, and server-side replay validation, which rejects any score the engine can't reproduce. Residual risk: a bot could play a real game and submit it honestly.

### 7.5 Facts content (draft; MUST be verified via the AWS docs MCP during implementation, A7)

`aws-facts.json`: `[{ id, service, text, sourceUrl }]`. Load-time validation in `facts.ts` (throws): `id` unique and `^[a-z0-9-]+$`; `service ∈ CATALOG_ORDER ∪ {'dynamodb'}`; `text` 1..120 chars and `text.toUpperCase()` uses only `FONT_GLYPHS` (`src/content/glyphs.ts`, which `src/render/font.ts` must fully cover); `sourceUrl` is `https://` on host `docs.aws.amazon.com` or `aws.amazon.com`; ≥ 2 facts per kind and ≥ 2 for dynamodb. Render uppercases fact text. Draft examples: Lambda, "A Lambda function invocation can run for up to 15 minutes."; Shield, "AWS Shield Standard is included automatically at no additional charge."; CloudFront, "CloudFront serves content from a global network of edge locations."; CloudWatch, "CloudWatch alarms can trigger actions such as SNS notifications."; Auto Scaling, "EC2 Auto Scaling can replace instances that fail health checks."; DynamoDB, "On-demand capacity mode bills per request with no capacity planning." `pickFact(servicesUsed, seed)` picks from the facts of the used services, ordered by catalog order, with index `seed % n`. If no service was used, it falls back to the DynamoDB facts.

## 8. Correctness Properties

All PBTs use fast-check with `{ numRuns: PBT_RUNS }` where `PBT_RUNS = 200` (≥ 100), defined in `src/test-support/pbt.ts`. Generated input logs are built from `fc.array(fc.tuple(fc.integer({min:1,max:90}), fc.integer({min:0,max:4})))` of tick deltas, converted to strictly increasing ticks.

| ID | Property | Enforces | Test file |
|---|---|---|---|
| P1a | For any sequence of `coin` / `start` actions from any initial credits in 0..99 through `insertCoin`/`tryStart`: credits stay in 0..99 at every step, `start` succeeds iff credits ≥ 1 beforehand, and a successful start lowers credits by exactly 1 (a failed start changes nothing) | CC-1, CC-2 | `src/arcade/credits.property.test.ts` |
| P1b | Through the cabinet `reduce`, for any sequence interleaving `coin`, `start(seed)`, and a synthetic round trip back to attract (generated only when `screen === 'playing'`: `gameOver({score: 0, …, tainted: false}, qualifies: false)`, then 60 × `uiTick`, then `confirm` (incident → highscores), then `confirm` (highscores → attract); on any other screen the round-trip action is skipped): credits ∈ [0,99]; `start` succeeds iff `screen === 'attract'` and credits ≥ 1 before; a successful start lowers credits by exactly 1, emits exactly one `startEngine`, and sets screen to `playing`; every other `start` changes nothing; `coin` raises credits by 1 (capped at 99) on any screen | CC-1, CC-2, CC-2.3 | `src/arcade/cabinet.property.test.ts` |
| P2a | For any random grid (sizes 5..20, random walls/bugs, 1 spawn): the set of `(x,y)` in `unreachable_bug` errors from `validateMaze` equals the set of bug tiles an independent flood-fill oracle does not reach from `P`. Other error kinds are ignored | GE-2 | `src/engine/maze.property.test.ts` |
| P2b | For every shipped level and any bug index, BFS from `P` reaches that bug; every shipped level passes `validateMaze` (incl. `unreachable_tile`); for every shipped level, `reachableFrom(maze, spawn)` includes `maze.exit` | GE-2 | `src/engine/maze.property.test.ts` |
| P3 | For any seed, input log (≤ 3000 ticks, `startLives` 1..3), and grant list `fc.array(fc.tuple(fc.integer({min:0,max:2999}), fc.constantFrom(...CATALOG_ORDER)), {maxLength: 8})` (before the step at each granted tick, while `phase === 'playing'`, the test calls `applyPowerUp(state, kind)`): after every `step` the player, the clone, and all enemies have `tile` and `tile+dir` (when `progress > 0`) on passable tiles. The main P3 `fc.assert` is unseeded and has no coverage assertion. A second `fc.assert` of the same property with `{ numRuns: PBT_RUNS, seed: 0x4b49524f }` collects counters across its run set and asserts ≥ 1 run with a clone, ≥ 1 `warp` event, and ≥ 1 step with Lambda active (the pinned seed is confirmed to hit all three); the companion unit test `movement.coverage.test.ts` pins one deterministic seed+log+grants case that hits all three | GE-3 | `src/engine/movement.property.test.ts` |
| P4 | For any seed and input log, two independent runs (`createGame` + replay loop) give deep-equal final `GameState` (`JSON.stringify` equal) and equal score; a `cloneState` taken mid-run and continued gives the same result | GE-8 | `src/engine/determinism.property.test.ts` |
| P5 | Fixture `P5_MAZE` (`src/engine/test-fixtures.ts`): a valid maze whose `X` and pen are sealed off by `#` from `P`'s region (enemies release but can never reach the player) with ≥ 100 bugs reachable from `P`. It still passes `validateMaze`, because its `U` and `W` tiles lie in `P`'s region; only `X` and the pen are sealed. Generator: `kind ∈ CATALOG_ORDER`; optional re-pick `R ∈ [T+1, T+duration+60]`; input is always dir 0. T is the first `playing` step: the test steps through `ready` with dir 0, then sets `state.pickup = {kind, at: occ(player), ttl: 600}` so step T's phase (4) collects it (and at step R does the same again); it samples through step `max(T, R) + duration + 60`. Assertions: every timer is ≥ 0 after every step; `isActive` after step s is true iff `s ∈ [T, T+d-1] ∪ [R, R+d-1]` (d = duration); without re-pick the second interval is empty, so it is true after steps T … T+d-1 (exactly `d` samples) and false after T+d. The union also covers `R === T+d` (phase (2) removes the timer, then phase (4) re-collects it) and `R > T+d` (an inactive gap between the intervals). Bounds: a clone lives ≤ 660 ticks, eats ≤ 84 bugs at speed 32, so the level can't clear in the window | GE-6.4 | `src/engine/powerups.property.test.ts` |
| P6 | For any valid list (≤ 10, sorted) and any candidate entry: `insertScore` returns a list sorted descending (stable for ties), length ≤ 10, with all initials matching `^[A-Z]{3}$`; the multiset count of entries deep-equal to the candidate increases by exactly 1 iff `qualifies` was true, otherwise the list is deep-equal to the input; invalid entries are rejected and leave the list unchanged | LB-1, LB-2 | `src/leaderboard/ranking.property.test.ts` |
| P7 | Pure variant: for any seed and input log driven through the client recorder loop with `opts = { startLives: 1, maxTicks: 6000 }`, and `validateReplay(sub, opts)` called with the same `opts`: if the recording ended in `gameOver`, `validateReplay` accepts `claimedScore = recorded score` and rejects every `claimedScore ≠ recorded score` (`replay_mismatch`); if it hit `maxTicks`, it rejects every claim (`replay_incomplete`). Core variant (`infra/lambda/core.property.test.ts`): games recorded with the default config (`createGame(seed)`, 3 lives, no `maxTicks` cap; bounded because every shipped level has `X` reachable from `P` (P2b, §5.3), so Latency's BFS pursuit catches a player whose inputs stop, and the engine time limit caps every game) and `fc.array(..., {maxLength: 20})` logs, with a 120 s per-test timeout; `core.handle` on a fake store returns 201 with exactly one `store.put` for claim = recorded, and 422 `replay_mismatch` with zero `put`s for claim ≠ recorded | LB-5, LB-6 | `src/shared/replay.property.test.ts`, `infra/lambda/core.property.test.ts` |
| P8 | For any JSON value (`fc.jsonValue()` plus mutated valid submissions), `parseSubmission` never throws, and returns ok iff every rule in 7.3 holds | LB-4 | `src/shared/submission.property.test.ts` |
| P9 | For any key sequence fed to the initials-entry reducer, the confirmed initials always match `^[A-Z]{3}$` | CC-7, LB-2 | `src/arcade/initials.property.test.ts` |
| P10 | For any `servicesUsed` and seed, `pickFact` returns a fact whose service is one of the used services (or DynamoDB when none were used), and the result is deterministic | CC-6 | `src/content/facts.property.test.ts` |
| P11 | For any viewport 1..8000 × 1..8000, `integerScale` returns the largest integer s ≥ 1 with 320s ≤ w and 240s ≤ h (1 if none) | AP-1 | `src/render/scale.property.test.ts` |

Brief-mandated properties map as follows: credits → P1a/P1b; pellet reachability → P2a/P2b; no entity in wall → P3; determinism → P4; power-up timers → P5; leaderboard insert → P6 (+P9 initials); server replay → P7. P8, P10, and P11 are extra.

Static and non-PBT guards:

- S1, `tests/static/guard.test.ts`. This is the single definition of every static scan; sections 2, 9.6 and the arcade-presentation spec refer to it.
  - File list: `git ls-files -co --exclude-standard` run from the repo root (tracked plus untracked-not-ignored, via `child_process.execFileSync`), filtered to the text extensions `.ts .mjs .js .json .md .html .css .sh`. `node_modules`, `dist`, `cdk.out` are gitignored and therefore never listed. `package-lock.json` files are always excluded.
  - Forbidden APIs: listed files under the pure dirs (4.1) must not contain the forbidden API names. `src/engine` files must import only from `src/engine` or `src/content/services.json`.
  - TODO scan: every listed file under `src/`, `infra/`, `mcp/`, `scripts/`, `retro-arcade-power/`, `tests/`, excluding `retro-arcade-power/server/**` (third-party bundled code). The pattern is built from split literals so the guard does not match itself: `new RegExp([['TO','DO'], ['FIX','ME'], ['X','XX'], ['not ','implemented']].map(p => p.join('')).join('|'))`. `.agents/` and `.kiro/` are not TODO-scanned (design and review prose legitimately names the tokens).
  - Banned-name scan: every listed file in the repo, including `.agents/`, `.kiro/`, `retro-arcade-power/server/`, `README.md`, `package.json` files, and the guard file itself, using `new RegExp(['pac','[- ]?','man'].join('') + '|' + ['nam','co'].join(''), 'i')`. Design and review documents refer to these names only as "third-party video game trademarks".
  - Asset scan: no image or font files (`git ls-files` entries ending `.png .jpg .gif .ttf .otf .woff .woff2`) under `src/`.
- S2: `infra` `tsc --noEmit` compiles the shared engine with no DOM lib.

## 9. Kiro tooling (required)

### 9.1 Specs
The four spec folders above, each with `requirements.md` (EARS), `design.md` (with a Correctness Properties section), and `tasks.md` (checkboxes that reference requirement IDs).

### 9.2 Steering (`.kiro/steering/`)

| File | Front-matter | Content |
|---|---|---|
| `game-engine.md` | `inclusion: fileMatch`, `fileMatchPattern: "src/**/*.ts"` (no brace glob, A9; the body states the rules bind the pure dirs `src/engine`, `src/shared`, `src/arcade`, `src/content`, `src/leaderboard/ranking.ts`) | Determinism rules from 4.1/5.1. A bad-vs-good example: `Math.random()` vs `nextInt(state.rng, n)`, and `Date.now()` timers vs tick counters. Integer-only sim math, fixed 60 Hz tick, no module state, the events pattern, and "every new mechanic needs a property test" |
| `retro-style.md` | `inclusion: fileMatch`, `fileMatchPattern: "src/render/**/*.ts"` | The KIRO-16 palette hex list (below), 320x240 internal resolution, integer scaling, `imageSmoothingEnabled = false`, CSS `image-rendering: pixelated`, the in-code 5x7 pixel font only, no anti-aliasing, no sub-pixel draws (round with `Math.floor`), 8x8 sprites |
| `aws-content.md` | `inclusion: fileMatch`, `fileMatchPattern: "src/content/**"` | No official AWS logos or icons. Use our own pixel art plus text labels. Use the service names nominatively. "Do not use third-party video game trademarks or character names. Do not reproduce any existing commercial maze layout." Every fact has to be ≤ 120 chars, verified via the AWS docs MCP, and carry a `sourceUrl` on docs.aws.amazon.com or aws.amazon.com, and use only pixel-font glyphs after uppercasing. Includes the exact disclaimer: "KIRO-MAN is an independent fan project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services or any video game publisher. AWS service names are used nominatively. No AWS logos or third-party game assets are included." (the README uses the same text) |
| `tech.md` | `inclusion: always` | Stack and exact versions, commands (4.4), folder layout (4.3), the test naming convention, and "never run `cdk deploy`" |

KIRO-16 palette (index: hex): 0 `#000000`, 1 `#1D2B53`, 2 `#7E2553`, 3 `#008751`, 4 `#AB5236`, 5 `#5F574F`, 6 `#C2C3C7`, 7 `#FFF1E8`, 8 `#FF004D`, 9 `#FFA300`, 10 `#FFEC27`, 11 `#00E436`, 12 `#29ADFF`, 13 `#9046FF` (Kiro purple), 14 `#FF77A8`, 15 `#FFCCAA`.

### 9.3 Hooks (`.kiro/hooks/*.json`, each `{"version":"v1","hooks":[...]}`)

Exact file contents (the `action` wrapper matches lesson3):

```json
// test-on-save.json
{"version":"v1","hooks":[{"name":"Run tests on source save","trigger":"PostFileSave","matcher":"src/.*\\.ts$","action":{"type":"command","command":"npx vitest --run"}}]}
// synth-on-infra-save.json
{"version":"v1","hooks":[{"name":"CDK synth on infra save","trigger":"PostFileSave","matcher":"infra/.*\\.ts$","action":{"type":"command","command":"cd infra && npx cdk synth --quiet"}}]}
// confirm-deploy.json
{"version":"v1","hooks":[{"name":"Confirm before cdk deploy","trigger":"PreToolUse","matcher":"execute_bash|shell","action":{"type":"command","command":"node scripts/confirm-deploy.mjs"}}]}
// pbt-after-task.json
{"version":"v1","hooks":[{"name":"Property tests after task","trigger":"PostTaskExec","matcher":".*","action":{"type":"command","command":"npm run test:pbt"}}]}
```

Trigger names `PreToolUse`/`PostTaskExec` are verified per A8 (create once via the hook UI, copy the generated names).

`scripts/confirm-deploy.mjs` (fails closed): reads stdin to EOF and `JSON.parse`s it. Invalid JSON → exit 0, no output (no position taken; nothing to inspect). It exports a pure `decide(payload, env) → { block: boolean, reason: string | null }` that walks every string value recursively; a match of `/\bcdk\s+deploy\b/` gives `block: true` unless `env.KIROMAN_ALLOW_DEPLOY === '1'`. On block, the script prints `{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"cdk deploy creates real AWS resources and costs; this project is synth-only. Confirm explicitly."}}` to stdout (for runtimes that honor it), writes the reason to stderr, and exits 2 (the widely supported "block" exit code). Otherwise it exits 0 silently. Unit tests cover match, no-match, nested fields, invalid JSON, and the `KIROMAN_ALLOW_DEPLOY=1` override, asserting both `decide` output and the process exit code (via `child_process.spawnSync`).

### 9.4 Custom agents (`.kiro/agents/`, lesson7 format)

Exact contents (lesson7 keys; `model` omitted per A5):

```json
{
  "name": "level-designer",
  "description": "Designs original 40x28 data-center mazes for KIRO-MAN that pass the reachability property test.",
  "tools": ["read", "write", "shell"],
  "excludedTools": ["knowledge"],
  "includeMcpJson": false,
  "includePowers": false,
  "resources": ["file://.kiro/steering/game-engine.md", "file://.kiro/steering/retro-style.md", "file://src/engine/levels.ts"],
  "permissions": { "rules": [ { "capability": "shell", "match": ["npm *", "npx vitest *"], "effect": "allow" } ] },
  "prompt": "You are the KIRO-MAN level designer. Design original 40x28 ASCII data-center mazes in src/engine/levels.ts using the legend: # rack wall, . bug, space floor, P player spawn, E pen floor, = pen door, X pen exit directly above the door, U power-up slot, W CloudFront edge pad. Every layout needs a solid # border, exactly 1 P, exactly 1 X, 4 to 8 E, 3 to 6 U, exactly 4 W, and every bug reachable from P. X must be reachable from P, and every U and W must be reachable from P. Make corridors that reward Throttle's cut-off and Outage's darkness. Do not use third-party video game trademarks or character names. Do not reproduce any existing commercial maze layout. After every edit run `npx vitest --run src/engine/maze` and iterate until properties P2a and P2b pass.",
  "welcomeMessage": "Level designer online. Which hall should I build or rework: HALL-A, HALL-B or HALL-C?"
}
```

```json
{
  "name": "cabinet-tech",
  "description": "Operates the KIRO-MAN cabinet: tests, CDK synth/diff, IaC validation and leaderboard checks. Never deploys without explicit approval.",
  "tools": ["read", "shell"],
  "includeMcpJson": true,
  "includePowers": true,
  "resources": ["file://.kiro/steering/tech.md", "file://README.md"],
  "permissions": { "rules": [ { "capability": "shell", "match": ["npm *", "npx cdk synth*", "npx cdk diff*", "git *"], "effect": "allow" } ] },
  "prompt": "You are the KIRO-MAN cabinet technician. Keep the machine healthy: run npm test, npm run synth and npm run cfn-lint, validate the synthesized template with the aws-infrastructure-as-code power, and check leaderboards and replays with the arcade-operator MCP tools (get_leaderboard, validate_replay, list_power_ups). This project is synth-only: never run cdk deploy unless the user explicitly asks in this conversation, and explain costs first. Report findings briefly with file paths.",
  "welcomeMessage": "Cabinet tech here. Want a health check (tests, synth, IaC validation) or a leaderboard audit?"
}
```

`cdk deploy` is not pre-approved, so it falls back to an approval prompt, and the confirm-deploy hook adds a fail-closed second gate.

### 9.5 MCP (`.kiro/settings/mcp.json`)

```json
{ "mcpServers": {
  "aws-docs": { "command": "uvx", "args": ["awslabs.aws-documentation-mcp-server@1.2.2"],
                "env": { "FASTMCP_LOG_LEVEL": "ERROR", "AWS_DOCUMENTATION_PARTITION": "aws" }, "disabled": false },
  "arcade-operator": { "command": "node", "args": ["mcp/arcade-operator/dist/index.js"],
                "env": { "KIROMAN_API_URL": "" }, "disabled": false } } }
```

`arcade-operator` uses `McpServer` + `StdioServerTransport`, is bundled with esbuild to `dist/index.js`, and pulls in `src/shared`, `src/engine`, `src/leaderboard/ranking.ts`, and `src/content/services.json`. It logs only to stderr. Tools:

`awslabs.aws-documentation-mcp-server` is pinned to 1.2.2 (latest on PyPI at design time, checked via the PyPI JSON API).

- `get_leaderboard({ source?: "auto"|"remote"|"local" = "auto" })`: remote reads `KIROMAN_API_URL` + `/scores` with a 3 s timeout. Local reads `KIROMAN_LOCAL_SCORES`, or by default `path.resolve(process.cwd(), 'mcp/arcade-operator/data/local-scores.json')`, and normalizes it with `ranking.normalize`. A missing file returns `{ scores: [], note: "no local scores file" }`, not an error. Real data comes from `scripts/screenshots.mjs`, which after shot 08 writes `localStorage.getItem('kiroman.highscores.v1')` (normalized) to that file and writes `window.__KIROMAN_QA__.getLastSubmission()` to `mcp/arcade-operator/data/sample-replay.json`; the README demo calls `validate_replay` with that sample. In `auto` mode a missing URL or failed remote falls back to local, with a `note`. With an explicit `remote` source, a failure returns `isError: true` and a message.
- `validate_replay({ seed, inputLog, claimedScore })`: validates with the shared schema (initials not required). On a schema failure it returns `isError` with the field errors. Otherwise it returns `{ valid, status, replayedScore, claimedScore, level, ticks }`.
- `list_power_ups()`: returns the `services.json` catalog.

Tool handlers live in `src/tools.ts` as pure-ish functions with injected `fetch`/`readFile`, so they can be unit tested. `index.ts` only wires them up.

### 9.6 Powers

- Using a power (evidence-based): the `aws-infrastructure-as-code` power is installed locally (verified). While writing `kiro-man-stack.ts` the coder uses its `search_cdk_documentation` / `cdk_best_practices` tools and cites them in code comments. After `npm run synth`, the coder invokes its `validate_cloudformation_template` (cfn-lint) and `check_cloudformation_template_compliance` (cfn-guard) on `infra/cdk.out/KiroManStack.template.json` and saves the outputs to `docs/power-iac-validation.md` with each finding fixed or justified. The README's Kiro feature map links that file. As the reproducible CLI path, `scripts/cfn-lint.sh` runs `uvx cfn-lint==1.57.1 infra/cdk.out/KiroManStack.template.json` (pinned for reproducibility) (uvx is present on this machine) and writes the output to `docs/cfn-lint-report.txt`. It also runs `cfn-guard` if it's installed and otherwise records "cfn-guard not installed".
- Packaged power `retro-arcade-power/` ships both layouts (A2):
  - `POWER.md`: front-matter `name: "retro-arcade-power"`, `displayName: "Retro Arcade (Deterministic Canvas Games)"`, `description`, `keywords` (same list as `plugin.json`), `author: "Andres Zeballos"`. Body: Overview, Onboarding (prerequisite `npm run build:mcp`, then set the absolute server path), the arcade-operator tools, workflows (add a deterministic mechanic, validate a replay, build a pixel-art screen), troubleshooting.
  - `steering/`: `determinism-checklist.md`, `fixed-timestep-loop.md`, `replay-validation.md`, `pixel-art-canvas.md` (same content as the skill references).
  - `server/arcade-operator.mjs`: the esbuild bundle, copied by `mcp/arcade-operator/scripts/copy-to-power.mjs` during `npm run build:mcp` and committed, so the power works outside this repo.
  - `plugin.json`: `{ "name": "retro-arcade-power", "displayName": "Retro Arcade (Deterministic Canvas Games)", "version": "1.0.0", "description": ..., "keywords": ["retro","arcade","8-bit","pixel art","canvas game","deterministic","replay","leaderboard"], "author": "Andres Zeballos", "license": "MIT", "skills": ["skills/deterministic-canvas-games"], "mcp": "mcp.json" }`
  - `skills/deterministic-canvas-games/SKILL.md`: front-matter `name` and `description`, then when to use it, the workflow, and links to `references/determinism-checklist.md`, `references/fixed-timestep-loop.md`, `references/replay-validation.md`, `references/pixel-art-canvas.md` (each a real, complete guide with code).
  - `mcp.json`: `{"mcpServers":{"arcade-operator":{"command":"node","args":["${ABSOLUTE_PATH_TO}/retro-arcade-power/server/arcade-operator.mjs"],"env":{"KIROMAN_API_URL":"","KIROMAN_LOCAL_SCORES":""},"disabled":false}}}`. The README explains replacing `${ABSOLUTE_PATH_TO}` after install. The workspace `.kiro/settings/mcp.json` keeps the repo-relative `mcp/arcade-operator/dist/index.js` (A3).
  - `README.md`: install (Kiro Powers panel, then "add from local folder" or a GitHub URL), the trigger keywords, its contents, the prerequisite (`npm run build:mcp`), and the recorded result of actually installing it from the local folder on this machine (exact steps confirmed, or the failure and workaround).
  - Static scans: see S1 (section 8). The TODO scan excludes `retro-arcade-power/server/**`; the banned-name scan includes it.

### 9.7 Headless verification

`scripts/screenshots.mjs` (Playwright Chromium, headless) starts `npm run preview`, waits for port 4173, and opens `/?qa=1`. It captures `docs/screenshots/01-attract.png`, `02-credit.png` (after `C`), `03-ready.png` (after Enter), `04-gameplay.png` (after 3 s of scripted arrows), `05-cloudwatch.png` (QA grant cloudwatch + outage visible), `06-incident-report.png` (QA force game over), `07-initials.png`, and `08-highscores.png` (after typing `KIR` + Enter). It fails with exit 1 on any `console.error`, `pageerror`, or missing canvas. It always kills the preview server. QA hooks (`src/app/qa.ts`) attach only when `?qa=1` is present: `window.__KIROMAN_QA__ = { grantPowerUp(kind), releaseEnemies(), setInvulnerable(ticks), forceGameOver(), getScreen(), getScore(), getLastSubmission() }`. In QA mode only, `&seed=<uint32>` replaces the crypto seed. Using any mutator sets `session.tainted = true`, which blocks remote submission. Local saves are still allowed so the screenshots can show the flow.

Pinned script (binding): the page opens `/?qa=1&seed=3735928559`; the arrow script is a fixed constant array of `[key, holdFrames]` in `scripts/screenshots.mjs`. Shot 05: `grantPowerUp('cloudwatch')`, `releaseEnemies()`, `setInvulnerable(600)`, wait 120 frames, capture (Outage is out, so darkness shows). Before `forceGameOver`, the script asserts `getScore() > 0`; if not, it holds arrows (cycling R, D, L, U, 30 frames each) until it holds or 10 s pass, then fails with exit 1. After `forceGameOver` it waits until `getScreen() === 'incident'` (the app's phase-based detection, section 6), captures shot 06, then waits 70 frames (past the 60-tick Enter lockout, CC-5.2) before pressing Enter. After shot 08 it exports the local scores and `getLastSubmission()` for the MCP server (9.5). Frame waits use `page.evaluate` over `requestAnimationFrame` counts, not wall-clock sleeps. `index.html` includes `<link rel="icon" href="data:,">`, because Vite's preview HTML fallback excludes `/favicon.ico` and the resulting 404 could log a console error that fails the run.

## 10. Error handling summary

| Operation | Failure | Recoverable? | Caller gets | Logging |
|---|---|---|---|---|
| `createGame` with an invalid shipped maze | validation fails | Fatal (programming error) | throws `InvalidMazeError` | none in engine; app catches at boot, shows "MAZE ERROR" screen, `console.error` |
| `createGame` with `startLives` not an integer in 1..9 | bad config | Fatal (programming error) | throws `RangeError` | none in engine; unit test |
| `parseMaze` on input (tests/agent) | malformed | Recoverable | `Result.err(MazeError[])` | none |
| Load `config.json` | 404/timeout/invalid JSON/bad URL | Recoverable → offline | `{apiUrl: null}` | `console.info("offline mode: <reason>")` |
| localStorage read | unavailable/throws/corrupt JSON/invalid entries | Recoverable | empty list (or the valid subset); falls back to in-memory store if unavailable | `console.warn` once |
| localStorage write | quota/throws | Recoverable | in-memory list still updated | `console.warn` |
| Remote GET/POST | network, timeout, non-2xx, bad JSON | Recoverable | `Result.err({kind})`; UI shows OFFLINE / REJECTED | `console.warn` |
| AudioContext create/resume | unsupported/blocked | Recoverable | SFX become no-ops | `console.info` once |
| Lambda: body > 128 KiB | — | Client error | 413 `{error:"payload_too_large"}` | `info` |
| Lambda: bad JSON / schema | — | Client error | 400 `{error:"invalid_request", details:[...]}` | `info` (no body echo) |
| Lambda: replay mismatch/incomplete | — | Client error | 422 `{error:"replay_mismatch"|"replay_incomplete"}` | `warn` with seed, claimed, and replayed values |
| Lambda: DynamoDB error | throttling/service | Retry is the client's choice | 503 `{error:"storage_unavailable"}` | `error` with the AWS error name |
| Lambda: other method on `/scores` / other path (both routed via `ANY`) | — | Client error | 405 `{error:"method_not_allowed"}` / 404 `{error:"not_found"}` | `info` |
| Remote POST answered 400/413/422 | — | Recoverable | `rejected` → REJECTED | `console.warn` |
| MCP tool input invalid | — | Recoverable | `isError: true`, text listing errors | stderr |
| confirm-deploy hook bad stdin | — | Recoverable | no output, exit 0 | none |
| confirm-deploy hook sees `cdk deploy` | — | Blocked (fail closed) unless `KIROMAN_ALLOW_DEPLOY=1` | JSON `ask` on stdout, reason on stderr, exit 2 | stderr |
| Client game hits `MAX_TICKS - 1` | — | Normal end | `gameOver` with reason `timeLimit` | none |
| Input log > 10000 events at game over | — | Recoverable | no submission; status REJECTED ("LOG TOO LONG") | `console.warn` |
| MCP `get_leaderboard` local file missing | — | Recoverable | `{scores: [], note: "no local scores file"}` | stderr info |
| `services.json` / `aws-facts.json` invalid | — | Fatal (content error) | throws at module load; unit test fails | none |

## 11. Out of scope

Real AWS deployment, authentication/accounts, gamepad support, mobile touch controls, extra lives, an online multiplayer mode, a level editor UI, and music tracks (SFX only).

## 12. Implementation task order (umbrella)

1. Root scaffolding: package.json (exact pins), tsconfig, vite/vitest configs, `.npmrc`, `src/test-support/pbt.ts`, static guard test.
2. game-engine spec tasks.
3. coin-credit-system spec tasks.
4. leaderboard spec tasks (pure parts, then Lambda core, then CDK).
5. arcade-presentation spec tasks.
6. Kiro tooling: steering, hooks (verify `PreToolUse`/`PostTaskExec` names via the hook UI, A8) plus the fail-closed confirm-deploy script and tests, agents (exact JSON in 9.4), `.kiro/settings/mcp.json`, the arcade-operator server plus tests, the packaged power (POWER.md + steering + plugin.json + skills + bundled server), `scripts/cfn-lint.sh` plus the report, and `docs/power-iac-validation.md` from the installed IaC power.
7. Headless screenshots (pinned QA seed/script; exports MCP sample data), install the packaged power from its local folder and record the result, README (feature map, disclaimer, security note, steering-glob check), and the final full run: `npm test`, `npm run build`, `npm run synth`, `npm run cfn-lint`, `npm run build:mcp`, `npm run verify:browser`.

## 13. Responses to design review

### 13.1 Pass 2 → pass 3

All 19 findings are addressed; none are backlogged or ignored.

| # | Sev | Resolution |
|---|---|---|
| 1 | MED | Replay loop pinned verbatim in §5.9 (events applied when `log[i][0] === s.tick`, loop `while phase !== 'gameOver' && tick < maxTicks`); "game-over tick" wording removed; GE-8.3 reworded; unit test added (game-engine tasks 13): a time-limit game with an event at tick 107999 replays to a deep-equal final state and the same score, and the event provably took effect (`player.desired`, `progress > 0`, differs from the empty-log replay). The suggested "eats a bug" form was replaced because a stopped player can't eat an adjacent bug in one tick (eating needs `progress ≥ 128`, at least 3 ticks at speed 48) |
| 2 | MED | `events = []` first in every phase; `gameOver`-phase step is clear + `tick++` only (§5.1, §5.8); app detects game over by phase after every step and QA call with `session.gameOverSent` (§6); CC-5.1 reworded; screenshot script waits on `getScreen() === 'incident'` (§9.7) |
| 3 | MED | Binding warp check pseudocode with `tileChangedThisStep || progress === 0`, leftover dropped (§5.7, GE-6.8, game-engine design); unit test with Lambda + CloudFront crossing a pad with leftover progress |
| 4 | MED | `P5_MAZE` fixture with enemies sealed off from `P` and ≥ 100 bugs; T = first playing step; bounded R and sample window; dir 0 input; "enemy-free" removed (§8 P5, game-engine P5) |
| 5 | MED | P7 core variant records with default config, `maxLength: 20` logs, 30 s timeout, asserts 201 + one `put` vs 422 + zero `put`s; pure variant passes the same `opts` to recorder and `validateReplay` (§8 P7, leaderboard design) |
| 6 | MED | P3 grant list via `applyPowerUp` before granted ticks; coverage counters for clone, warp, Lambda plus a deterministic companion unit test (§8 P3) |
| 7 | MED | One S1 definition: `git ls-files -co --exclude-standard` + text-extension filter; TODO scan over `src/ infra/ mcp/ scripts/ retro-arcade-power/ tests/` with split-literal pattern; banned-name scan over every listed file incl. `.agents/` and `.kiro/` (§8 S1; §2.10, §9.6, AP AC-3 point to it) |
| 8 | NIT | Outage candidates in `DIR_ORDER`, always exactly one `pick` draw (§5.6) |
| 9 | NIT | `createGame` initial state and same-step phase transitions (§5.1, game-engine design) |
| 10 | NIT | `Result<Maze, MazeError[]>` everywhere (§5.3) |
| 11 | NIT | Any 2xx with the accepted body → verified; other 2xx → `bad_response` (§7.2, leaderboard design) |
| 12 | NIT | `submitting` set on `submitRemote` emission; suppressed-case statuses defined (§6, coin-credit design) |
| 13 | NIT | CC-8.2 repeats the taint and log-cap suppression |
| 14 | NIT | `createGame` throws `RangeError` for `startLives` outside integer 1..9 (§5.1, §10) |
| 15 | NIT | P2a compares `unreachable_bug` coordinate sets exactly (§8) |
| 16 | NIT | Clone first advances in phase (5) of its spawn step; Cold Start decrement → toggle → decide (§5.6, §5.7) |
| 17 | NIT | Infra `tsconfig` excludes root tests and `test-support`; infra `test` script `vitest --run --dir test` (`--dir` instead of the suggested bare filter, which would also match `lambda/*.test.ts`) (§4.2) |
| 18 | NIT | Screenshot script waits 70 frames after shot 06; `<link rel="icon" href="data:,">` in `index.html` (§9.7) |
| 19 | NIT | Shield re-pick wording: timer resets to 600, a block increments `shieldBlocks` by exactly 1 (§5.7, game-engine edge cases) |

### 13.2 Pass 3 → implementation

All 12 pass-3 findings are applied to the spec text before implementation; none are backlogged or ignored.

| # | Sev | Resolution |
|---|---|---|
| 1 | MED | P5 oracle is the interval union: `isActive` after step s iff `s ∈ [T, T+d-1] ∪ [R, R+d-1]`, second interval empty without re-pick; covers `R === T+d` and `R > T+d` (§8 P5, game-engine design P5) |
| 2 | MED | P1b round trip generated only on `playing`: `gameOver(score 0, qualifies false)`, 60 × `uiTick`, `confirm`, `confirm`; skipped on other screens (§8 P1b, coin-credit design P1b) |
| 3 | MED | `validateMaze` requires every `U` and `W` reachable from `P` (new `MazeError` `unreachable_tile`); P2b asserts `X` reachable for shipped levels; P7 core bound cites it; level-designer prompt updated; `P5_MAZE` still valid (§5.3, §8 P2b/P7, §9.4, GE-2.3, game-engine design) |
| 4 | MED | P3 main `fc.assert` unseeded without coverage; second `fc.assert` pinned to `seed: 0x4b49524f` asserts the clone/warp/Lambda counters; `movement.coverage.test.ts` kept (§8 P3, GE AC-13, game-engine design P3) |
| 5 | NIT | Release timing pinned: `releaseIn === 0` releases this step, otherwise decrement and release on reaching 0 in the same step (§5.6, game-engine design "Release") |
| 6 | NIT | `applyPowerUp` applies exactly the collection effect and does NOT add the 50-point pickup score (§5.7, game-engine `powerups.ts` row) |
| 7 | NIT | CC-8.2 non-qualifying `submitRemote` is emitted in the `reduce` result for the `confirm` leaving `incident` (CC-8.2, coin-credit design) |
| 8 | NIT | The clone eats the bug at `occ(clone)` (§5.7, game-engine design "Clone targeting") |
| 9 | NIT | `pick(r, arr) = arr[nextInt(r, arr.length)]` (§5.1, game-engine `rng.ts` row) |
| 10 | NIT | CC-8, leaderboard AC, and arcade-presentation AC renumbered sequentially by position; no cross-references needed updating |
| 11 | NIT | P7 core per-test timeout raised to 120 s (§8 P7, leaderboard design P7, leaderboard task 9) |
| 12 | NIT | Level clear (step 9) clears `active`, `clone`, `pickup` immediately; the reset table re-applies it (§5.8, GE-6.10, game-engine design) |

### 13.3 Pass 1 → pass 2

All 31 findings are addressed; none are backlogged or ignored.

| # | Sev | Resolution |
|---|---|---|
| 1 | HIGH | Per-screen `mapKey`; letters only type on `initials`; coin key `5` everywhere; CC-1.1, CC-7.2, AP-5.3, AP-6.3 reworded; `keyboard.test.ts` added (§6, coin-credit design) |
| 2 | HIGH | Power ships `POWER.md` + `steering/` and `plugin.json` + `skills/`; A2 rewritten; local-install task added (§9.6, §12) |
| 3 | HIGH | Engine ends the game at `MAX_TICKS - 1` with `gameOverReason: 'timeLimit'`; 10000-event client cap; root-cause texts; walled-off time-limit test (§5.8, §6, GE-5.2a, GE-8.0) |
| 4 | HIGH | `tickPowerUps` runs first; `isActive` defined; exact P5 oracle in §5.7, §8, GE-6.4, game-engine design |
| 5 | MED | `dir 0` keeps `desired`; recorder starts `last = 0`; reversal before advance (§5.2, GE-3.4a) |
| 6 | MED | `ENEMY_ORDER`, row-major homes/pads, release state, Cold Start toggle, shield-block return, full reset table; pickup clearing reconciled with GE-6.10 (§5.6, §5.7) |
| 7 | MED | `prevOcc` captured at step start; formal swap predicate; invuln decrement timing; level-clear-vs-death edge case clarified (§5.8) |
| 8 | MED | Clone bugs count; `>=` threshold then `+= 60`; skip-not-defer; kind-then-slot draw; player-only pickups (§5.7, GE-6.2) |
| 9 | MED | `Phase`, `GameConfig`, `Maze`, `MazeError`, `GameEvent` defined verbatim in game-engine design |
| 10 | MED | `services.json` schema and CATALOG_ORDER; facts load-time rules incl. glyph coverage; render uppercases (§5.7, §7.5, CC-6.3/6.4) |
| 11 | MED | P1 split: P1a (pure credits) and P1b (cabinet, `screen === 'attract'`, round-trip generator) |
| 12 | MED | Exact hook JSON with `action` wrapper; A8 trigger verification; confirm-deploy fails closed (exit 2 + stderr, JSON ask on stdout, env override) |
| 13 | MED | Bundler resolution + resolveJsonModule in root and infra; infra/MCP devDeps and MCP build script pinned (§4.2, leaderboard design) |
| 14 | MED | `ANY /scores` + `ANY /{proxy+}` to Lambda; core owns 404/405; stack assertion (§7.4, LB-6.2) |
| 15 | MED | Status mapping table; config awaited before `initialCabinet`; `online` fixed per session (§7.2, LB-7.2/7.2a) |
| 16 | MED | Screenshot script exports real local scores and a real replay; bundle copied into the power; absolute-path `mcp.json`; cwd-based default data path; missing file is not an error (§9.5, §9.6) |
| 17 | MED | IaC power tools run on the synthesized template, results in `docs/power-iac-validation.md`; CDK docs tools cited (§9.6, leaderboard task 13) |
| 18 | MED | QA `seed` param, `releaseEnemies`, `setInvulnerable`, `getScore`, `getLastSubmission`; pinned seed/script; score > 0 assertion (§9.7) |
| 19 | MED | Exact name-free disclaimer; name-free steering/agent wording; S1 split-literal regex over more dirs; GE AC-2 uses the 40x28 vs 28x31 argument |
| 20 | NIT | mulberry32 pinned with golden values computed in Node 22 |
| 21 | NIT | `bugs: number[]` |
| 22 | NIT | `CabinetEvent`/`Effect` unions copied into §6 |
| 23 | NIT | `public/config.json` added to `.gitignore` (done in this pass) |
| 24 | NIT | `awslabs.aws-documentation-mcp-server@1.2.2` (PyPI latest at design time) |
| 25 | NIT | No brace glob; `src/**/*.ts`; in-Kiro check recorded in README (A9) |
| 26 | NIT | Lambda 1024 MB and local perf gate tightened to < 1.5 s |
| 27 | NIT | `reverse(0) = 0`, BFS rules, `bfsNextStep` 0 means stay, `isDark` false in pen (§5.6) |
| 28 | NIT | Explicit `logs.LogGroup` with one-week retention |
| 29 | NIT | P6 uses multiset-count wording |
| 30 | NIT | Full agent JSON incl. `name`, `description`, `prompt`, `welcomeMessage` (§9.4) |
| 31 | NIT | Re-pick keeps the existing clone; clone spawns at `player.tile`, `dir 0`, `progress 0` (§5.7) |
