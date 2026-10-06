# Implementation Plan — KIRO-MAN: Outage in the Data Center

Repo: `/Users/andreszeballoscarbajal/Documents/kiro-uni/kiro-man` (branch `main`, scaffold commit 1ba18c1). All paths are relative to this root unless absolute.

Source of truth: `.kiro/specs/_design-overview.md` ("overview") and the four specs in `.kiro/specs/{game-engine,coin-credit-system,leaderboard,arcade-presentation}/`. The design is user-approved; do not redesign. On any detail, the specs win over this plan (overview §5–9 win over per-feature specs). This plan sequences the work and names the files; exact numbers, types, and rules live in the specs.

Global rules for every item:
- Pure dirs (`src/engine`, `src/shared`, `src/arcade`, `src/content`, `src/leaderboard/ranking.ts`) use no `Math.random`, `Date.now`, `performance.now`, `new Date`, `crypto`, DOM, timers (overview §4.1). Integer-only sim, 60 ticks/s, seeded mulberry32 only.
- PBTs use fast-check with `{ numRuns: PBT_RUNS }` (`PBT_RUNS = 200`, `src/test-support/pbt.ts`). Tests sit next to sources: `*.test.ts`, `*.property.test.ts`.
- No TODO/FIXME/XXX/"not implemented" tokens, no placeholder bodies. No third-party video game trademarks (the static guard bans them repo-wide, including in this plan's successors), no official AWS logos.
- After finishing each spec task, tick its checkbox in that spec's `tasks.md` (`- [ ]` → `- [x]`).
- Never run `cdk deploy`. Commit locally only; never push.
- Pinned versions (overview §4.2): typescript 5.9.3, vite 8.3.2, vitest 5.0.3, fast-check 4.10.2, @types/node 22.20.5, playwright 1.63.0, aws-cdk-lib 2.272.0, aws-cdk 2.1144.0, constructs 10.8.1, tsx 4.23.15, esbuild 0.28.2, @aws-sdk/client-dynamodb + lib-dynamodb 3.1146.0, @modelcontextprotocol/sdk 1.32.1, zod 4.6.5. If an exact pin fails to install (version not published), use the nearest published version in the same major, update overview §4.2 and `tech.md` to match, and note it in the commit message.

Decisions taken by this plan where the review allowed a choice:
- Finding #6: `applyPowerUp` does NOT add the 50-point pickup score (the pickup-collection path adds it), so QA grants and P3 grants don't inflate scores.
- Finding #11: the P7 core property test gets a 120 s per-test timeout (keeps both honest and altered claims per run, the stronger oracle).

Commands (overview §4.4): `npm test`, `npm run test:unit`, `npm run test:pbt`, `npm run typecheck`, `npm run build`, `npm run build:mcp`, `npm run synth`, `npm run cfn-lint`, `npm run verify:browser`, `npm --prefix infra test`, `npm --prefix infra run typecheck`.

---

## Phase 0 — Apply design-review carry-forward fixes (spec text only, no code)

- [x] 0. Apply all 12 findings from `.agents/tasks/design-review.md` / `.json` to the spec files. Edit `.kiro/specs/_design-overview.md` and the per-feature spec files listed; then copy the overview over `.agents/tasks/design.md` so they stay byte-identical, and add a short "§13.2 Pass 3 → implementation" table to the overview listing #1–#12 as resolved.
      1. (MED) P5 re-pick oracle — overview §8 P5 and `game-engine/design.md` P5 row: replace "with re-pick, true through R+duration-1 and false after R+duration" with "`isActive` after step s is true iff `s ∈ [T, T+d-1] ∪ [R, R+d-1]`; without re-pick the second interval is empty" (also note it covers `R === T+d`). Align GE AC-10 wording if it restates the re-pick case.
      2. (MED) P1b round trip — overview §8 P1b and `coin-credit-system/design.md` P1b row: "Round trip (generated only when `screen === 'playing'`): `gameOver({score: 0, …, tainted: false}, qualifies: false)`, then 60 × `uiTick`, then `confirm` (incident → highscores), then `confirm` (highscores → attract). On any other screen the action is skipped."
      3. (MED) Reachability — overview §5.3, `game-engine/requirements.md` GE-2.3, `game-engine/design.md` core types + P2b: `validateMaze` also requires every `U` and `W` reachable from `P`; add `MazeError` variant `{ kind: 'unreachable_tile'; tile: 'U' | 'W'; x: number; y: number }` to the binding `MazeError` union; P2b adds "for every shipped level, `reachableFrom(maze, spawn)` includes `maze.exit`"; reword the P7 core "bounded because…" note to cite this rule; add "X must be reachable from P, and every U and W must be reachable from P" to the level-designer prompt in overview §9.4. Note P5_MAZE still satisfies the rule (its U/W lie in P's region; only X/pen are sealed).
      4. (MED) P3 coverage — overview §8 P3, `game-engine/design.md` P3, GE AC-13: main P3 `fc.assert` unseeded with no coverage assertion; a second `fc.assert` of the same property with `{ numRuns: PBT_RUNS, seed: 0x4b49524f }` asserts the clone/warp/Lambda counters; keep `movement.coverage.test.ts`.
      5. (NIT) Release timing — overview §5.6 and `game-engine/design.md` "Release": "In phase (6), a pen enemy with `releaseIn === 0` releases this step; otherwise `releaseIn -= 1`, and if that reaches 0 it releases in the same step."
      6. (NIT) `applyPowerUp` — `game-engine/design.md` `powerups.ts` row and overview §5.7: "`applyPowerUp(state, kind)` applies exactly the collection effect: `active[kind] = duration`, the clone spawn rule, `stats.servicesUsed[kind]++`, and a `powerUpPickup` event. It does NOT add the 50-point pickup score."
      7. (NIT) CC-8.2 — `coin-credit-system/requirements.md` CC-8.2 and the design's "Non-qualifying remote submission" paragraph: "It is emitted in the `reduce` result for the `confirm` that leaves `incident` for `highscores`."
      8. (NIT) Clone eat tile — overview §5.7 Auto Scaling bullet and `game-engine/design.md`: "The clone eats the bug at `occ(clone)`, same as the player."
      9. (NIT) `pick` — `game-engine/design.md` `rng.ts` row (and the pinned rng code block if present): "`pick(r, arr) = arr[nextInt(r, arr.length)]`".
      10. (NIT) Numbering — renumber sequentially by position: CC-8 items in `coin-credit-system/requirements.md` (current order 1,2,4,3 → 1,2,3,4); leaderboard Acceptance Criteria (…6,8,7 → …6,7,8); arcade-presentation Acceptance Criteria (1,2,3,6,5,4 → 1..6). Then grep all specs + overview for `CC-8.3`, `CC-8.4`, `AC-4..AC-8` references to those lists and update them.
      11. (NIT) P7 core timeout — overview §8 P7 and `leaderboard/design.md` P7 + leaderboard task 9: "30 s per-test timeout" → "120 s per-test timeout".
      12. (NIT) Level-clear moment — overview §5.8 and GE-6.10 (`game-engine/requirements.md`) + `game-engine/design.md`: "Level clear (step 9) sets `active = {}`, `clone = null`, `pickup = null` immediately. The reset table re-applies it at the next level start."
      Files: `.kiro/specs/_design-overview.md`, `.agents/tasks/design.md`, `.kiro/specs/game-engine/{requirements,design}.md`, `.kiro/specs/coin-credit-system/{requirements,design}.md`, `.kiro/specs/leaderboard/{requirements,design,tasks}.md`, `.kiro/specs/arcade-presentation/requirements.md`.
      Verify: `diff .kiro/specs/_design-overview.md .agents/tasks/design.md` prints nothing; re-read each edited passage against the finding list; `git diff --stat` touches only spec/design files. Commit `docs(specs): apply design-review pass-3 fixes`.

## Phase 1 — Root scaffolding and game engine (game-engine spec tasks 1–16)

- [x] 1. Root scaffolding (GE task 1): `package.json` (`"type": "module"`, scripts from overview §4.4, exact devDependencies incl. MCP SDK + zod + @aws-sdk libs needed by root-run lambda tests), `.npmrc` (`save-exact=true`), `tsconfig.json` (§4.2 settings), `vite.config.ts`, `vitest.config.ts` (include globs from §4.3), `src/test-support/pbt.ts`, `tests/static/guard.test.ts` (S1 exactly per overview §8), `src/styles.css` + minimal `index.html` shell so `vite build` works (completed in item 15). Run `npm install`, commit `package-lock.json`.
      Files: `package.json`, `.npmrc`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/test-support/pbt.ts`, `tests/static/guard.test.ts`, `index.html`, `src/styles.css`.
      Verify: `npm test` (guard passes) and `npm run typecheck` exit 0.

- [x] 2. `src/engine/rng.ts` (pinned mulberry32, `pick` per fix #9) + `rng.test.ts` with golden values for seeds 0 and 1 (GE task 2).
      Verify: `npx vitest --run src/engine/rng` passes.

- [x] 3. `types.ts`, `constants.ts` (`difficulty(level)`, `ENEMY_ORDER`, `MAX_TICKS`, `TILE_UNITS`), `input.ts` (recorder, `reverse`, `DIR_ORDER`) + tests (GE task 3).
      Verify: `npx vitest --run src/engine` passes; `npm run typecheck` 0.

- [x] 4. `src/content/services.json` (CATALOG_ORDER schema, §5.7) with load-time validation; `src/engine/maze.ts` (`parseMaze`, `validateMaze` incl. `unreachable_tile` from fix #3, `isPassable`, `reachableFrom`, BFS helpers) + one unit test per `MazeError` kind (GE task 4).
      Verify: `npx vitest --run src/engine/maze` passes.

- [x] 5. `src/engine/levels.ts`: three original 40x28 server-rack layouts HALL-A "us-east-3am", HALL-B "cold aisle", HALL-C "hot aisle" meeting §5.3 counts and fix #3 reachability (GE task 5), then P2a/P2b in `maze.property.test.ts` incl. the exit-reachable assertion (GE task 6). Layouts must be original (not any commercial maze; different dimensions already help).
      Verify: `npx vitest --run src/engine/maze` (unit + property) passes.

- [x] 6. `movement.ts` (fixed-point advance, buffered turns, reversal-before-advance, leftover rule) + edge-case tests (GE task 7).
      Verify: `npx vitest --run src/engine/movement` passes.

- [x] 7. Enemies under `src/engine/enemies/` (`pathing.ts`, `latency.ts`, `throttle.ts`, `coldStart.ts`, `outage.ts`, `index.ts`) with release rule per fix #5, `isDark`, targets; a unit test per AI showing its distinct behavior (GE task 8).
      Verify: `npx vitest --run src/engine/enemies` passes.

- [x] 8. `powerups.ts` (`tickPowerUps`, `maybeSpawnPickup`, `applyPowerUp` per fix #6, `isActive`, clone eating at `occ(clone)` per fix #8, Shield, binding warp check) + unit tests per effect, timer boundary, Lambda+CloudFront leftover warp (GE task 9).
      Verify: `npx vitest --run src/engine/powerups` passes.

- [x] 9. `collision.ts`, `scoring.ts`, `game.ts` (`createGame`, `step` with binding 11-phase order, phase timers, reset table, level-clear clear per fix #12, time limit + `gameOverReason`, `forceGameOver`, `cloneState`), `src/engine/index.ts` barrel + unit tests (GE task 10).
      Verify: `npx vitest --run src/engine` passes; `npm run typecheck` 0.

- [x] 10. `src/engine/test-fixtures.ts` (`P5_MAZE`, walled-off maze, warp maze) + validity test; P3 (two `fc.assert`s per fix #4) and `movement.coverage.test.ts` (GE task 11); P5 with the corrected oracle (fix #1) (GE task 12). Pin and confirm the seed `0x4b49524f` hits all three coverage counters; if it does not, choose another seed that does and update the spec text.
      Verify: `npm run test:pbt` passes P2a/P2b/P3/P5.

- [x] 11. `src/shared/replay.ts` (pinned loop §5.9, `replay`, `validateReplay`) + unit tests incl. golden regression and the tick-107999 case (GE task 13); P4 `determinism.property.test.ts` (GE task 14); perf test < 1.5 s for 108000 ticks (GE task 15). Then GE task 16.
      Verify: `npm test` and `npm run typecheck` exit 0; perf test logs the measured time.

## Phase 2 — Pure cabinet, content, leaderboard logic

- [x] 12. `src/arcade/credits.ts` + tests + P1a; `src/arcade/initials.ts` + tests + P9 (CC tasks 1–4).
      Verify: `npx vitest --run src/arcade` passes.

- [x] 13. `src/content/glyphs.ts`, `src/content/aws-facts.json` (≥ 2 facts per kind + ≥ 2 DynamoDB; verify each with the aws-docs MCP / AWS docs, record the exact doc URL in `sourceUrl`; replace any unverifiable draft), `src/content/facts.ts` (load-time validation, `pickFact`) + `facts.test.ts` + P10 (CC tasks 5–6).
      Verify: `npx vitest --run src/content` passes.

- [x] 14. `src/shared/result.ts`, `src/leaderboard/ranking.ts` + tests + P6; `src/leaderboard/localStore.ts` + tests; `src/shared/submission.ts` + tests + P8; P7 pure variant in `src/shared/replay.property.test.ts`; `src/leaderboard/remoteClient.ts` + tests; `src/app/config.ts` + tests (LB tasks 1–7).
      Verify: `npx vitest --run src/leaderboard src/shared src/app/config` passes.

- [x] 15. `src/arcade/cabinet.ts` reducer (all screens, timings, effects, `rootCause`, log cap, remoteStatus transitions, CC-8.2 emission per fix #7) + unit tests for every design edge case + P1b with the fixed round trip (fix #2) (CC tasks 7–8); `src/app/keyboard.ts` `mapKey` + tests (CC task 9); `src/app/session.ts` `checkGameOver` + tests (CC task 10, pure part).
      Verify: `npm test` passes; `npm run typecheck` 0.

## Phase 3 — Presentation, audio, and the playable app

- [x] 16. `index.html` (canvas `role="img"`, aria-live region, controls legend, `#crt`, `<link rel="icon" href="data:,">`) and `src/styles.css` (pixelated, CRT scanlines, reduced motion) (AP task 1); `src/render/palette.ts` (KIRO-16), `font.ts` (5x7, covers `FONT_GLYPHS`), `sprites.ts` (Kiro ghost, 4 enemies, bug, 5 power-up icons, clone, pads; 8x8, 2 frames; original pixel art, no AWS logos) + validation tests (AP task 2); `integerScale` in `src/render/scale.ts` + P11 (AP task 4).
      Verify: `npx vitest --run src/render` passes.

- [x] 17. `renderer.ts`, `hud.ts`, `crt.ts`, `screens/{attract,playing,incident,initials,highscores}.ts` (blinking INSERT COIN, credits, sub-tile interpolation, darkness, CloudWatch target overlay, pad animation, READY / LEVEL CLEAR banners, death animation, wrapped uppercased fact + root cause, remote status, OFFLINE) (AP task 3, CC task 11); `src/audio/sfx.ts` (coin, start, eat, power-up, shield block, death, level clear, game over; mute; null-context) + tests (AP task 5).
      Verify: `npx vitest --run src/render src/audio` passes; `npm run build` exits 0.

- [x] 18. `src/app/loop.ts` (fixed 60 Hz timestep, spiral cap), `a11y.ts`, `qa.ts` (`?qa=1`, `&seed=`, taint), `main.ts` (await `loadConfig`, `initialCabinet`, keyboard → events, recorder, `checkGameOver` after every step/QA call, effect executor incl. local save + remote submit) + unit tests (AP task 6, CC task 10 wiring, LB task 14). Do a manual play-through in `npm run dev` / headless smoke: coin → start → play levels 1–3, every power-up visible and timed (AP task 8; record findings in the commit message).
      Verify: `npm test`, `npm run build` exit 0; `npm run preview` serves a working game (checked in item 23 headlessly).

## Phase 4 — Backend (CDK synth only)

- [x] 19. `infra/` package (`package.json`, `.npmrc`, lockfile, `tsconfig.json` per §4.2, `cdk.json`, `bin/kiro-man.ts`) (LB task 8); `infra/lambda/core.ts` + unit tests for every status code + core P7 (120 s timeout, fix #11), `dynamo-store.ts`, `scores-handler.ts` (LB task 9).
      Verify: `npm --prefix infra install`; `npx vitest --run infra/lambda` from root passes; `npm --prefix infra run typecheck` 0.

- [x] 20. `infra/lib/kiro-man-stack.ts` per overview §7.4 (DynamoDB on-demand, NodejsFunction w/ local esbuild, HTTP API with throttled `$default` stage, both routes, S3 + CloudFront OAC, conditional BucketDeployment, outputs), consulting the `aws-infrastructure-as-code` power and citing it in comments; `infra/test/stack.test.ts` (LB tasks 10–11); synth with credentials unset (LB task 12); `scripts/cfn-lint.sh` → `docs/cfn-lint-report.txt` and power validation → `docs/power-iac-validation.md` (LB task 13).
      Verify: `npm --prefix infra test` passes; `env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY npm run synth` exits 0; `npm run cfn-lint` writes the report.

## Phase 5 — Kiro tooling, MCP server, packaged power

- [x] 21. Steering `.kiro/steering/{game-engine,retro-style,aws-content,tech}.md` (§9.2); hooks `.kiro/hooks/{test-on-save,synth-on-infra-save,confirm-deploy,pbt-after-task}.json` exactly per §9.3; `scripts/confirm-deploy.mjs` (exported `decide`, fail-closed exit 2) + `scripts/confirm-deploy.test.ts` (match, no-match, nested, invalid JSON, override, exit codes via `spawnSync`); agents `.kiro/agents/{level-designer,cabinet-tech}.json` exactly per §9.4 (level-designer prompt includes the fix-#3 reachability sentence); `.kiro/settings/mcp.json` per §9.5. Ensure `vitest.config.ts` includes `scripts/**/*.test.ts`.
      Verify: `npm test` passes; each JSON file parses (`node -e "JSON.parse(require('fs').readFileSync(p))"` per file).

- [x] 22. `mcp/arcade-operator/` (`package.json`, lockfile, `tsconfig.json`, `src/tools.ts` with injected fetch/readFile, `src/index.ts` with `McpServer` + `StdioServerTransport`, `src/tools.test.ts`, `scripts/copy-to-power.mjs`); then `retro-arcade-power/` (`POWER.md`, `steering/*.md`, `plugin.json`, `mcp.json`, `README.md`, `skills/deterministic-canvas-games/SKILL.md` + `references/*.md` complete guides with code, `server/arcade-operator.mjs` committed bundle) per §9.6.
      Verify: `npm run build:mcp` exits 0 and produces `retro-arcade-power/server/arcade-operator.mjs`; `npm test` passes the tools tests; a stdio smoke (`printf` an `initialize` + `tools/list` JSON-RPC request into `node mcp/arcade-operator/dist/index.js`) lists the three tools.

## Phase 6 — Headless verification, README, final run

- [x] 23. `scripts/screenshots.mjs` exactly per §9.7 (pinned seed/script, frame waits, fails on console errors, kills preview, exports `mcp/arcade-operator/data/{local-scores,sample-replay}.json`); run `npm run verify:browser` and commit the eight PNGs in `docs/screenshots/` (AP task 7). Run `npx playwright install chromium` first if needed. Then call the MCP `validate_replay` on the sample (via tools test or stdio) and confirm `valid: true`.
      Verify: `npm run verify:browser` exits 0; eight PNGs exist and visually show what AP AC-1 lists (open each image).

- [x] 24. Kiro in-IDE checks (A3/A8/A9): confirm hook trigger names via the hook UI if possible, steering inclusion on `src/engine/rng.ts`, and try installing `retro-arcade-power` from its local folder; record each result (or why it could not be done in this environment) in the README / power README. Write the complete `README.md` per overview §2.11 (game, controls, run/test/build/synth/screenshots/cfn-lint, MCP + power setup, seven-feature Kiro map with file paths, security note + hot-partition note (LB task 15), exact disclaimer from §9.2).
      Verify: `npm test` (guard scans README) passes.

- [x] 25. Final full run and spec bookkeeping: `npm test`, `npm run typecheck`, `npm run build`, `npm run synth`, `npm run cfn-lint`, `npm run build:mcp`, `npm run verify:browser`, `npm --prefix infra test`; confirm every checkbox in all four `tasks.md` files is `[x]` and the TODO/banned-name guard is green.
      Verify: all commands exit 0; `grep -c '\- \[ \]' .kiro/specs/*/tasks.md` reports 0 for each file.
