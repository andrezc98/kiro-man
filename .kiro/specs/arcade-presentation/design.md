# Design — arcade-presentation

## Overview

A browser-only layer: `src/app` owns the loop, the keyboard, config, QA hooks, and a11y. `src/render` draws engine and cabinet state into a 320x240 `CanvasRenderingContext2D`. `src/audio` turns engine events and cabinet `sfx` effects into WebAudio beeps. Vite 8.3.2 builds it as a static site with `base: './'` so it works from S3/CloudFront or any subpath. Playwright 1.63.0 handles the headless verification.

## Quality bar / no scope cuts

Everything in requirements.md is required. Polish is judged on the screenshots and on manual play. No TODOs.

## Key decisions

**Software fill instead of `ImageData`.** Sprites are `string[]` rows of hex palette indices (`'.'` = transparent). At module load they are pre-rendered once into offscreen canvases per frame and color, then drawn with `drawImage` at integer coordinates. That is fast and keeps the art readable in code. `src/render/sprites.ts` exports `SPRITES: Record<SpriteId, string[][]>` (frames), and a unit test checks every char is in `0-9a-f.`.

**Fixed-step loop (`src/app/loop.ts`).** `createLoop({ now, raf, stepHz: 60, maxSteps: 5, onStep, onRender })` takes `now` and `raf` by injection, so it is unit-testable. `onRender(alpha)` receives the fraction left in the accumulator, but the engine already interpolates via `progress`, so alpha goes unused for entities. A single `onStep` sends a `uiTick` to the cabinet, and while the screen is `playing` and not paused, it records input and calls `engine.step`.

**Keyboard (`src/app/keyboard.ts`).** A held-direction stack: keydown pushes, keyup removes, and the current dir is the top. Arrow keys call `preventDefault`. Ignore `event.repeat` for C, Enter, P, and M.

**CRT.** A `#crt` div after the canvas uses `pointer-events:none`, a `repeating-linear-gradient` scanline (2 px period, rgba(0,0,0,.25)), a radial vignette, and a 0.15 s opacity flicker keyframe guarded by `@media (prefers-reduced-motion: no-preference)`.

**Audio (`src/audio/sfx.ts`).** `createSfx(factory: () => AudioContext | null)`. Each SFX is a short table of `{freq, durMs, type}` notes scheduled on `ctx.currentTime`, with a gain envelope at 0.08 to avoid clicks. Mute is a boolean. One master gain node.

**Screens.** One draw function per cabinet screen, in `src/render/screens/*.ts`. The incident report word-wraps facts to 36 characters per line with a pure `wrapText` (unit tested).

**QA hooks (`src/app/qa.ts`).** These attach only when `new URLSearchParams(location.search).get('qa') === '1'`. In QA mode only, `&seed=<uint32>` (validated `^\d+$`, ≤ 4294967295, else ignored with `console.info`) replaces the crypto seed. API: `window.__KIROMAN_QA__ = { grantPowerUp(kind), releaseEnemies(), setInvulnerable(ticks), forceGameOver(), getScreen(), getScore(), getLastSubmission() }`. All mutators taint the session; `getLastSubmission()` returns the last `{seed, inputLog, claimedScore}` built at game over (even if tainted, for MCP sample data). See overview §9.7 for the pinned screenshot script.

**Keyboard.** The per-screen `mapKey(screen, key)` lives in `src/app/keyboard.ts` (coin-credit design). `P` and WASD are only meaningful while `playing`; on `initials` letters type.

**Screenshot script (`scripts/screenshots.mjs`).** It spawns `npx vite preview --port 4173 --strictPort` and polls `http://localhost:4173/` for up to 20 s. Then it launches `chromium.launch({ headless: true })` with viewport 960x720 (scale 3), runs the steps, takes `page.screenshot` of `#cabinet`, and checks the `console` and `pageerror` listeners. A `finally` block kills the server and closes the browser. Before the first run, `npx playwright install chromium` is needed, as documented in the README.

## Edge cases (unit tests)

- Viewport smaller than 320x240 gives scale 1.
- Two keys held, the top released: the dir falls back to the other key.
- `wrapText` with a word longer than the line width (hard-splits it).
- An unknown glyph renders as `?`.
- SFX with a null context are no-ops.
- Loop after a 2 s tab stall runs only 5 steps (no spiral).

## Error handling

A missing 2D context (`getContext` returns null) is fatal. The app replaces the canvas with an HTML message "Canvas not supported" and logs `console.error`. An AudioContext failure is recoverable (silent, `console.info` once). A screenshot-script failure exits with code 1 and prints the step that failed.

## Testability

Pure helpers (scale, wrapText, keyboard stack, loop, sprite validation, font coverage) get unit tests. Drawing is verified visually by the Playwright screenshots, which run as an integration test.

## Correctness Properties

This layer has no simulation invariants. It relies on P3 and P4 from the game-engine spec for what it displays. One property is added:

| ID | Property | Requirement |
|---|---|---|
| P11 | For any viewport w,h in 1..8000, `integerScale(w,h)` is ≥ 1 and is the largest integer s with 320s ≤ w and 240s ≤ h (or 1 if none) | AP-1.1 |

It uses `numRuns: PBT_RUNS` (200).
