import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOCK_REASON, decide } from './confirm-deploy.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'confirm-deploy.mjs');

function run(stdin: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
  if (!('KIROMAN_ALLOW_DEPLOY' in extraEnv)) delete env.KIROMAN_ALLOW_DEPLOY;
  return spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8', env });
}

const deployPayload = { tool_name: 'execute_bash', tool_input: { command: 'cd infra && npx cdk deploy --all' } };
const synthPayload = { tool_name: 'execute_bash', tool_input: { command: 'cd infra && npx cdk synth --quiet' } };

describe('decide', () => {
  it('blocks a top-level cdk deploy command', () => {
    expect(decide({ command: 'cdk deploy' }, {})).toEqual({ block: true, reason: BLOCK_REASON });
  });

  it('blocks when the command is nested in objects and arrays', () => {
    expect(decide(deployPayload, {})).toEqual({ block: true, reason: BLOCK_REASON });
    expect(decide({ a: [{ b: ['ls', { c: 'npx  cdk\tdeploy KiroManStack' }] }] }, {}).block).toBe(true);
  });

  it('allows commands that are not cdk deploy', () => {
    expect(decide(synthPayload, {})).toEqual({ block: false, reason: null });
    expect(decide({ command: 'npx cdk diff' }, {})).toEqual({ block: false, reason: null });
    expect(decide({ command: 'echo cdkdeploy; npm run redeploy' }, {}).block).toBe(false);
    expect(decide({ 'cdk deploy': 'object keys are not values' }, {}).block).toBe(false);
    expect(decide(null, {}).block).toBe(false);
    expect(decide(42, {}).block).toBe(false);
  });

  it('lets KIROMAN_ALLOW_DEPLOY=1 override, and only the exact value 1', () => {
    expect(decide(deployPayload, { KIROMAN_ALLOW_DEPLOY: '1' })).toEqual({ block: false, reason: null });
    expect(decide(deployPayload, { KIROMAN_ALLOW_DEPLOY: 'true' }).block).toBe(true);
    expect(decide(deployPayload, { KIROMAN_ALLOW_DEPLOY: '0' }).block).toBe(true);
  });
});

describe('confirm-deploy.mjs process', () => {
  it('exits 2 with the ask payload on stdout and the reason on stderr for cdk deploy', () => {
    const r = run(JSON.stringify(deployPayload));
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: BLOCK_REASON },
    });
    expect(r.stderr).toContain(BLOCK_REASON);
  });

  it('exits 2 for a nested cdk deploy', () => {
    const r = run(JSON.stringify({ tool_input: { steps: [{ run: 'npx cdk deploy' }] } }));
    expect(r.status).toBe(2);
  });

  it('exits 0 silently for other commands', () => {
    const r = run(JSON.stringify(synthPayload));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('exits 0 silently for invalid JSON and empty stdin', () => {
    for (const input of ['not json {', '']) {
      const r = run(input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    }
  });

  it('exits 0 for cdk deploy when KIROMAN_ALLOW_DEPLOY=1', () => {
    const r = run(JSON.stringify(deployPayload), { KIROMAN_ALLOW_DEPLOY: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});
