/**
 * Second half of `npm run build`: copies the esbuild bundle into the packaged power so the power's MCP
 * server works outside this repo (overview §9.6). The copy is committed.
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgDir, '..', '..');
const from = join(pkgDir, 'dist', 'index.js');
const to = join(repoRoot, 'retro-arcade-power', 'server', 'arcade-operator.mjs');

try {
  statSync(from);
} catch {
  console.error(`copy-to-power: ${relative(repoRoot, from)} does not exist; run the esbuild step first`);
  process.exit(1);
}
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`copy-to-power: ${relative(repoRoot, from)} -> ${relative(repoRoot, to)} (${statSync(to).size} bytes)`);
