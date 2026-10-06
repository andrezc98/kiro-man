# Design — leaderboard

## Overview

Ranking logic is pure (`src/leaderboard/ranking.ts`), and storage and network sit behind thin adapters with injected dependencies (`localStore.ts`, `remoteClient.ts`). The submission schema (`src/shared/submission.ts`) and replay validator (`src/shared/replay.ts`) are shared by the browser, the Lambda, and the MCP server. The backend is a CDK v2 stack: HTTP API → Lambda (Node 22, esbuild-bundled) → DynamoDB, plus S3 + CloudFront hosting. It is synth only. The stack versions are locked in `../_design-overview.md` §4.2.

## Quality bar / no scope cuts

All of LB-1..LB-8 are required. P6–P8 run at ≥ 100 runs, plus the unit tests listed below. Synth must pass and cfn-lint must be recorded. No TODOs.

## Modules and APIs

```ts
// src/leaderboard/ranking.ts
export interface ScoreEntry { initials: string; score: number; level: number }
export const INITIALS_RE = /^[A-Z]{3}$/; export const MAX_ENTRIES = 10;
export function isValidEntry(e: unknown): e is ScoreEntry; // initials RE, score int ≥ 0, level int ≥ 1
export function qualifies(list: readonly ScoreEntry[], score: number): boolean;
export function insertScore(list: readonly ScoreEntry[], entry: ScoreEntry):
  { ok: true; list: ScoreEntry[]; rank: number | null } | { ok: false; error: 'invalid_entry'; list: ScoreEntry[] };
export function normalize(raw: unknown): { list: ScoreEntry[]; dropped: number }; // filter valid, stable sort desc, take 10

// src/leaderboard/localStore.ts
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
export function createLocalStore(kv: KV | null, warn: (m: string) => void): { load(): ScoreEntry[]; save(list: ScoreEntry[]): void };

// src/leaderboard/remoteClient.ts
export type RemoteErr = { kind: 'network'|'timeout'|'http'; status?: number } | { kind: 'bad_response' } | { kind: 'rejected'; error: string };
export function createRemoteClient(opts: { apiUrl: string; fetch: typeof fetch; timeoutMs?: number /* 3000 */ }): {
  getTop(): Promise<Result<ScoreEntry[], RemoteErr>>;
  submit(s: Submission): Promise<Result<{ score: number; level: number }, RemoteErr>> };

// src/shared/submission.ts
export interface Submission { initials: string; seed: number; inputLog: InputLog; claimedScore: number }
export function parseSubmission(u: unknown): Result<Submission, FieldError[]>;
export function parseReplayInput(u: unknown): Result<Omit<Submission,'initials'>, FieldError[]>; // MCP

// infra/lambda/core.ts (no AWS SDK import → testable from root vitest)
export interface ScoreStore { put(e: ScoreEntry & { createdAt: string; id: string }): Promise<void>; top(n: number): Promise<ScoreEntry[]> }
export interface HttpReq { method: string; path: string; body: string | null; isBase64Encoded: boolean }
export interface HttpRes { statusCode: number; headers: Record<string,string>; body: string }
export async function handle(req: HttpReq, deps: { store: ScoreStore; now: () => string; uuid: () => string; log: Logger; maxBodyBytes: number;
  replayOpts?: ReplayOpts /* tests only: a small maxTicks is the only way to reach replay_incomplete; the handler never sets it */ }): Promise<HttpRes>;

// infra/lambda/dynamo-store.ts → DynamoScoreStore (DynamoDBDocumentClient: PutCommand / QueryCommand ScanIndexForward:false Limit:n)
// infra/lambda/scores-handler.ts → export const handler = (event: APIGatewayProxyEventV2-like) => handle(map(event), realDeps)
```

`Result<T,E> = { ok: true; value: T } | { ok: false; error: E }` lives in `src/shared/result.ts`.

## Key decisions

**Pure core plus adapters.** `core.ts` takes injected `store`, `now`, `uuid`, and `log`, so every status code can be unit tested from the root Vitest run without the AWS SDK. Only `dynamo-store.ts` imports `@aws-sdk/*`. It is externalized at bundle time, because the Node 22 Lambda runtime ships SDK v3, and it is installed in `infra` for types.

**DynamoDB key design.** A single partition `pk="GLOBAL"` with `sk = zeroPad10(score) + "#" + createdAt + "#" + id`. A Query with `ScanIndexForward:false, Limit:10` gives the top 10 directly, without a scan or GSI. A hot partition is acceptable at arcade-demo volume, and the README notes this. Equal scores order by createdAt descending on the server. That is acceptable and documented: local and global tie rules differ.

**Request-size limit in the Lambda.** HTTP API's payload limit is fixed at 10 MB, so the Lambda checks `Buffer.byteLength(decodedBody) > maxBodyBytes (131072)` before `JSON.parse`. Memory is capped by the 10000-event limit.

**Replay cost.** At worst a 108000-tick replay, which the engine perf test bounds at under 1.5 s locally. Lambda is set to 1024 MB (about 0.6 vCPU) and a 15 s timeout. Logs go to `logGroup: new logs.LogGroup(this, 'ScoresFnLogs', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY })` (not the deprecated `logRetention`).

**Routes.** `ANY /scores` and `ANY /{proxy+}` both go to the Lambda through one `HttpLambdaIntegration`, so `core.handle` owns 404/405. `corsPreflight` makes API Gateway answer OPTIONS. `core.handle`: `GET /scores` → 200; `POST /scores` → submission path; other method on `/scores` → 405 `method_not_allowed`; anything else (including `/scores/`) → 404 `not_found`. The stack test asserts both routes exist.

**Remote error mapping (`remoteClient.submit`).** Any 2xx whose JSON body matches `{accepted: true, score: int, level: int}` (extra fields allowed) → `ok`; a 2xx with any other body → `bad_response`. 400/413/422 → `{kind:'rejected', error: body.error}` (UI `rejected`). Other non-2xx → `{kind:'http', status}`; network → `network`; abort → `timeout`; non-JSON or wrong shape → `bad_response`; all four map to UI `offline`. `getTop` failures show OFFLINE in the global panel only. `main.ts` awaits `loadConfig()` before `initialCabinet(apiUrl !== null)`; `online` is fixed for the session.

**TypeScript and bundling across packages (binding).** Root and `infra/tsconfig.json` both use `"module": "ESNext", "moduleResolution": "Bundler", "resolveJsonModule": true, "verbatimModuleSyntax": true, "target": "ES2022", "strict": true`; infra adds `"lib": ["ES2022"], "types": ["node"]`, includes `bin`, `lib`, `lambda`, `test`, `../src/engine`, `../src/shared`, `../src/content`, `../src/leaderboard/ranking.ts`, and sets `"exclude": ["../src/**/*.test.ts", "../src/test-support/**", "lambda/**/*.test.ts", "cdk.out"]` (root and lambda tests import fast-check, which is only installed at the root; they are type-checked by the root `tsc`). Imports are extensionless; JSON is imported with a default import. `infra/package.json` devDependencies: `aws-cdk 2.1144.0`, `esbuild 0.28.2`, `tsx 4.23.15`, `@types/node 22.20.5`, `vitest 5.0.3`, `typescript 5.9.3`; dependencies: `aws-cdk-lib 2.272.0`, `constructs 10.8.1`, `@aws-sdk/client-dynamodb 3.1146.0`, `@aws-sdk/lib-dynamodb 3.1146.0`. Local esbuild means `NodejsFunction` never falls back to Docker. Local bundling runs `npx --no-install esbuild` from `projectRoot` (the repo root), so the root package also has `esbuild 0.28.2` as a devDependency.

**Stage throttling.** `new HttpApi(this, 'ScoresApi', { createDefaultStage: false, corsPreflight: {...} })` plus `api.addStage('DefaultStage', { stageName: '$default', autoDeploy: true, throttle: { rateLimit: 10, burstLimit: 20 } })`. `api.apiEndpoint` is the URL. The stage's construct id is not `'Default'`, because CDK drops `Default` path segments from logical IDs and the stage would collide with the API's own logical ID.

**Hosting and config.** `S3BucketOrigin.withOriginAccessControl(bucket)` is used. When `../dist` exists, a `BucketDeployment` deploys it along with `Source.jsonData('config.json', { apiUrl: api.apiEndpoint })`. The client fetches `./config.json` at boot. Runtime config was chosen over a build-time `VITE_` variable so one build works offline and online with no rebuild after deploy.

**CDK app runner.** In `cdk.json`, `"app": "npx tsx bin/kiro-man.ts"`. `infra/package.json` has `"type":"module"` and scripts `synth`=`cdk synth --quiet`, `typecheck`=`tsc --noEmit`, and `test`=`vitest --run --dir test` (discovery limited to `infra/test/`, so only `stack.test.ts` runs; the lambda core tests run from the root Vitest). Paths use `fileURLToPath(new URL(..., import.meta.url))`. `NodejsFunction` sets `bundling: { minify: true, sourceMap: true, target: 'node22', externalModules: ['@aws-sdk/*'] }` and `projectRoot` set to the repo root, so esbuild can resolve `../../src/...`. `depsLockFilePath` is `infra/package-lock.json`.

## Edge cases (unit tests)

- Ranking: insert into an empty list; an 11th entry lower than all of them is rejected; an 11th equal to the lowest is rejected (strictly greater is required); a tie with an existing entry ranks below it; score 0 doesn't qualify; level 0 is invalid.
- normalize: a non-array, an array with junk, and more than 10 valid entries.
- Submission: extra key, float seed, seed 2^32, negative tick, equal consecutive ticks, dir 5, 10001 events, initials "abc", claimedScore as a string, and a non-object body.
- Lambda: base64 body over the limit only after decoding (and under the limit after decoding), an empty body, a GET with Dynamo failing (503), and a path `/scores/` with a trailing slash (404).
- remoteClient: apiUrl with a trailing slash is normalized, and the response has extra fields (accepted).
- remoteClient mapping: 201 and 200 with the accepted body → `ok`; 204 or a 2xx with `{accepted:false}` → `bad_response`; 400, 413, 422 → `rejected`; 500/503 → `http`; fetch throws → `network`; abort → `timeout`; HTML body → `bad_response`.
- Lambda routes: `PUT /scores` → 405, `GET /foo` → 404, `GET /scores/` → 404.
- MCP `get_leaderboard` local source with a missing file returns `{scores: [], note: "no local scores file"}`.

## Error handling

See overview §10. Lambda logs are structured JSON lines via `console.log(JSON.stringify({level, msg, ...}))`. Request bodies are never logged. Mismatches log `seed`, `claimedScore`, `replayedScore`, and `events` (the count). The browser adapters never throw: every failure maps to `RemoteErr` or a warn, and the UI shows a status. Every response includes `content-type: application/json`. CORS headers are added by API Gateway's `corsPreflight` config.

## Validation rules

Every external input is listed in requirements LB-4 (submission), LB-3 (stored data via `normalize`), and LB-7 (config.json: `apiUrl` must parse with `new URL` and use protocol http or https; anything else means offline). Remote GET responses are run through `normalize`, so a malicious or broken API can't inject invalid initials into the UI.

## Invariant ownership

| Invariant | Owner | Why |
|---|---|---|
| Sorted desc, ≤ 10, valid initials | `ranking.ts` (`insertScore`, `normalize`) | Single choke point for local and remote lists |
| Only replay-verified scores stored | `core.ts` (`handle` calls `validateReplay` before `store.put`) | Server is the trust boundary |
| Size/shape limits | `core.ts` (bytes) + `submission.ts` (shape) | Shared schema reused by MCP |
| Throttling | API Gateway stage | Infrastructure-level, before compute cost |

## Testability

Unit: ranking, localStore (fake KV), remoteClient (fake fetch + fake timers), submission, and core (fake store). PBT: P6, P7, P8. Integration: `cdk synth`, plus a Vitest test in `infra/test/stack.test.ts` run by `npm --prefix infra test` using `aws-cdk-lib/assertions` `Template.fromStack` to assert the throttle settings, billing mode, runtime, OAC, and Lambda env. That requires `vitest` 5.0.3 as an infra devDependency.

## Correctness Properties

| ID | Property | Requirement |
|---|---|---|
| P6 | For any valid sorted list (≤ 10) and any entry: `insertScore` gives a list sorted desc (stable ties), length ≤ 10, all initials `^[A-Z]{3}$`; the multiset count of entries deep-equal to the candidate increases by exactly 1 iff `qualifies` was true, otherwise the list is deep-equal to the input; invalid entries are rejected with the list unchanged | LB-1, LB-2 |
| P7 | Pure (`src/shared/replay.property.test.ts`): for any seed and input log played through the client recorder loop with `opts = {startLives:1, maxTicks:6000}`, and `validateReplay(sub, opts)` given the same `opts`: if the recording reached `gameOver`, `validateReplay` accepts the recorded score and rejects every other `claimedScore` (`replay_mismatch`); if it hit `maxTicks`, it rejects every claim (`replay_incomplete`). Core (`infra/lambda/core.property.test.ts`): games recorded with the default config (`createGame(seed)`, 3 lives, no `maxTicks` cap, matching what `core.handle` replays; bounded because every shipped level has `X` reachable from `P` (game-engine P2b), so Latency's pursuit reaches the player, and by the engine time limit), logs from `fc.array(..., {maxLength: 20})`, 120 s per-test timeout: claim = recorded → 201 and exactly one `store.put`; claim ≠ recorded → 422 `replay_mismatch` and zero `put`s | LB-5 |
| P8 | For any `fc.jsonValue()` and any single-field mutation of a valid submission, `parseSubmission` never throws and returns ok iff all LB-4 rules hold | LB-4 |

All use `numRuns: PBT_RUNS` (200).
