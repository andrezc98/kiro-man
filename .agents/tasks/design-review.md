# Design Review — KIRO-MAN (design pass 3)

Reviewed: `.agents/tasks/design.md` (byte-identical to `.kiro/specs/_design-overview.md`, checked with `diff`) plus `requirements.md` / `design.md` / `tasks.md` for `game-engine`, `coin-credit-system`, `leaderboard`, `arcade-presentation`. No build or test suite was run (design only).

Verdict: **CHANGES_REQUESTED** (0 HIGH, 4 MEDIUM, 8 NIT)

All 19 pass-2 findings are resolved in the text: the replay loop is pinned verbatim, game-over detection is phase-based, the warp check is binding pseudocode, P5 uses a sealed fixture, P7's core variant uses default config, P3 has grants plus coverage, and S1 has a single scan definition. The determinism contract is complete enough for server replay. What's left are four test-oracle and level-validation gaps. Each is a one- or two-sentence edit.

Note on the gate: the orchestrator asked that only HIGH findings block and that MEDIUMs go under a "carry-forward" heading. This reviewer's operating rules require a mechanical verdict (any HIGH or MEDIUM → CHANGES_REQUESTED) and forbid an informational or carry-forward section. The step prompt also says MEDIUM blocks. The severities below are my honest assessment and were not changed in either direction. Every MEDIUM is a small text edit, listed with its exact fix.

---

## Findings

### 1. MEDIUM — The P5 re-pick oracle is wrong when R > T+duration
Where: overview §8 P5, game-engine design P5 ("with re-pick, true through R+duration-1 and false after R+duration").
Problem: R is generated in `[T+1, T+duration+60]`. When `R > T+duration`, the timer expires at step T+duration and stays inactive through step R-1. The literal oracle ("true through R+duration-1") implies one contiguous active window from T, so correct code fails the test.
Fix: replace the re-pick assertion with: "`isActive` after step s is true iff `s ∈ [T, T+d-1] ∪ [R, R+d-1]`. Without re-pick, the second interval is empty." This also covers `R === T+d` correctly: phase (2) removes the timer, then phase (4) re-collects it.

### 2. MEDIUM — The P1b round trip can't return to attract as written
Where: overview §8 P1b, coin-credit design P1b ("`gameOver` … then `confirm` until the screen is `attract`").
Problem: CC-5.2 ignores Enter for 60 UI ticks on `incident`, so a confirm-only loop never leaves `incident` and the generator never terminates. `gameOver` is also only meaningful while `screen === 'playing'`, which the generator doesn't state.
Fix: "Round trip (generated only when `screen === 'playing'`): `gameOver({score: 0, …, tainted: false}, qualifies: false)`, then 60 × `uiTick`, then `confirm` (incident → highscores), then `confirm` (highscores → attract). On any other screen the round-trip action is skipped." Score 0 means no remote submission, so effects stay limited to `startEngine`/`sfx`.

### 3. MEDIUM — Shipped levels don't require `X`, `U`, or `W` to be reachable from `P`
Where: §5.3, GE-2.3, P2b, and the P7 core variant ("bounded because Latency's BFS pursuit catches a player").
Problem: `validateMaze` only checks bug reachability, which is intentional because `P5_MAZE` seals off `X`. Nothing stops a shipped layout from having:
- an isolated `W`: a warp strands the player there, and the game runs to the 30-minute time limit;
- an unreachable `U`: pickups can't be collected;
- an `X` region disconnected from `P`: enemies can never reach the player. That makes P7 core runs go up to 108000 ticks each, which blows the 30 s budget.
Fix: (a) `validateMaze` also requires every `U` and `W` tile to be reachable from `P` (new `MazeError` `{ kind: 'unreachable_tile'; tile: 'U'|'W'; x; y }`; `P5_MAZE` can still satisfy it). (b) P2b adds: for every shipped level, `reachableFrom(maze, spawn)` includes `maze.exit`. The level-designer agent prompt adds "X must be reachable from P".

### 4. MEDIUM — The P3 coverage assertion is probabilistic and can flake
Where: §8 P3, GE AC-13 ("coverage counters across the run set must show ≥ 1 run with a clone, ≥ 1 warp …").
Problem: fast-check uses a fresh random seed on each run. Whether any of 200 random runs puts the player on a pad during a CloudFront window is chance, so CI can fail intermittently on correct code.
Fix: keep the main P3 `fc.assert` unseeded, with no coverage assertion. Add a second `fc.assert` over the same property with a pinned `{ numRuns: PBT_RUNS, seed: 0x4b49524f }` that asserts the counters (the coder confirms once that the pinned seed hits all three), plus the existing deterministic `movement.coverage.test.ts`.

### 5. NIT — Release timing for `releaseIn = 0` isn't pinned
Where: §5.6 / game-engine "Release".
Fix: "In phase (6), a pen enemy with `releaseIn === 0` releases this step. Otherwise `releaseIn -= 1`, and if that reaches 0 it releases in the same step." Latency (delay 0) then releases on the first `playing` step.

### 6. NIT — `applyPowerUp` side effects are unspecified
Where: game-engine `powerups.ts` (used by P3 grants and QA hooks).
Fix: "`applyPowerUp(state, kind)` applies exactly the collection effect: `active[kind] = duration`, the clone spawn rule, `stats.servicesUsed[kind]++`, and a `powerUpPickup` event. It does NOT add the 50-point pickup score." Alternatively, state that it does add the score. Either works, as long as it's stated.

### 7. NIT — When the CC-8.2 non-qualifying `submitRemote` is emitted isn't stated
Fix: "It is emitted in the `reduce` result for the `confirm` that leaves `incident` for `highscores`."

### 8. NIT — The clone's eat tile isn't stated
Fix: "The clone eats the bug at `occ(clone)`, same as the player."

### 9. NIT — `pick` formula
Fix: "`pick(r, arr) = arr[nextInt(r, arr.length)]`."

### 10. NIT — Requirement numbering is out of order
Where: CC-8 (4 before 3), leaderboard AC (8 before 7), arcade-presentation AC (6, 5, 4 after 3).
Fix: renumber sequentially so task references stay unambiguous.

### 11. NIT — The P7 core budget is tight in the worst case
Where: P7 core (200 runs × record + 2 replays). At the perf-gate bound (108000 ticks per 1.5 s), about 3M ticks can approach 30 s.
Fix: set the per-test timeout to 120 s, or run one `handle` call per run with a random choice between the honest and the altered claim.

### 12. NIT — Level clear vs the active-effect clear moment
Fix: "Level clear (step 9) sets `active = {}`, `clone = null`, `pickup = null` immediately (GE-6.10). The reset table re-applies it at the next level start."

---

## Verified assumptions

- `.agents/tasks/design.md` and `.kiro/specs/_design-overview.md` are byte-identical (`diff`).
- All 19 pass-2 findings have matching text in §5.1, §5.7, §5.9, §6, §7.2, §8, §9.7, the game-engine design, the coin-credit design, the leaderboard design, and AP AC-3/AC-6 (cross-checked against the §13.1 table).
- The replay loop and the client recorder rule agree tick for tick, and the time-limit step at 107999 makes honest default replays `complete`.
- The mulberry32 code and golden values are unchanged from pass 2, where they were verified by execution.
- All 7 Kiro features have concrete file targets: specs §9.1, steering §9.2, hooks §9.3, custom agents §9.4, MCP §9.5, powers §9.6, PBT §8. The packaged power (both layouts, plus the bundled server) is in §9.6. `~/.kiro/powers/installed/aws-infrastructure-as-code` exists.
- Brief-mandated properties map to requirements: P1a/P1b (CC-1/2), P2a/P2b (GE-2), P3 (GE-3.6), P4 (GE-1/8), P5 (GE-6.4), P6 (LB-1/2), P7 (LB-5). All use `numRuns` 200.
- The 4 AIs, 5 power-ups, credit rules (0..99, start iff ≥ 1), and leaderboard constraints (top 10, strict-greater, `^[A-Z]{3}$`, schema bounds) are each pinned with numbers.
- Trademark handling: only a split-literal regex is used, the disclaimer is name-free, and layouts are 40x28 originals. No official AWS logos.

## Unverified / wrong assumptions

- Wrong: the P5 re-pick oracle for `R > T+duration` (#1).
- Wrong: P1b's confirm-only round trip terminates (#2).
- Unverified/wrong: "Latency's BFS pursuit catches a player" is not guaranteed, because nothing requires `X` to be reachable from `P` on shipped levels (#3).
- Unverified (acknowledged A3/A8/A9): the hook trigger names, the MCP cwd, and steering glob behavior. All are deferred to in-Kiro checks.
- Unverified: CDK construct behavior and synth. Not run, per the step instructions.
