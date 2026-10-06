---
inclusion: always
---

# KIRO-MAN tech stack and conventions

## Never run `cdk deploy`

This project is synth-only. `cdk deploy` creates real AWS resources and costs money. Use `npm run synth` (and `npx cdk diff` if asked). The `confirm-deploy` hook blocks `cdk deploy` unless the user explicitly sets `KIROMAN_ALLOW_DEPLOY=1`.

## Stack (exact versions; `.npmrc` has `save-exact=true`, lockfiles committed)

| Concern | Package | Version |
|---|---|---|
| Language | typescript (`strict`, `noUncheckedIndexedAccess`, ESNext modules, `moduleResolution: Bundler`, `verbatimModuleSyntax`, `resolveJsonModule`, target ES2022) | 5.9.3 |
| Bundler / dev server | vite | 8.3.2 |
| Tests | vitest, fast-check | 5.0.3, 4.10.2 |
| Node types | @types/node | 22.20.5 |
| Headless browser | playwright (Chromium) | 1.63.0 |
| IaC | aws-cdk-lib, aws-cdk, constructs | 2.272.0, 2.1144.0, 10.8.1 |
| CDK runner / bundler | tsx, esbuild | 4.23.15, 0.28.2 |
| Lambda SDK | @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb | 3.1146.0 |
| MCP server | @modelcontextprotocol/sdk, zod | 1.32.1, 4.6.5 |
| Runtime | Node 22 locally, Lambda `NODEJS_22_X` | |

Three npm packages, each with its own lockfile: the repo root (game and all Vitest tests), `infra/` (CDK app) and `mcp/arcade-operator/` (MCP server).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run preview` | `vite preview --port 4173 --strictPort` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `vitest --run` (all tests incl. the static guard) |
| `npm run test:unit` | unit tests only (excludes `*.property.test.ts`) |
| `npm run test:pbt` | property tests only |
| `npm run build:mcp` | bundle the MCP server to `mcp/arcade-operator/dist/index.js` and copy it into `retro-arcade-power/server/` |
| `npm run synth` | `cdk synth --quiet` in `infra/` |
| `npm run cfn-lint` | lint the synthesized template into `docs/cfn-lint-report.txt` |
| `npm run verify:browser` | build, then Playwright screenshots into `docs/screenshots/` |
| `npm --prefix infra test` | CDK stack assertions |
| `npm --prefix infra run typecheck` | compiles the shared engine with no DOM lib |

## Folder layout

```
src/engine        deterministic simulation (pure)
src/engine/enemies  four enemy AIs (pure)
src/shared        replay + submission schema (pure; shared with Lambda and MCP)
src/arcade        cabinet reducer, credits, initials (pure)
src/content       services.json catalog, aws-facts.json, glyphs (pure)
src/leaderboard   ranking (pure), localStorage + remote adapters
src/render        canvas renderer, palette, font, sprites, CRT, screens
src/audio         WebAudio SFX
src/app           bootstrap, fixed-timestep loop, keyboard, QA hooks
src/test-support  test helpers
tests/static      S1 static guard
scripts           confirm-deploy hook, screenshots, cfn-lint
infra             CDK app (bin, lib, lambda, test)
mcp/arcade-operator  MCP stdio server (src, scripts, data)
retro-arcade-power   packaged Kiro power
docs              screenshots, cfn-lint and IaC validation reports
.kiro             specs, steering, hooks, agents, settings
```

## Test naming

Tests sit next to their sources: `*.test.ts` for unit tests, `*.property.test.ts` for fast-check property tests with `{ numRuns: PBT_RUNS }` (`PBT_RUNS = 200`, `src/test-support/pbt.ts`). Repo-wide checks live in `tests/`.

## Hygiene

- No unfinished-work tokens or placeholder bodies in code directories (the static guard checks).
- No third-party video game trademark names anywhere in the repo.
- No image or font files under `src/`.
