# Requirements — coin-credit-system

## Introduction

This spec covers the arcade cabinet framing: coins and credits, and the screen flow attract → playing → incident report → initials entry → high scores → attract. The logic is pure reducers in `src/arcade/`. The browser app executes the effects they emit. See `../_design-overview.md` §6.

## Quality bar / no scope cuts

Every screen in this spec is required and polished: blinking INSERT COIN, attract mode cycling to the high-score table, an Incident Report showing score, level, root cause, services used, and an accurate sourced fact, and smooth initials entry. Properties P1, P9, and P10 run at ≥ 100 runs, and the edge cases below have unit tests. No TODO stubs. The reviewer rejects anything missing or half-done.

## Requirements

### CC-1 Coins
1. WHEN the player presses `C` on any screen other than `initials`, or `5` on any screen, THE SYSTEM SHALL add one credit and play the coin SFX, unless credits are already 99.
2. WHEN a coin key is pressed with 99 credits THE SYSTEM SHALL keep credits at 99 and report the coin as rejected.
3. THE SYSTEM SHALL never hold fewer than 0 or more than 99 credits.

### CC-2 Starting a game
1. WHEN the player presses `Enter` on the attract screen AND credits ≥ 1 THE SYSTEM SHALL subtract exactly one credit and start a new game with a fresh seed.
2. WHEN the player presses `Enter` on the attract screen AND credits = 0 THE SYSTEM SHALL NOT start a game, SHALL NOT change credits, and SHALL flash "INSERT COIN" faster for 60 UI ticks.
3. WHILE a game is in progress THE SYSTEM SHALL ignore `Enter` as a start command.

### CC-3 Attract mode
1. WHILE on the attract screen THE SYSTEM SHALL show the title "KIRO-MAN", the subtitle "OUTAGE IN THE DATA CENTER", the credit count, and "INSERT COIN" blinking at a 30-UI-tick period (or "PRESS ENTER" when credits ≥ 1).
2. WHILE on the attract screen THE SYSTEM SHALL alternate every 480 UI ticks between the title panel and the high-score panel (local, plus global when available).

### CC-4 Lives HUD
1. WHILE playing THE SYSTEM SHALL display score, high score, level, remaining lives (as ghost icons), credits, and the active power-up labels with timer bars.

### CC-5 Game over → Incident Report
1. WHEN the engine state reaches phase `gameOver` (checked after every engine step and every QA mutator call, dispatched once per game) THE SYSTEM SHALL show the Incident Report screen with: incident number (seed in hex), root cause (`"<NAME> CAUGHT KIRO"` when an enemy caught the player, with names LATENCY / THROTTLE / COLD START / OUTAGE; `"SHIFT ENDED (30:00)"` for the time limit; `"MANUAL FAILOVER"` for a QA-forced game over), final score, level reached, bugs fixed, services used with counts, and one fact.
2. WHILE the Incident Report has been shown for fewer than 60 UI ticks THE SYSTEM SHALL ignore `Enter`.

### CC-6 Facts
1. THE SYSTEM SHALL pick the fact deterministically from `src/content/aws-facts.json` using `pickFact(servicesUsed, seed)`, choosing only among facts about services that were used, or DynamoDB facts when none were used.
2. THE SYSTEM SHALL show only facts that have a `sourceUrl` on `docs.aws.amazon.com` or `aws.amazon.com`.
3. WHEN `aws-facts.json` is loaded THE SYSTEM SHALL reject it at load time unless every fact has a unique id matching `^[a-z0-9-]+$`, a service in the power-up kinds or `dynamodb`, text of 1..120 characters whose uppercase form uses only pixel-font glyphs, and an https source URL on an allowed host, with ≥ 2 facts per power-up kind and ≥ 2 for `dynamodb`.
4. THE SYSTEM SHALL render fact text in uppercase.

### CC-7 Initials entry
1. WHEN the player confirms the Incident Report AND the score qualifies for the local top 10 THE SYSTEM SHALL show the initials-entry screen with three slots starting at "AAA".
2. WHILE entering initials THE SYSTEM SHALL let the Up/Down arrow keys cycle the current letter A–Z (wrapping), the Left/Right arrow keys move between slots, typing any letter A–Z (including C, M, P, W, A, S, D; lowercase uppercased) set the current slot and advance, other keys be ignored, and Enter confirm. No letter key SHALL act as a hotkey (coin, mute, pause, or movement) on this screen.
3. WHEN 1800 UI ticks pass without a confirm THE SYSTEM SHALL auto-confirm the current initials.
4. THE SYSTEM SHALL only ever produce initials that match `^[A-Z]{3}$`.

### CC-8 High-score screen and return
1. WHEN initials are confirmed THE SYSTEM SHALL emit `saveLocalScore` and, unless the session is tainted, offline, or the input log exceeds 10000 events (status REJECTED, shown as "LOG TOO LONG"), `submitRemote`, then show the high-score screen with the new entry highlighted and the remote status (SUBMITTING / VERIFIED / REJECTED / OFFLINE).
2. WHEN the score does not qualify THE SYSTEM SHALL go straight from the Incident Report to the high-score screen. A remote submission is still emitted when online and the score is > 0, using the last-confirmed initials of this cabinet session, or "KIR" if none, unless the session is tainted or the input log exceeds 10000 events (same rules as CC-8.1). It is emitted in the `reduce` result for the `confirm` that leaves `incident` for `highscores`.
3. WHEN a `submitRemote` effect is emitted THE SYSTEM SHALL set the remote status to SUBMITTING; WHEN the submission is suppressed THE SYSTEM SHALL set it to IDLE (tainted), OFFLINE (offline), or REJECTED with "LOG TOO LONG" (log cap).
4. WHEN 600 UI ticks pass on the high-score screen or Enter is pressed THE SYSTEM SHALL return to attract, keeping any remaining credits.

## Acceptance Criteria

1. P1a/P1b (credits), P9 (initials) and P10 (facts) pass at ≥ 100 runs.
2. `src/app/keyboard.test.ts` shows that on `initials` the keys C, M, P, W, A, S, D map only to `initialsKey({char})` and `5` maps to `coin`, and that on other screens C and 5 map to `coin` and M to mute.
3. Unit tests: a log of more than 10000 events emits no `submitRemote` and sets `remoteStatus = 'rejected'`; the three root-cause texts render for `caught`, `timeLimit`, `qa`.
4. Unit tests: start with 0 credits is a no-op, coin at 99 is rejected, Enter is ignored while playing, the incident Enter lockout lasts 60 ticks, the initials timeout auto-confirms, and a non-qualifying score skips initials.
5. The reducer is pure: the same state and event always give the same result (unit test), and it has no imports from render, audio, or app.
6. `facts.test.ts` asserts every fact passes load-time validation, including glyph coverage after uppercasing.
7. In the browser (headless screenshots), C then Enter starts the game and the credit counter drops 1 → 0.

## Out of Scope

Persisting credits across reloads, free-play mode, continues, and a coin-door service menu.
