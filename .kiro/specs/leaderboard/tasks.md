# Tasks — leaderboard

- [x] 1. `src/shared/result.ts` and `src/leaderboard/ranking.ts` (`qualifies`, `insertScore`, `normalize`, `isValidEntry`) plus edge-case unit tests. _LB-1, LB-2_
- [x] 2. PBT P6 in `ranking.property.test.ts` (multiset-count oracle). _LB-1, LB-2_
- [x] 3. `localStore.ts` with injected KV plus unit tests (corrupt, partial, throwing, quota). _LB-3_
- [x] 4. `src/shared/submission.ts` (`parseSubmission`, `parseReplayInput`) plus unit tests. _LB-4_
- [x] 5. PBT P8 in `submission.property.test.ts`. _LB-4_
- [x] 6. PBT P7 (pure variant) in `src/shared/replay.property.test.ts`, passing the same `{startLives:1, maxTicks:6000}` to the recorder loop and `validateReplay` (depends on game-engine task 13). _LB-5_
- [x] 7. `remoteClient.ts` (binding error mapping: any 2xx with the accepted body → ok, other 2xx → `bad_response`) plus unit tests; `src/app/config.ts` (config.json loader, 2 s timeout, URL validation; awaited before `initialCabinet`). _LB-7_
- [x] 8. `infra/` package: `package.json` (exact pins incl. esbuild, tsx, vitest, @types/node), `tsconfig.json` (Bundler resolution, no DOM lib, `exclude` of root/lambda test files and `test-support`), scripts `synth`/`typecheck`/`test` (`vitest --run --dir test`), `cdk.json`, `bin/kiro-man.ts`. _LB-8_
- [x] 9. `infra/lambda/core.ts` plus unit tests for every status code (incl. 405 on `PUT /scores`, 404 on `/scores/`) and the core-level P7 variant in `infra/lambda/core.property.test.ts` (default-config recordings, `maxLength: 20` logs, 120 s timeout, 201 + one `put` vs 422 + zero `put`s); `dynamo-store.ts`; `scores-handler.ts`. _LB-5, LB-6_
- [x] 10. `infra/lib/kiro-man-stack.ts` (table, 1024 MB function with explicit `logGroup`, HTTP API with `ANY /scores` + `ANY /{proxy+}` and throttled stage, bucket, OAC distribution, conditional BucketDeployment with config.json, outputs). Consult the `aws-infrastructure-as-code` power (`search_cdk_documentation`, `cdk_best_practices`) and cite it in code comments. _LB-8_
- [x] 11. `infra/test/stack.test.ts` assertions (throttle, billing, runtime, OAC, env, both routes, 1024 MB); `npm --prefix infra test`. _LB-8_
- [x] 12. Run `cd infra && npx cdk synth --quiet` with credentials unset; record the result. _AC-5_
- [x] 13. `scripts/cfn-lint.sh` → `docs/cfn-lint-report.txt`; then run the power's `validate_cloudformation_template` and `check_cloudformation_template_compliance` on `infra/cdk.out/KiroManStack.template.json` and save findings plus fixes/justifications to `docs/power-iac-validation.md`. _AC-6_
- [x] 14. Wire local and remote into the app (attract/highscores panels, submit after initials, status) and verify offline play. _LB-7_
- [x] 15. README security section (unauthenticated API + mitigations) and the hot-partition note. _LB-8.4_
