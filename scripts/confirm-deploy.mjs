#!/usr/bin/env node
/**
 * PreToolUse hook (.kiro/hooks/confirm-deploy.json, overview §9.3). Reads the hook payload JSON from stdin
 * and fails closed when any string in it runs `cdk deploy`:
 *   - prints {"hookSpecificOutput":{"permissionDecision":"ask",...}} on stdout for runtimes that honor it,
 *   - writes the reason to stderr,
 *   - exits 2 (the widely supported "block" exit code).
 * Invalid JSON on stdin exits 0 with no output (nothing to inspect). `KIROMAN_ALLOW_DEPLOY=1` overrides.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEPLOY_RE = /\bcdk\s+deploy\b/;
export const BLOCK_REASON =
  'cdk deploy creates real AWS resources and costs; this project is synth-only. Confirm explicitly.';

/** Every string value in `value`, depth first (object keys are not values). */
function* strings(value) {
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* strings(item);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) yield* strings(item);
  }
}

/**
 * Pure decision: block iff some string value matches `cdk deploy`, unless `env.KIROMAN_ALLOW_DEPLOY === '1'`.
 * @param {unknown} payload
 * @param {Record<string, string | undefined>} env
 * @returns {{ block: boolean, reason: string | null }}
 */
export function decide(payload, env) {
  if (env.KIROMAN_ALLOW_DEPLOY === '1') return { block: false, reason: null };
  for (const s of strings(payload)) {
    if (DEPLOY_RE.test(s)) return { block: true, reason: BLOCK_REASON };
  }
  return { block: false, reason: null };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exitCode = 0;
    return;
  }
  const { block, reason } = decide(payload, process.env);
  if (!block) {
    process.exitCode = 0;
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: reason } })}\n`,
  );
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}

function isEntryPoint() {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((e) => {
    // Fail closed: an unexpected error must not let a deploy through silently.
    process.stderr.write(`confirm-deploy: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  });
}
