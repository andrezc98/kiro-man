# Tasks — arcade-presentation

- [x] 1. `index.html` (canvas `role="img"`, aria-live region, controls legend, `#crt`, `<link rel="icon" href="data:,">`), `src/styles.css` (pixelated, CRT, reduced motion). _AP-1, AP-4, AP-7_
- [x] 2. `palette.ts`, `font.ts` (5x7 glyphs, `?` fallback), `sprites.ts` (all actors, 2 frames) plus validation unit tests. _AP-2_
- [x] 3. `renderer.ts`, `hud.ts`, screens (attract, playing, incident, initials, highscores), `wrapText`, darkness, CloudWatch overlay, pad animation, banners, death animation. _AP-3_
- [x] 4. `integerScale` plus PBT P11. _AP-1_
- [x] 5. `src/audio/sfx.ts` with every SFX, mute, null-context handling, plus unit tests. _AP-5_
- [x] 6. `src/app/loop.ts`, `keyboard.ts`, `main.ts`, `a11y.ts`, `qa.ts` plus unit tests (loop spiral cap, key stack). _AP-6, AP-7_
- [ ] 7. `scripts/screenshots.mjs` (pinned seed/script from overview §9.7: wait for `getScreen() === 'incident'` after `forceGameOver`, then 70 frames before Enter; frame-count waits, not sleeps) and `npm run verify:browser`; commit the eight PNGs in `docs/screenshots/`. _AP-8_
- [x] 8. Manual play-through check: smooth movement, all power-ups, difficulty ramp across levels 1–3.
