/**
 * arcade-operator MCP server (stdio). Wires the handlers in `tools.ts` to `McpServer`; stdout carries
 * JSON-RPC only, so every diagnostic goes to stderr.
 *
 * Environment: `KIROMAN_API_URL` (remote leaderboard base URL, optional) and `KIROMAN_LOCAL_SCORES`
 * (local scores file, default `<cwd>/mcp/arcade-operator/data/local-scores.json`).
 */
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LEADERBOARD_SOURCES, getLeaderboard, listPowerUps, validateReplayTool } from './tools';
import type { ToolDeps } from './tools';

const log = (message: string): void => {
  process.stderr.write(`arcade-operator: ${message}\n`);
};

const deps: ToolDeps = {
  fetch: (input, init) => fetch(input, init),
  readFile: (path) => readFile(path, 'utf8'),
  env: process.env,
  cwd: () => process.cwd(),
  log,
};

const server = new McpServer({ name: 'arcade-operator', version: '1.0.0' });

server.registerTool(
  'get_leaderboard',
  {
    title: 'KIRO-MAN leaderboard',
    description:
      'Top 10 KIRO-MAN scores. source "remote" reads KIROMAN_API_URL/scores (3 s timeout), "local" reads the ' +
      'local scores file exported by the headless run, "auto" (default) tries remote and falls back to local.',
    inputSchema: {
      source: z.enum(LEADERBOARD_SOURCES).optional().describe('auto (default), remote or local'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  (args) => getLeaderboard(deps, args),
);

server.registerTool(
  'validate_replay',
  {
    title: 'Validate a KIRO-MAN replay',
    description:
      'Replays an input log with the same deterministic engine the score-validation Lambda uses and reports ' +
      'whether the claimed score is reproduced. Input follows the shared submission schema without initials.',
    inputSchema: z.looseObject({
      seed: z.number().int().describe('Game seed, integer 0..4294967295'),
      inputLog: z
        .array(z.tuple([z.number().int(), z.number().int()]))
        .describe('Array of [tick, dir] pairs, ticks strictly increasing in 0..107999, dir 0 none, 1 up, 2 right, 3 down, 4 left'),
      claimedScore: z.number().int().describe('Score the client claims, integer 0..10000000'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  (args) => validateReplayTool(args),
);

server.registerTool(
  'list_power_ups',
  {
    title: 'KIRO-MAN power-up catalog',
    description: 'The AWS-service power-ups (kind, label, name, duration in ticks at 60 ticks/s, palette color, effect).',
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  () => listPowerUps(),
);

try {
  await server.connect(new StdioServerTransport());
  log('ready on stdio (tools: get_leaderboard, validate_replay, list_power_ups)');
} catch (e) {
  log(`failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
