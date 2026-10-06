# Requirements — arcade-presentation

## Introduction

This spec covers everything the player sees and hears: the 320x240 canvas renderer, the KIRO-16 palette, the in-code pixel font, original sprites, the CRT overlay, WebAudio SFX, the fixed-timestep browser loop, accessibility hooks, and headless screenshot verification. It reads engine and cabinet state but never changes simulation state.

## Quality bar / no scope cuts

The visuals must look polished and retro: smooth interpolated movement, 2-frame sprite animation for every actor, the death animation, READY and LEVEL CLEAR banners, the darkness effect around Outage, the CloudWatch target overlay, power-up timer bars, CRT scanlines, and SFX for every listed event. Headless Playwright screenshots are required and get committed. No TODO stubs. The reviewer rejects anything missing or half-done.

## Requirements

### AP-1 Canvas and scaling
1. THE SYSTEM SHALL render into a 320x240 canvas and scale it to the largest integer factor (minimum 1) that fits the viewport, keeping the canvas centered on a black background.
2. THE SYSTEM SHALL disable image smoothing and set CSS `image-rendering: pixelated`.
3. WHEN the window resizes THE SYSTEM SHALL recompute the integer scale.

### AP-2 Palette, font, sprites
1. THE SYSTEM SHALL draw using only the 16 KIRO-16 palette colors.
2. THE SYSTEM SHALL render all text with an in-code 5x7 bitmap font covering A–Z, 0–9, and `space . , : ! ? - # / ' ( ) % + < > _ =`, drawing unknown characters as `?`.
3. THE SYSTEM SHALL draw an original Kiro-ghost player sprite, four visually distinct enemy sprites, a bug sprite, five power-up icons with 3-letter labels, rack walls, edge pads, and the pen door, each with 2 animation frames where they move. All are defined as palette-index arrays in code.
4. THE SYSTEM SHALL NOT include official AWS logos, third-party video game trademarks or character names, or external image or font files.

### AP-3 Game rendering
1. WHILE playing THE SYSTEM SHALL interpolate entity positions from tile plus progress, and floor them to whole pixels.
2. WHILE Outage is active THE SYSTEM SHALL draw dark tiles (per `isDark`) in palette 0/1 and hide bugs on them.
3. WHILE CloudWatch is active THE SYSTEM SHALL draw each enemy's target tile as a blinking outline in that enemy's color.
4. WHILE CloudFront is active THE SYSTEM SHALL animate the four edge pads.
5. WHILE the phase is `ready`, `levelClear`, or `dying` THE SYSTEM SHALL show the "READY!" banner, the "LEVEL CLEAR" banner, or the ghost-fade death animation, respectively.
6. THE SYSTEM SHALL draw a HUD in rows 0–1 with score, high score, level, lives, credits, and the active power-up labels with timer bars.

### AP-4 CRT overlay
1. THE SYSTEM SHALL overlay CSS scanlines and a vignette above the canvas, without intercepting input.
2. WHERE the user prefers reduced motion THE SYSTEM SHALL disable the overlay's flicker animation.

### AP-5 Audio
1. WHEN the first key press occurs THE SYSTEM SHALL create or resume a WebAudio context.
2. THE SYSTEM SHALL play square or triangle-wave SFX for: coin, denied, start, bug (alternating two pitches), power-up, shield block, warp, clone spawn, death, level clear, and game over.
3. WHEN `M` is pressed on any screen other than `initials` THE SYSTEM SHALL toggle mute.
4. WHEN WebAudio is unavailable THE SYSTEM SHALL continue silently.

### AP-6 Loop and input
1. THE SYSTEM SHALL run a fixed 60 Hz accumulator loop over `requestAnimationFrame`, with at most 5 sim steps per frame, and render once per frame.
2. WHEN the page is hidden or `P` is pressed during play THE SYSTEM SHALL pause the simulation and show "PAUSED".
3. WHILE playing THE SYSTEM SHALL map Arrow keys and WASD to directions, holding the most recently pressed direction that is still held. On the `initials` screen only Arrow keys navigate and all letters type (coin-credit CC-7.2).

### AP-7 Accessibility
1. THE SYSTEM SHALL give the canvas `role="img"` and a descriptive `aria-label`, and keep a visually hidden `aria-live="polite"` region updated on screen changes, score milestones every 1000 points, and game over.
2. THE SYSTEM SHALL show the controls legend as HTML text below the canvas.

### AP-8 Headless verification
1. WHEN `npm run verify:browser` runs THE SYSTEM SHALL build, serve, and capture the eight screenshots listed in overview §9.7 into `docs/screenshots/`, and exit non-zero on any console error, page error, or failed step.

## Acceptance Criteria

1. The eight screenshots exist and visibly show the attract screen, credits, gameplay with enemies, the CloudWatch overlay plus darkness, the incident report with a fact, initials, and high scores.
2. Unit tests: integer scale computation (e.g. 1920x1080 → 4), font glyph coverage for every character the game prints, all sprite pixels within palette indices 0–15, and the keyboard direction-stack logic.
3. The static guard test (S1, defined once in `../_design-overview.md` §8) confirms there are no image or font asset files in `src/`, and no banned names in any text file listed by `git ls-files -co --exclude-standard` (including `.agents/` and `.kiro/`), using a regex built from split literals so the names never appear in the repo.
4. `index.html` declares `<link rel="icon" href="data:,">`, so the headless run never requests `/favicon.ico`, and the screenshot script waits 70 frames after shot 06 before pressing Enter (past the 60-tick incident lockout).
5. Shots 05 (CloudWatch overlay plus Outage darkness) and 07 (initials with a score > 0) are produced reliably from a pinned QA seed and script.
6. Muting, pausing, and a missing AudioContext are covered by unit tests with fakes.

## Out of Scope

Music, gamepad and touch controls, a settings menu, and fullscreen API.
