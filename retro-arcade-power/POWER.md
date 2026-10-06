---
name: "retro-arcade-power"
displayName: "Retro Arcade (Deterministic Canvas Games)"
description: "Build deterministic retro canvas games: seeded PRNG and integer simulation, fixed-timestep loops, server-side replay validation and crisp pixel art, plus an MCP server that validates replays, reads leaderboards and lists power-ups."
keywords: ["retro", "arcade", "8-bit", "pixel art", "canvas game", "deterministic", "replay", "leaderboard"]
author: "Andres Zeballos"
---

# Retro Arcade (Deterministic Canvas Games)

## Overview

This power packages what was learned building KIRO-MAN, a coin-op style maze chase whose simulation is deterministic so a serverless backend can replay every submitted score. It gives Kiro:

- Steering guides that load on demand: a determinism checklist, the fixed-timestep loop, replay validation, and pixel-art canvas rendering. Each is a complete guide with code.
- The `arcade-operator` MCP server (bundled, no install step): validate a replay with the real engine, read the leaderboard, list the power-up catalog.

## Onboarding

### Prerequisites

- Node.js 22 or newer on `PATH` (the server is a single ESM file).
- When working inside the KIRO-MAN repository, run `npm run build:mcp` first. It rebuilds the server from source and refreshes `server/arcade-operator.mjs` in this power. The committed bundle already works without that step.

### Configure the server path

The power's `mcp.json` uses a placeholder because MCP `args` are not resolved relative to the power folder:

```json
{"mcpServers":{"arcade-operator":{"command":"node","args":["${ABSOLUTE_PATH_TO}/retro-arcade-power/server/arcade-operator.mjs"],"env":{"KIROMAN_API_URL":"","KIROMAN_LOCAL_SCORES":""},"disabled":false}}}
```

After installing, replace `${ABSOLUTE_PATH_TO}` with the absolute path of the folder that contains `retro-arcade-power/` (for example `/Users/you/code/kiro-man`). Optional environment:

- `KIROMAN_API_URL`: base URL of a deployed score API (the server appends `/scores`). Empty means local only.
- `KIROMAN_LOCAL_SCORES`: path to a local scores JSON file. Empty means `<cwd>/mcp/arcade-operator/data/local-scores.json`.

Check it: ask Kiro to "list the arcade power-ups". It should call `list_power_ups` and show five entries.

## Tools (arcade-operator)

| Tool | Input | Output |
|---|---|---|
| `validate_replay` | `{ seed, inputLog: [[tick, dir], ...], claimedScore }` | `{ valid, status: "accepted" \| "replay_mismatch" \| "replay_incomplete", replayedScore, claimedScore, level, ticks }`; `isError` with field errors on a schema failure |
| `get_leaderboard` | `{ source?: "auto" \| "remote" \| "local" }` (default `auto`) | `{ source, scores: [{ initials, score, level }], note? }`; `auto` falls back to local with a `note`; an explicit `remote` failure is `isError`; a missing local file is `{ scores: [], note: "no local scores file" }` |
| `list_power_ups` | none | `{ powerUps: [{ kind, label, name, durationTicks, color, effect }] }` |

The server logs to stderr only; stdout carries JSON-RPC.

## Workflows

### Add a deterministic mechanic

1. Read `steering/determinism-checklist.md`.
2. Put every new field in the game state (plain JSON). Timers are tick countdowns; randomness goes through the state's PRNG with a path-independent number of draws.
3. Insert the mechanic at a fixed point of the step phase order and document it.
4. Add a property test (at least 100 runs) for its invariant and unit tests for its edge cases.
5. Re-run the golden replay test. If the score changed on purpose, update the golden values in the same commit.
6. Record a short game and call `validate_replay` on it to confirm the server agrees.

### Validate a replay

1. Get a submission `{ seed, inputLog, claimedScore }` (KIRO-MAN's headless run writes one to `mcp/arcade-operator/data/sample-replay.json`).
2. Call `validate_replay` with it. `valid: true` with `status: "accepted"` means the engine reproduces the score.
3. On `replay_mismatch`, compare `replayedScore` with `claimedScore`; a client and server built from different engine versions is the usual cause. See `steering/replay-validation.md`.

### Build a pixel-art screen

1. Read `steering/pixel-art-canvas.md`.
2. Draw at 320x240 with palette indices and floored coordinates; scale the canvas element by an integer.
3. Text uses the bitmap font; add any new character to the glyph table and its coverage test.
4. Capture a headless screenshot to check the result.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Kiro shows the server as failed to start | The path in `mcp.json` still contains `${ABSOLUTE_PATH_TO}` or points to a moved folder. Use the absolute path to `server/arcade-operator.mjs`. |
| `node: command not found` | Install Node.js 22+ or set `command` to the absolute path of `node`. |
| `get_leaderboard` always says "no local scores file" | Set `KIROMAN_LOCAL_SCORES` to an absolute path, or start Kiro in the KIRO-MAN repo root and run `npm run verify:browser` once to export the file. |
| `get_leaderboard` with `source: "remote"` errors | `KIROMAN_API_URL` is empty or unreachable; the call has a 3 s timeout. `auto` falls back to local. |
| `validate_replay` returns `isError` | The input breaks the schema: ticks must be integers 0..107999 and strictly increasing, dir 0..4, seed 0..4294967295, claimedScore 0..10000000, no extra keys. |
| Replays disagree after an engine change | Expected: a different engine is a different game. Rebuild with `npm run build:mcp` so the server uses the same engine as the client. |
