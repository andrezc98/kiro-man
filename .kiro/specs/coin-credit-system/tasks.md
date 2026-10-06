# Tasks — coin-credit-system

- [ ] 1. `src/arcade/credits.ts` (`insertCoin`, `tryStart`, `MAX_CREDITS`) plus unit tests. _CC-1, CC-2_
- [ ] 2. PBT P1a over `credits.ts` in `credits.property.test.ts`. _CC-1, CC-2_
- [ ] 3. `src/arcade/initials.ts` reducer plus edge-case unit tests. _CC-7_
- [ ] 4. PBT P9 in `initials.property.test.ts`. _CC-7.4_
- [ ] 5. `src/content/glyphs.ts` (`FONT_GLYPHS`), `src/content/aws-facts.json` (≥ 2 facts per power-up kind plus 2 DynamoDB, each verified with the aws-docs MCP and given a `sourceUrl`), `facts.ts` with the load-time validation rules and `pickFact`, plus `facts.test.ts`. _CC-6_
- [ ] 6. PBT P10 in `facts.property.test.ts`. _CC-6.1_
- [ ] 7. `src/arcade/cabinet.ts` reducer (all screens, timings, effects, `rootCause`, 10000-event cap applied to both CC-8.1 and CC-8.2, `submitting`/suppressed remoteStatus transitions, remoteStatus mapping) plus unit tests for every edge case in design.md. _CC-2..CC-8_
- [ ] 8. PBT P1b through the cabinet reducer (with the gameOver + confirm round trip) in `cabinet.property.test.ts`. _CC-1, CC-2.3_
- [ ] 9. `src/app/keyboard.ts` `mapKey(screen, key)` plus `keyboard.test.ts` (C/M/WASD on initials, `5` everywhere). _CC-1.1, CC-7.2_
- [ ] 10. `src/app/session.ts` `checkGameOver(state, session)` plus `session.test.ts` (fires once, incl. after `forceGameOver`; resets on new game). Wire into `src/app/main.ts`: await `loadConfig()` before `initialCabinet`, keyboard → events, `checkGameOver` after every `engine.step` and every QA mutator call, effect executor (sfx, startEngine, saveLocalScore, submitRemote → remoteStatus). _CC-2, CC-5.1, CC-8_
- [ ] 11. Render screens: attract (blink, panel alternation), HUD, incident report (uppercased wrapped fact, root cause), initials, highscores with remote status (see arcade-presentation). _CC-3..CC-8_
- [ ] 12. Run `npm test`; all green, no TODOs.
