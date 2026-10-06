# Requirements — game-engine

## Introduction

This spec covers the deterministic simulation core of KIRO-MAN: the maze, movement, collisions, four enemy AIs, five AWS power-ups, levels, scoring, and replay. It is pure TypeScript with no DOM, runs at a fixed 60 Hz tick, and the browser, the Lambda, and the MCP server all share it. See `../_design-overview.md` for the architecture.

## Quality bar / no scope cuts

All four enemy AIs and all five power-ups are required, each with its full, distinct behavior. Movement must feel smooth (sub-tile fixed-point positions, buffered turns, instant reversal), and difficulty must increase each level. Every correctness property listed in design.md must have a fast-check test at `numRuns >= 100`, and each edge case listed there must have a unit test. No TODO stubs or placeholder bodies. The reviewer rejects anything missing or half-done.

## Requirements

### GE-1 Determinism and time
1. THE SYSTEM SHALL advance the simulation only through `step(state, input)`, one tick per call, where 60 ticks equal one simulated second.
2. THE SYSTEM SHALL obtain all randomness from a seeded mulberry32 PRNG whose state is stored in `GameState`.
3. THE SYSTEM SHALL NOT reference `Math.random`, `Date.now`, `performance.now`, `new Date`, timers, or DOM globals in `src/engine` or `src/shared`.
4. THE SYSTEM SHALL use integer arithmetic only for simulation state, with positions in fixed-point units of 256 per tile.
5. THE SYSTEM SHALL keep all mutable simulation data inside the caller-owned `GameState` object, with no module-level mutable state.
6. WHEN `createGame` is called THE SYSTEM SHALL return a state in phase `ready` with `phaseTimer = 120`, `tick = 0`, `level = 1`, `score = 0`, and `lives = startLives`, and SHALL throw `RangeError` if `startLives` is not an integer in 1..9.
7. WHEN a non-playing phase timer reaches 0 THE SYSTEM SHALL perform the phase transition in that same step.

### GE-2 Maze
1. THE SYSTEM SHALL provide three original 40x28 data-center layouts encoded as ASCII using the legend `# . space P E = X U W`.
2. WHEN a maze is parsed THE SYSTEM SHALL return either a `Maze` or a list of `MazeError`s, without throwing.
3. WHEN a maze is validated THE SYSTEM SHALL reject it unless it has a solid wall border, exactly one `P`, exactly one `X`, 4..8 `E`, 3..6 `U`, exactly four `W`, and every bug tile and every `U` and `W` tile reachable from `P` over player-passable tiles. Every shipped level SHALL also have its `X` reachable from `P`.
4. WHEN `createGame` is given an invalid maze THE SYSTEM SHALL throw `InvalidMazeError`.
5. WHILE on level L THE SYSTEM SHALL use layout `LEVELS[(L-1) mod 3]`.

### GE-3 Movement and walls
1. THE SYSTEM SHALL treat `#` and `=` tiles as impassable for every entity.
2. WHEN an entity is at a tile center THE SYSTEM SHALL start movement only toward a passable neighbor tile.
3. WHEN the player holds a direction that is blocked at the current center THE SYSTEM SHALL keep the player moving in its current direction if that is passable, otherwise stop it.
4. WHEN the player holds a direction that becomes passable at a later center THE SYSTEM SHALL turn the player there (buffered turn).
4a. WHEN the input for a step is 0 (no key held) THE SYSTEM SHALL keep the previously buffered direction, so the player keeps moving until it reaches a wall.
5. WHEN the player holds the reverse of its current direction mid-tile THE SYSTEM SHALL reverse immediately while keeping its on-screen position.
6. THE SYSTEM SHALL never place any entity's tile, or its destination tile while `progress > 0`, on an impassable tile, for any input sequence.

### GE-4 Enemies
1. THE SYSTEM SHALL simulate four enemies, Latency, Throttle, Cold Start, and Outage, released from the pen to tile `X` after level-dependent delays.
2. WHILE released, Latency SHALL follow a BFS shortest path to the player's tile at the slowest enemy speed.
3. WHILE released, Throttle SHALL steer greedily toward the tile four tiles ahead of the player's facing direction, without reversing except at dead ends.
4. WHILE released, Cold Start SHALL alternate between a frozen phase, where it does not move, and a dash phase, where it follows a BFS path to the player at the fastest enemy speed.
5. WHILE released, Outage SHALL choose uniformly at random via the seeded PRNG (exactly one draw per decision, candidates in U, L, D, R order) among non-reverse passable directions at each tile center, and every tile within Manhattan distance 4 of it SHALL be reported as dark.
6. THE SYSTEM SHALL expose each enemy's current target tile in state at every tick.
7. WHEN the level increases THE SYSTEM SHALL increase enemy speeds, shorten release delays, and shorten Cold Start's frozen phase, up to the level-7 cap.

### GE-5 Collisions, lives, phases
1. WHEN the player and an enemy occupy the same tile, or swap tiles within one tick, AND the player has no shield and is not invulnerable THE SYSTEM SHALL enter the `dying` phase, record the enemy as `lastKiller`, and decrement lives.
2. WHEN `dying` ends with lives > 0 THE SYSTEM SHALL reset the player to `P` (stopped, no buffered direction), return every enemy to its row-major pen home with its level release delay, and enter `ready`, keeping the remaining bugs. WHEN lives = 0 THE SYSTEM SHALL enter `gameOver` with reason `caught` and emit a `gameOver` event.
2a. WHEN the tick reaches `MAX_TICKS - 1` (107999) and the game is not over THE SYSTEM SHALL enter `gameOver` with reason `timeLimit` and `lastKiller = null`.
2b. THE SYSTEM SHALL keep `state.enemies` in the fixed order Latency, Throttle, Cold Start, Outage, and resolve every per-tick enemy loop and tie in that order.
3. WHEN all bugs are eaten THE SYSTEM SHALL award `500 × level`, enter `levelClear` for 120 ticks, then load the next level in `ready`.
4. THE SYSTEM SHALL start each game with 3 lives, unless a test config overrides `startLives`.
5. WHILE the phase is not `playing` THE SYSTEM SHALL NOT move entities or decrement power-up timers.

### GE-6 Power-ups
1. THE SYSTEM SHALL read power-up kinds, labels, and durations from `src/content/services.json`.
2. WHEN the bugs eaten this level by the player and the clone reach or pass the next threshold (30, then +60 each) THE SYSTEM SHALL advance the threshold by 60 and, only if no pickup is present, spawn a PRNG-chosen kind on a PRNG-chosen `U` slot not under the player (a threshold crossed while a pickup is present is skipped). The pickup expires after 600 ticks. Only the player collects pickups.
3. WHEN the player touches a pickup THE SYSTEM SHALL award 50 points, set that kind's timer to its full duration (resetting rather than stacking if already active), and increment `servicesUsed[kind]`.
4. WHEN a power-up is collected in step T THE SYSTEM SHALL report it active after steps T through T+duration-1 and inactive after step T+duration (timers decrement at the start of each playing step), and no timer SHALL ever be negative.
5. WHILE Lambda is active THE SYSTEM SHALL set player speed to 48 instead of 32.
6. WHILE Shield is active, WHEN an enemy collides with the player, THE SYSTEM SHALL remove the shield, send that enemy back to the pen with a 120-tick release delay, award 200 points, and make the player invulnerable for 30 ticks.
7. WHILE Auto Scaling is active THE SYSTEM SHALL simulate a single clone (re-picking keeps the existing clone and resets the timer) that spawns on the player's tile, moves along a BFS path to the nearest bug at speed 32, eats bugs for 10 points each, ignores enemies, and is removed on expiry.
8. WHILE CloudFront is active, WHEN the player's tile is edge pad i, that pad is not warp-locked, AND the player either entered that tile during the current step or is stopped on it (progress 0), THE SYSTEM SHALL teleport the player to pad (i+1) mod 4 with progress 0 (dropping any leftover progress, keeping its direction) and lock warping until the player leaves the arrival pad.
9. WHILE CloudWatch is active THE SYSTEM SHALL flag state so the renderer shows every enemy's target tile.
10. WHEN the player dies or a level is cleared THE SYSTEM SHALL clear every active effect, the clone, and any pickup on the field. Level clear (step 9) sets `active = {}`, `clone = null`, `pickup = null` immediately; the reset table re-applies it at the next level start.

### GE-7 Scoring and events
1. THE SYSTEM SHALL award 10 points per bug eaten by the player or the clone.
2. THE SYSTEM SHALL clear `state.events` as the first action of every step, in every phase including `gameOver`, and then fill it with the events produced during that step.
3. WHILE the phase is `gameOver` THE SYSTEM SHALL change nothing in a step except clearing `events` and incrementing `tick`.

### GE-8 Replay
0. THE SYSTEM SHALL end every game in at most `MAX_TICKS` (108000) steps, so every honestly recorded input tick is ≤ 107999.
1. WHEN `replay(seed, inputLog, opts)` runs THE SYSTEM SHALL apply each logged direction from its tick on and step until `gameOver` or `maxTicks`, returning status `complete` or `timeout`, plus the score, level, and tick count.
2. WHEN the same seed and input log are replayed any number of times THE SYSTEM SHALL produce an identical final state and score.
3. WHEN replaying THE SYSTEM SHALL, before each step, apply every log event whose tick equals the current `state.tick`, and loop while the phase is not `gameOver` and `state.tick < maxTicks`. Log events whose tick is ≥ the final `state.tick` are never reached and therefore have no effect.

## Acceptance Criteria

1. `npm run test:pbt` passes properties P2a, P2b, P3, P4, and P5, each at ≥ 100 runs.
2. All three shipped levels pass `validateMaze`. Layouts are 40x28 (the classic arcade maze is 28x31, so no structural copy is possible) and are authored originally with the level-designer agent.
3. Unit tests show each enemy's distinct targeting: Latency's BFS first step, Throttle's 4-ahead target, Cold Start frozen versus dashing positions, and Outage's PRNG choice changing with the seed.
4. Unit tests cover each power-up effect, including shield block scoring, the clone eating a bug, warp pad cycling with lock, and CloudWatch flagged targets.
5. A unit test shows level 2 enemy speeds are higher than level 1, and that speeds stop increasing after level 7.
6. A `replay` of a fixed seed and log gives the same score as a stored golden value (regression test).
7. The static guard test finds no forbidden APIs in `src/engine` or `src/shared`, and `infra` `tsc` compiles them without DOM lib.
8. Replaying `MAX_TICKS` (108000) ticks finishes in under 1.5 s on a developer machine (perf unit test with a 10 s hard timeout and the measured value logged).
9. A unit test shows that a game where the player is walled off from all enemies ends with `gameOverReason = 'timeLimit'` after exactly 108000 steps, and its replay is `complete`.
10. Unit tests pin the timer boundary (active after steps T..T+duration-1, inactive after T+duration), the threshold-skip rule, the row-major pen homes and pads, and the release-keeps-moving input rule.
11. A unit test shows that, with Lambda and CloudFront both active, a player crossing a pad with non-zero leftover progress warps.
12. A unit test shows that a time-limit game with an input event recorded at tick 107999 replays to a deep-equal final state and the same score.
13. P3's main `fc.assert` is unseeded with no coverage assertion; a second `fc.assert` of the same property pinned to `seed: 0x4b49524f` asserts that its run set exercises the clone, at least one warp, and Lambda speed, and a deterministic companion unit test (`movement.coverage.test.ts`) hits all three.

## Out of Scope

Extra lives, enemy-eating "frightened" mode, side wrap tunnels (warps exist only via CloudFront), and a level editor.
