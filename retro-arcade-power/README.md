# retro-arcade-power

A Kiro power for building deterministic retro canvas games, packaged from the KIRO-MAN project. It ships in both layouts:

- `POWER.md` + `steering/` (the layout installed Kiro powers use);
- `plugin.json` + `skills/deterministic-canvas-games/` (the lesson5 manifest layout);
- `mcp.json` + `server/arcade-operator.mjs` (the bundled MCP server, no `npm install` needed).

## Contents

| Path | What it is |
|---|---|
| `POWER.md` | Front-matter (name, displayName, description, keywords, author) plus overview, onboarding, tools, workflows, troubleshooting |
| `steering/determinism-checklist.md` | Seeded PRNG, integer math, plain-JSON state, fixed step order, static guard, tests |
| `steering/fixed-timestep-loop.md` | 60 Hz accumulator loop with a spiral cap, input sampling and recording, loop tests |
| `steering/replay-validation.md` | Input logs, the replay loop, schema validation, server-side score checks |
| `steering/pixel-art-canvas.md` | Integer scaling, palette, sprites and bitmap font as data, CRT overlay, accessibility |
| `plugin.json` | Manifest: version, keywords, license, skill and MCP pointers |
| `skills/deterministic-canvas-games/SKILL.md` | When to use the skill, the workflow, links to the references |
| `skills/deterministic-canvas-games/references/*.md` | The same four guides as `steering/` |
| `mcp.json` | `arcade-operator` server config with an `${ABSOLUTE_PATH_TO}` placeholder |
| `server/arcade-operator.mjs` | esbuild bundle of `mcp/arcade-operator` (tools: `get_leaderboard`, `validate_replay`, `list_power_ups`) |

## Trigger keywords

`retro`, `arcade`, `8-bit`, `pixel art`, `canvas game`, `deterministic`, `replay`, `leaderboard`.

## Prerequisite

Inside the KIRO-MAN repo, run `npm run build:mcp` to rebuild `server/arcade-operator.mjs` from `mcp/arcade-operator/src` (it is copied here by `mcp/arcade-operator/scripts/copy-to-power.mjs`). The committed bundle already works on its own; Node.js 22+ is the only runtime requirement.

## Install

Kiro IDE: open the Powers panel, choose to add a power from a local folder, and select this `retro-arcade-power/` folder (or point it at the GitHub URL of a repo containing it).

Kiro CLI:

```bash
kiro-cli powers install /absolute/path/to/kiro-man/retro-arcade-power
```

After installing, edit the installed `mcp.json` and replace `${ABSOLUTE_PATH_TO}` with the absolute path of the folder that contains `retro-arcade-power/`, so `args` points at `server/arcade-operator.mjs`. MCP `args` are not resolved relative to the power folder.

## Recorded install on the development machine

- `kiro-cli powers install /Users/andreszeballoscarbajal/Documents/kiro-uni/kiro-man/retro-arcade-power` (Kiro CLI 2.27.1, macOS) printed `Installed power "retro-arcade-power"` and exited 0. The power was copied to `~/.kiro/powers/installed/retro-arcade-power/` with `POWER.md`, `plugin.json`, `mcp.json`, `server/`, `skills/` and `steering/`, and an entry `{ "name": "retro-arcade-power" }` was added to `~/.kiro/powers/installed.json`.
- The install was run from an agent shell, so the Kiro IDE Powers panel flow ("add from local folder") was not clicked through. Its result in the panel was not observed.
- Remove it with `kiro-cli powers uninstall retro-arcade-power`.
- The bundled server was checked over stdio: `tools/list` returns `get_leaderboard`, `validate_replay` and `list_power_ups`, and `validate_replay` on the repo's `mcp/arcade-operator/data/sample-replay.json` returns `valid: true`.
