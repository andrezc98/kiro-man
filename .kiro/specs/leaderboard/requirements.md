# Requirements — leaderboard

## Introduction

This spec covers the local top-10 high scores in localStorage, the optional remote leaderboard client, the shared submission schema, and the serverless backend (AWS CDK v2, synth only). The backend's Lambda replays every submitted input log with the shared engine and rejects any score it can't reproduce. See `../_design-overview.md` §7.

## Quality bar / no scope cuts

Local and remote leaderboards, the full CDK stack (HTTP API with throttling, Lambda, DynamoDB on-demand, S3 + CloudFront), replay validation, the request-size limit, and the README security note are all required. Properties P6, P7, and P8 run at ≥ 100 runs, the Lambda core has unit tests for every status code, `npx cdk synth` passes, and cfn-lint is run with its result recorded. No TODO stubs. The reviewer rejects anything missing or half-done.

## Requirements

### LB-1 Local ranking
1. THE SYSTEM SHALL keep at most 10 local entries `{initials, score, level}`, sorted by score descending, with ties ordered by insertion (the earlier entry ranks higher).
2. WHEN a score is > 0 AND (fewer than 10 entries exist OR it is strictly greater than the lowest score) THE SYSTEM SHALL treat it as qualifying, insert it, and return its 1-based rank.
3. WHEN a score does not qualify THE SYSTEM SHALL return the list unchanged with rank `null`.

### LB-2 Initials validation
1. THE SYSTEM SHALL accept only initials that match `^[A-Z]{3}$` in local inserts, remote submissions, and stored data.
2. WHEN an insert has invalid initials, a non-integer score, or a negative score THE SYSTEM SHALL reject it and leave the list unchanged.

### LB-3 Local persistence
1. THE SYSTEM SHALL persist the list as JSON in localStorage key `kiroman.highscores.v1`.
2. WHEN stored data is missing, unparseable, or contains invalid entries THE SYSTEM SHALL load only the valid entries (re-sorted and truncated to 10) and log one warning.
3. WHEN localStorage is unavailable or throws THE SYSTEM SHALL keep scores in memory for the session and log one warning.

### LB-4 Submission schema
1. THE SYSTEM SHALL accept a submission only if it is a JSON object with exactly these keys: `initials` (`^[A-Z]{3}$`), `seed` (integer 0..4294967295), `inputLog` (array of ≤ 10000 `[tick, dir]` pairs, with ticks integer in 0..107999 and strictly increasing, and dir integer 0..4), and `claimedScore` (integer 0..10000000).
2. WHEN parsing any input THE SYSTEM SHALL return a result with field-level errors rather than throwing.

### LB-5 Remote submission (POST /scores)
1. WHEN the request body exceeds 131072 bytes, measured after base64 decoding, THE SYSTEM SHALL respond 413 `{"error":"payload_too_large"}`.
2. WHEN the body is not valid JSON or fails the schema THE SYSTEM SHALL respond 400 `{"error":"invalid_request","details":[...]}`.
3. WHEN the replay does not reach game over within 108000 ticks THE SYSTEM SHALL respond 422 `{"error":"replay_incomplete"}`.
4. WHEN the replayed score differs from `claimedScore` THE SYSTEM SHALL respond 422 `{"error":"replay_mismatch"}` and SHALL NOT store anything.
5. WHEN the replayed score equals `claimedScore` THE SYSTEM SHALL store `{initials, score, level, createdAt}` and respond 201 `{"accepted":true,"score":N,"level":L}`.
6. WHEN DynamoDB fails THE SYSTEM SHALL respond 503 `{"error":"storage_unavailable"}` and log at error level.

### LB-6 Remote read (GET /scores)
1. WHEN GET /scores is called THE SYSTEM SHALL return 200 `{"scores":[{initials, score, level}]}` with the top 10, highest first.
2. WHEN a method other than GET or POST is called on `/scores` THE SYSTEM SHALL respond 405 `{"error":"method_not_allowed"}`, and WHEN any other path is called THE SYSTEM SHALL respond 404 `{"error":"not_found"}` (both routes `ANY /scores` and `ANY /{proxy+}` reach the Lambda; CORS preflight is answered by API Gateway).

### LB-7 Client behavior and offline
1. WHEN no `config.json` with a valid https/http `apiUrl` is available THE SYSTEM SHALL run fully offline with local scores and show "OFFLINE" on the high-score screen.
2. WHEN a remote call fails or exceeds 3 s THE SYSTEM SHALL fall back to local data and never block gameplay. A POST answered with any 2xx whose body is `{accepted: true, score, level}` SHALL show "VERIFIED"; a 2xx with any other body SHALL show "OFFLINE"; a POST answered 400/413/422 SHALL show "REJECTED"; any other non-2xx, network error, timeout, or unparseable body SHALL show "OFFLINE". A failed GET SHALL show "OFFLINE" in the global panel without changing the session's online flag.
2a. THE SYSTEM SHALL decide the online flag once per session, after the config load (≤ 2 s) completes and before the cabinet is created.
3. WHEN the session was tainted by QA hooks THE SYSTEM SHALL NOT submit remotely.

### LB-8 Infrastructure
1. THE SYSTEM SHALL define a CDK v2 TypeScript stack under `infra/` with an HTTP API (`$default` stage throttled at rate 10 rps and burst 20), a Node 22 Lambda, an on-demand DynamoDB table, and an S3 bucket (private, SSL-only) behind CloudFront with Origin Access Control.
2. THE SYSTEM SHALL synthesize with `npx cdk synth` without AWS credentials or bootstrap.
3. THE SYSTEM SHALL bundle the Lambda from the same `src/shared` and `src/engine` sources the browser uses.
4. THE SYSTEM SHALL document in the README that the API is unauthenticated, and that throttling, size limits, schema validation, and replay validation are the mitigations.

## Acceptance Criteria

1. P6, P7, and P8 pass at ≥ 100 runs.
2. Lambda core unit tests cover 201, 400 (bad JSON, schema), 413 (plain and base64), 422 (mismatch, incomplete), 503, 404, 405, GET ordering, and CORS-irrelevant OPTIONS (handled by API Gateway, not the Lambda).
3. localStore unit tests cover corrupt JSON, partially invalid entries, a throwing storage, and a quota error on write.
4. The remoteClient unit tests (fake fetch) cover success, timeout, non-2xx, and bad JSON, and show that it never throws.
5. `cd infra && npx cdk synth --quiet` exits 0 with no AWS credentials in the environment (run with `AWS_PROFILE` unset and `AWS_ACCESS_KEY_ID` empty). The template has the HTTP API stage `ThrottleSettings`, `BillingMode: PAY_PER_REQUEST`, runtime `nodejs22.x`, and a CloudFront OAC.
6. `docs/cfn-lint-report.txt` exists with the cfn-lint result, and `docs/power-iac-validation.md` records the `aws-infrastructure-as-code` power's cfn-lint and cfn-guard results. Any errors are fixed or each one is justified there.
7. The remoteClient tests cover the status mapping (400/413/422 → rejected; other non-2xx, network, timeout, bad body → offline), and core tests cover 405 on `PUT /scores` and 404 on `/scores/`.
8. With the game served by `vite preview` and no `config.json`, a full game and high-score entry work, and the screen shows OFFLINE.

## Out of Scope

Auth or user accounts, anti-bot measures beyond replay, per-IP rate limiting, score deletion or moderation, and an actual deployment.
