/**
 * Packaging checks for retro-arcade-power (overview §9.6) and the workspace Kiro JSON files (§9.3–9.5):
 * both power layouts agree, the steering guides equal the skill references, and every config parses.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POWER = join(ROOT, 'retro-arcade-power');
const SKILL = join(POWER, 'skills', 'deterministic-canvas-games');
const GUIDES = ['determinism-checklist.md', 'fixed-timestep-loop.md', 'replay-validation.md', 'pixel-art-canvas.md'];

const text = (p: string): string => readFileSync(p, 'utf8');
const json = (p: string): unknown => JSON.parse(text(p));

/** Minimal YAML front-matter reader for `key: value` lines (quoted strings and arrays are JSON-compatible). */
function frontMatter(md: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (m === null || m[1] === undefined) throw new Error('missing front-matter');
  const out: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const raw = line.slice(i + 1).trim();
    out[line.slice(0, i).trim()] = /^["[]/.test(raw) ? JSON.parse(raw) : raw;
  }
  return out;
}

describe('retro-arcade-power', () => {
  const plugin = json(join(POWER, 'plugin.json')) as Record<string, unknown>;
  const power = frontMatter(text(join(POWER, 'POWER.md')));

  it('plugin.json has the lesson5 manifest fields', () => {
    expect(plugin).toMatchObject({
      name: 'retro-arcade-power',
      displayName: 'Retro Arcade (Deterministic Canvas Games)',
      version: '1.0.0',
      keywords: ['retro', 'arcade', '8-bit', 'pixel art', 'canvas game', 'deterministic', 'replay', 'leaderboard'],
      author: 'Andres Zeballos',
      license: 'MIT',
      skills: ['skills/deterministic-canvas-games'],
      mcp: 'mcp.json',
    });
    expect(typeof plugin.description).toBe('string');
  });

  it('POWER.md front-matter matches plugin.json', () => {
    expect(power).toEqual({
      name: plugin.name,
      displayName: plugin.displayName,
      description: plugin.description,
      keywords: plugin.keywords,
      author: plugin.author,
    });
  });

  it('ships the bundled server and an mcp.json pointing at it', () => {
    expect(existsSync(join(POWER, 'server', 'arcade-operator.mjs'))).toBe(true);
    expect(json(join(POWER, 'mcp.json'))).toEqual({
      mcpServers: {
        'arcade-operator': {
          command: 'node',
          args: ['${ABSOLUTE_PATH_TO}/retro-arcade-power/server/arcade-operator.mjs'],
          env: { KIROMAN_API_URL: '', KIROMAN_LOCAL_SCORES: '' },
          disabled: false,
        },
      },
    });
  });

  it('steering guides are identical to the skill references, and SKILL.md links each one', () => {
    expect(readdirSync(join(POWER, 'steering')).sort()).toEqual([...GUIDES].sort());
    expect(readdirSync(join(SKILL, 'references')).sort()).toEqual([...GUIDES].sort());
    const skill = text(join(SKILL, 'SKILL.md'));
    expect(Object.keys(frontMatter(skill)).sort()).toEqual(['description', 'name']);
    for (const g of GUIDES) {
      expect(text(join(POWER, 'steering', g))).toBe(text(join(SKILL, 'references', g)));
      expect(skill).toContain(`references/${g}`);
    }
  });
});

describe('workspace Kiro config', () => {
  it('every hook, agent and MCP settings file parses', () => {
    const files = [
      ...readdirSync(join(ROOT, '.kiro', 'hooks')).filter((f) => f.endsWith('.json')).map((f) => join('.kiro', 'hooks', f)),
      ...readdirSync(join(ROOT, '.kiro', 'agents')).filter((f) => f.endsWith('.json')).map((f) => join('.kiro', 'agents', f)),
      join('.kiro', 'settings', 'mcp.json'),
    ];
    expect(files).toHaveLength(7);
    for (const f of files) expect(() => json(join(ROOT, f)), f).not.toThrow();
  });

  it('the confirm-deploy hook runs the fail-closed script', () => {
    const hook = json(join(ROOT, '.kiro', 'hooks', 'confirm-deploy.json')) as { hooks: Array<{ action: { command: string } }> };
    expect(hook.hooks[0]?.action.command).toBe('node scripts/confirm-deploy.mjs');
  });
});
