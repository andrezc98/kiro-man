/**
 * S1 — the single static scan definition (overview §8).
 *
 * - File list: `git ls-files -co --exclude-standard` (tracked + untracked-not-ignored), filtered to text
 *   extensions; `package-lock.json` files are always excluded.
 * - Forbidden APIs in the pure dirs, plus the `src/engine` import boundary.
 * - Unfinished-work token scan over src/ infra/ mcp/ scripts/ retro-arcade-power/ tests/ (not retro-arcade-power/server/**).
 * - Banned-name scan over every listed text file in the repo, including this file.
 * - Asset scan: no image or font files under src/.
 *
 * Every sensitive pattern is built from split literals so this file never matches itself.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TEXT_EXTENSIONS = ['.ts', '.mjs', '.js', '.json', '.md', '.html', '.css', '.sh'];
const ASSET_EXTENSIONS = ['.png', '.jpg', '.gif', '.ttf', '.otf', '.woff', '.woff2'];

const PURE_DIRS = ['src/engine/', 'src/shared/', 'src/arcade/', 'src/content/'];
const PURE_FILE_PREFIXES = ['src/leaderboard/ranking.'];

const FORBIDDEN_APIS: ReadonlyArray<[string, RegExp]> = [
  ['Math.random', /\bMath\.random\b/],
  ['Date.now', /\bDate\.now\b/],
  ['performance.now', /\bperformance\.now\b/],
  ['new Date', /\bnew\s+Date\b/],
  ['crypto', /\bcrypto\b/],
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['localStorage', /\blocalStorage\b/],
  ['fetch', /\bfetch\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
];

const UNFINISHED_SCAN_DIRS = ['src/', 'infra/', 'mcp/', 'scripts/', 'retro-arcade-power/', 'tests/'];
const UNFINISHED_SCAN_EXCLUDES = ['retro-arcade-power/server/'];
const UNFINISHED_PATTERN = new RegExp(
  [['TO', 'DO'], ['FIX', 'ME'], ['X', 'XX'], ['not ', 'implemented']].map((p) => p.join('')).join('|'),
);
const BANNED_NAME_PATTERN = new RegExp(['pac', '[- ]?', 'man'].join('') + '|' + ['nam', 'co'].join(''), 'i');

function listFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => existsSync(join(ROOT, l)));
}

function isTextFile(path: string): boolean {
  if (posix.basename(path) === 'package-lock.json') return false;
  return TEXT_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isPure(path: string): boolean {
  return PURE_DIRS.some((d) => path.startsWith(d)) || PURE_FILE_PREFIXES.some((p) => path.startsWith(p));
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** Every module specifier in static imports/exports, side-effect imports and dynamic imports. */
export function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      if (m[1] !== undefined) specs.push(m[1]);
    }
  }
  return specs;
}

/** True when a `src/engine` file may import `spec` (overview §4.1). */
export function engineImportAllowed(fromFile: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const resolved = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  return resolved.startsWith('src/engine/') || resolved === 'src/content/services.json';
}

const allFiles = listFiles();
const textFiles = allFiles.filter(isTextFile);

describe('S1 static guard', () => {
  it('lists the repository files', () => {
    expect(textFiles.length).toBeGreaterThan(0);
    expect(textFiles).toContain('tests/static/guard.test.ts');
  });

  it('patterns detect what they are meant to detect', () => {
    expect(UNFINISHED_PATTERN.test(['// TO', 'DO: x'].join(''))).toBe(true);
    expect(UNFINISHED_PATTERN.test(['not ', 'implemented'].join(''))).toBe(true);
    expect(BANNED_NAME_PATTERN.test(['PAC', '-', 'MAN'].join(''))).toBe(true);
    expect(BANNED_NAME_PATTERN.test(['Nam', 'co'].join(''))).toBe(true);
    expect(BANNED_NAME_PATTERN.test('space management impact')).toBe(false);
    expect(FORBIDDEN_APIS.some(([, re]) => re.test(['Math', '.random()'].join('')))).toBe(true);
    expect(FORBIDDEN_APIS.some(([, re]) => re.test('documented windowing fetcher'))).toBe(false);
    expect(engineImportAllowed('src/engine/game.ts', './maze')).toBe(true);
    expect(engineImportAllowed('src/engine/enemies/latency.ts', '../maze')).toBe(true);
    expect(engineImportAllowed('src/engine/powerups.ts', '../content/services.json')).toBe(true);
    expect(engineImportAllowed('src/engine/game.ts', '../shared/replay')).toBe(false);
    expect(engineImportAllowed('src/engine/game.ts', 'node:fs')).toBe(false);
    expect(importSpecifiers("import type { A } from './a';\nexport { b } from \"../b\";\nimport './c';")).toEqual([
      './a',
      '../b',
      './c',
    ]);
  });

  it('pure dirs use no forbidden APIs', () => {
    const violations: string[] = [];
    for (const f of textFiles.filter(isPure)) {
      const src = read(f);
      for (const [name, re] of FORBIDDEN_APIS) {
        if (re.test(src)) violations.push(`${f}: ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('src/engine imports only from src/engine and src/content/services.json', () => {
    const violations: string[] = [];
    const engineSources = textFiles.filter(
      (f) => f.startsWith('src/engine/') && f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    for (const f of engineSources) {
      for (const spec of importSpecifiers(read(f))) {
        if (!engineImportAllowed(f, spec)) violations.push(`${f}: ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no unfinished-work tokens in code dirs', () => {
    const violations = textFiles
      .filter((f) => UNFINISHED_SCAN_DIRS.some((d) => f.startsWith(d)))
      .filter((f) => !UNFINISHED_SCAN_EXCLUDES.some((d) => f.startsWith(d)))
      .filter((f) => UNFINISHED_PATTERN.test(read(f)));
    expect(violations).toEqual([]);
  });

  it('has no third-party video game trademark names anywhere', () => {
    const violations = textFiles.filter((f) => BANNED_NAME_PATTERN.test(read(f)) || BANNED_NAME_PATTERN.test(f));
    expect(violations).toEqual([]);
  });

  it('has no image or font asset files under src/', () => {
    const assets = allFiles.filter(
      (f) => f.startsWith('src/') && ASSET_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)),
    );
    expect(assets).toEqual([]);
  });
});
