---
name: deterministic-canvas-games
description: "Build retro arcade games on an HTML canvas whose simulation is fully deterministic: seeded PRNG in state, integer fixed-point math, a fixed 60 Hz timestep, input logs that replay exactly on a server, and crisp integer-scaled pixel art. Triggers on: retro game, arcade game, 8-bit, pixel art, canvas game, deterministic simulation, fixed timestep, game replay, anti-cheat score validation, leaderboard."
---

# Deterministic canvas games

A game whose simulation is a pure function of `(seed, input log)` can be property tested, regression tested with golden replays, and validated by a server that replays the submitted input instead of trusting the claimed score. This skill covers the architecture, the loop, replay validation and the pixel-art rendering that goes with it.

## When to use it

- Starting a browser game with a canvas renderer and a high-score table.
- Adding a mechanic (power-up, enemy AI, timer) to a deterministic engine without breaking replays.
- Building server-side score validation (Lambda, edge function, MCP tool) that reuses the client engine.
- Fixing blurry or shimmering pixel art, or a game loop that runs faster on 120 Hz displays.

## Workflow

1. Split the code: a pure `engine/` (state, rules, AI, PRNG) and `shared/` (replay, submission schema) that never touch the clock or the DOM; a shell (`app/`, `render/`, `audio/`) that reads state. Add a static test that bans `Math.random`, `Date.now`, timers and DOM names in the pure directories. See [determinism checklist](references/determinism-checklist.md).
2. Model all state as plain JSON with a seeded mulberry32 PRNG inside it, integer fixed-point positions, and tick-countdown timers. Write the step phase order down and keep it fixed.
3. Drive the engine from a fixed-timestep accumulator loop with a steps-per-frame cap; sample input once per step and record only changes. See [fixed-timestep loop](references/fixed-timestep-loop.md).
4. Record `[tick, dir]` change events; replay them with the same rule on the server; validate the request shape first and bound the game length so replays terminate. See [replay validation](references/replay-validation.md).
5. Render at a fixed internal resolution with integer scaling, smoothing off, a fixed palette, sprites and a bitmap font as data in code. See [pixel-art canvas](references/pixel-art-canvas.md).
6. Test it: golden replay, determinism property (two replays deep-equal), invariant properties (movers on passable tiles, timers non-negative), and parser properties. Use at least 100 runs per property.

## Tools

The power's `arcade-operator` MCP server works against a real game's data:

- `validate_replay({ seed, inputLog, claimedScore })`: replays the log with the shared engine; returns `{ valid, status, replayedScore, claimedScore, level, ticks }` or `isError` with field errors.
- `get_leaderboard({ source: "auto" | "remote" | "local" })`: the top 10 from `KIROMAN_API_URL/scores` or the local scores file.
- `list_power_ups()`: the power-up catalog (kind, label, name, duration in ticks, palette color, effect).

## References

- [references/determinism-checklist.md](references/determinism-checklist.md)
- [references/fixed-timestep-loop.md](references/fixed-timestep-loop.md)
- [references/replay-validation.md](references/replay-validation.md)
- [references/pixel-art-canvas.md](references/pixel-art-canvas.md)
