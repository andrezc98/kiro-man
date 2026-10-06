#!/usr/bin/env node
/**
 * Headless verification (overview §9.7, arcade-presentation AP-8). Run with `npm run verify:browser`
 * (which builds first). Steps:
 *   1. spawn `vite preview` on port 4173 and poll it for up to 20 s;
 *   2. open `/?qa=1&seed=3735928559` in headless Chromium at 960x720 (scale 3);
 *   3. capture docs/screenshots/01-attract .. 08-highscores with a pinned arrow script and QA hooks;
 *   4. check that the coin SFX really reaches the audio destination (a tap before `destination`
 *      measures the signal level after the C key press);
 *   5. export the local scores for the arcade-operator MCP server, then play a second, untainted game
 *      (no QA mutators) to its natural end and export its `getLastSubmission()` as the replay sample.
 * Waits are counted in requestAnimationFrame frames, never wall-clock sleeps. Any console.error, page
 * error, missing canvas or failed step exits 1 and names the step. The preview server is always killed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'docs', 'screenshots');
const MCP_DATA = join(ROOT, 'mcp', 'arcade-operator', 'data');
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const SEED = 3735928559;
const URL_PATH = `/?qa=1&seed=${SEED}`;
const STORAGE_KEY = 'kiroman.highscores.v1';

/** Pinned arrow script: [key, frames held]. About 3 s of play after the 2 s READY banner. */
export const ARROW_SCRIPT = [
  ['ArrowLeft', 150],
  ['ArrowUp', 40],
  ['ArrowLeft', 30],
  ['ArrowDown', 40],
  ['ArrowRight', 50],
];
/** Fallback when the score is still 0 before game over: R, D, L, U for 30 frames each, up to 10 s. */
const FALLBACK_CYCLE = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
const FALLBACK_LIMIT_FRAMES = 600;
/** Upper bound for the natural (untainted) replay-sample game: 4 minutes of frames. */
const SAMPLE_GAME_LIMIT_FRAMES = 14_400;
/** RMS level the coin SFX must reach at the destination tap (a 0.18-gain square wave is about 0.15). */
const MIN_COIN_RMS = 0.02;

class StepError extends Error {}

let currentStep = 'startup';
const problems = [];

function log(message) {
  process.stdout.write(`screenshots: ${message}\n`);
}

function step(name) {
  currentStep = name;
  log(name);
}

function assertClean() {
  if (problems.length > 0) throw new StepError(problems.join('\n'));
}

function startPreview() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return { child, output: () => output };
}

function killPreview(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGKILL');
  }
}

async function waitForServer(preview) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (preview.child.exitCode !== null) throw new StepError(`vite preview exited early:\n${preview.output()}`);
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new StepError(`vite preview did not answer on ${BASE} within 20 s:\n${preview.output()}`);
}

/** Wraps AudioContext before the app loads: everything connected to `destination` passes a measuring tap. */
function audioTapInitScript() {
  const Orig = window.AudioContext;
  const probe = { contexts: 0, oscillatorStarts: 0, peakRms: 0, state: null, masterGain: null };
  window.__KIROMAN_AUDIO_PROBE__ = probe;
  if (Orig === undefined) return;
  window.AudioContext = class extends Orig {
    #tap;
    constructor(...args) {
      super(...args);
      probe.contexts++;
      const tap = Orig.prototype.createGain.call(this);
      const analyser = Orig.prototype.createAnalyser.call(this);
      analyser.fftSize = 1024;
      tap.connect(analyser);
      tap.connect(super.destination);
      this.#tap = tap;
      const buf = new Float32Array(analyser.fftSize);
      const sample = () => {
        probe.state = this.state;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        probe.peakRms = Math.max(probe.peakRms, Math.sqrt(sum / buf.length));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }
    get destination() {
      return this.#tap;
    }
    createGain() {
      const g = super.createGain();
      if (probe.masterGain === null) probe.masterGain = g; // the first gain the app makes is its master
      return g;
    }
    createOscillator() {
      const o = super.createOscillator();
      const start = o.start.bind(o);
      o.start = (...a) => {
        probe.oscillatorStarts++;
        start(...a);
      };
      return o;
    }
  };
}

async function frames(page, n) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let i = 0;
        const tick = () => {
          i++;
          if (i >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

const qa = (page, expr) => page.evaluate(expr);

async function waitForScreen(page, screen, maxFrames = 600) {
  for (let i = 0; i < maxFrames; i++) {
    if ((await qa(page, () => window.__KIROMAN_QA__.getScreen())) === screen) return;
    await frames(page, 1);
  }
  const actual = await qa(page, () => window.__KIROMAN_QA__.getScreen());
  throw new StepError(`expected screen "${screen}" within ${maxFrames} frames, got "${actual}"`);
}

async function shot(page, file) {
  assertClean();
  const path = join(SHOTS, file);
  await page.locator('#cabinet').screenshot({ path });
  log(`  wrote ${relative(ROOT, path)}`);
}

async function hold(page, key, n) {
  await page.keyboard.down(key);
  await frames(page, n);
  await page.keyboard.up(key);
}

async function press(page, key) {
  await page.keyboard.press(key);
  await frames(page, 2);
}

async function mutate(page, name, fn, arg) {
  const ok = await page.evaluate(fn, arg);
  if (ok !== true) throw new StepError(`QA ${name} returned ${String(ok)} (cabinet not playing?)`);
}

/** Same rules as src/leaderboard/ranking.ts `normalize`: valid entries, score descending (stable), top 10. */
function normalizeScores(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.initials === 'string' &&
        /^[A-Z]{3}$/.test(e.initials) &&
        Number.isInteger(e.score) &&
        e.score >= 0 &&
        Number.isInteger(e.level) &&
        e.level >= 1,
    )
    .map((e) => ({ initials: e.initials, score: e.score, level: e.level }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function run(page) {
  step('open the cabinet');
  await page.goto(`${BASE}${URL_PATH}`);
  if ((await page.locator('canvas#game').count()) !== 1) throw new StepError('canvas#game is missing');
  await page.waitForFunction(() => window.__KIROMAN_QA__ !== undefined, null, { timeout: 10_000 });
  await frames(page, 60);
  if ((await qa(page, () => window.__KIROMAN_QA__.getScreen())) !== 'attract') {
    throw new StepError('the cabinet did not boot to the attract screen');
  }
  await shot(page, '01-attract.png');

  step('insert a coin (C)');
  await press(page, 'c');
  await frames(page, 30);
  await shot(page, '02-credit.png');

  step('check the coin sound reaches the audio destination');
  const audio = await qa(page, () => {
    const p = window.__KIROMAN_AUDIO_PROBE__;
    return {
      contexts: p.contexts,
      oscillatorStarts: p.oscillatorStarts,
      peakRms: p.peakRms,
      state: p.state,
      masterGain: p.masterGain === null ? null : p.masterGain.gain.value,
    };
  });
  log(
    `  audio: ${audio.contexts} context, state ${audio.state}, master gain ${audio.masterGain}, ` +
      `${audio.oscillatorStarts} oscillators, peak RMS ${audio.peakRms.toFixed(3)}`,
  );
  if (audio.contexts !== 1) throw new StepError(`expected 1 AudioContext after the coin key, got ${audio.contexts}`);
  if (audio.state !== 'running') throw new StepError(`AudioContext state is ${audio.state}, not running`);
  if (!(audio.masterGain > 0)) throw new StepError(`master gain is ${audio.masterGain}`);
  if (audio.oscillatorStarts < 2) throw new StepError('the coin SFX did not start its oscillators');
  if (!(audio.peakRms >= MIN_COIN_RMS)) {
    throw new StepError(`coin SFX peak RMS ${audio.peakRms} at the destination is below ${MIN_COIN_RMS}`);
  }

  step('start the game (Enter)');
  await press(page, 'Enter');
  await waitForScreen(page, 'playing', 30);
  await frames(page, 20);
  await shot(page, '03-ready.png');

  step('play the pinned arrow script');
  for (const [key, n] of ARROW_SCRIPT) await hold(page, key, n);
  await shot(page, '04-gameplay.png');

  step('grant CloudWatch, release enemies, invulnerable 600');
  await mutate(page, 'grantPowerUp', () => window.__KIROMAN_QA__.grantPowerUp('cloudwatch'));
  await mutate(page, 'releaseEnemies', () => window.__KIROMAN_QA__.releaseEnemies());
  await mutate(page, 'setInvulnerable', () => window.__KIROMAN_QA__.setInvulnerable(600));
  await frames(page, 120);
  await shot(page, '05-cloudwatch.png');

  step('make sure the score is above 0');
  let held = 0;
  for (let i = 0; (await qa(page, () => window.__KIROMAN_QA__.getScore())) <= 0; i++) {
    if (held >= FALLBACK_LIMIT_FRAMES) throw new StepError('score is still 0 after 10 s of fallback arrows');
    await hold(page, FALLBACK_CYCLE[i % FALLBACK_CYCLE.length], 30);
    held += 30;
  }
  const score = await qa(page, () => window.__KIROMAN_QA__.getScore());
  log(`  score ${score}`);

  step('force game over');
  await mutate(page, 'forceGameOver', () => window.__KIROMAN_QA__.forceGameOver());
  await waitForScreen(page, 'incident');
  await frames(page, 5);
  await shot(page, '06-incident-report.png');

  step('leave the Incident Report (70 frames, then Enter)');
  await frames(page, 70);
  await press(page, 'Enter');
  await waitForScreen(page, 'initials', 60);
  for (const k of ['k', 'i', 'r']) await press(page, k);
  await frames(page, 10);
  await shot(page, '07-initials.png');

  step('confirm initials (Enter)');
  await press(page, 'Enter');
  await waitForScreen(page, 'highscores', 60);
  await frames(page, 30);
  await shot(page, '08-highscores.png');

  step('export MCP sample data');
  const exported = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return { raw, submission: window.__KIROMAN_QA__.getLastSubmission() };
  }, STORAGE_KEY);
  if (exported.raw === null) throw new StepError(`localStorage has no ${STORAGE_KEY}`);
  const scores = normalizeScores(JSON.parse(exported.raw));
  if (!scores.some((e) => e.initials === 'KIR' && e.score === score)) {
    throw new StepError(`local scores do not contain KIR ${score}: ${exported.raw}`);
  }
  if (exported.submission === null || exported.submission.claimedScore !== score) {
    throw new StepError(`getLastSubmission() is ${JSON.stringify(exported.submission)}`);
  }
  mkdirSync(MCP_DATA, { recursive: true });
  writeFileSync(join(MCP_DATA, 'local-scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
  log(`  wrote ${relative(ROOT, MCP_DATA)}/local-scores.json`);

  // The screenshot game used QA mutators, which are not in its input log, so it can never replay to its
  // own score. The replay sample comes from a second, untainted game that ends naturally.
  step('play an untainted game for the MCP replay sample');
  await press(page, 'Enter');
  await waitForScreen(page, 'attract', 60);
  await press(page, 'c');
  await press(page, 'Enter');
  await waitForScreen(page, 'playing', 30);
  await frames(page, 120);
  for (const [key, n] of ARROW_SCRIPT) await hold(page, key, n);
  for (let waited = 0; (await qa(page, () => window.__KIROMAN_QA__.getScreen())) === 'playing'; waited += 30) {
    if (waited >= SAMPLE_GAME_LIMIT_FRAMES) throw new StepError('the untainted game did not end within 4 minutes');
    await frames(page, 30);
  }
  await waitForScreen(page, 'incident', 30);
  const sample = await qa(page, () => window.__KIROMAN_QA__.getLastSubmission());
  if (sample === null || !(sample.claimedScore > 0) || sample.seed !== SEED) {
    throw new StepError(`unexpected replay sample ${JSON.stringify(sample)}`);
  }
  writeFileSync(join(MCP_DATA, 'sample-replay.json'), `${JSON.stringify(sample)}\n`);
  log(`  wrote ${relative(ROOT, MCP_DATA)}/sample-replay.json (score ${sample.claimedScore}, ${sample.inputLog.length} events)`);
  assertClean();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const preview = startPreview();
  let browser;
  try {
    step('start vite preview');
    await waitForServer(preview);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console.error during "${currentStep}": ${msg.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error during "${currentStep}": ${e.message}`));
    await page.addInitScript(audioTapInitScript);
    await run(page);
    log('all eight screenshots captured');
  } finally {
    if (browser !== undefined) await browser.close().catch(() => undefined);
    killPreview(preview.child);
  }
}

main().catch((e) => {
  process.stderr.write(`screenshots: FAILED at step "${currentStep}": ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
