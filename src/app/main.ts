/**
 * Browser entry point. Awaits `loadConfig()` (≤ 2 s) so the cabinet's online flag is fixed before it is
 * created (overview §6), then wires the canvas renderer, WebAudio, localStorage, the remote leaderboard,
 * the keyboard, page visibility, integer scaling and the fixed-timestep loop to the cabinet app.
 * QA hooks attach only with `?qa=1`.
 */
import '../styles.css';
import { createSfx } from '../audio/sfx';
import type { AudioContextLike } from '../audio/sfx';
import { createLocalStore } from '../leaderboard/localStore';
import type { KV } from '../leaderboard/localStore';
import { createRemoteClient } from '../leaderboard/remoteClient';
import { applyLayout, pulseCrt, screenLayout } from '../render/crt';
import { createRenderer } from '../render/renderer';
import type { Surface } from '../render/gfx';
import { canvasLabel, createAnnouncer, screenAnnouncement } from './a11y';
import { createCabinetApp } from './app';
import { loadConfig } from './config';
import { createLoop } from './loop';
import { createQaApi, parseQaParams } from './qa';
import type { QaApi } from './qa';

declare global {
  interface Window {
    __KIROMAN_QA__?: QaApi;
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Keys whose browser default (scrolling, find-as-you-type) must never fire while the cabinet has focus. */
const ALWAYS_PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);

function fail(canvas: HTMLCanvasElement | null, message: string): void {
  console.error(message);
  const p = document.createElement('p');
  p.className = 'fatal';
  p.textContent = message;
  if (canvas !== null) canvas.replaceWith(p);
  else document.body.append(p);
}

function safeStorage(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function randomSeed(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) >>> 0;
}

function makeSurface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('offscreen 2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function audioFactory(): AudioContextLike | null {
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  return Ctor === undefined ? null : (new Ctor() as unknown as AudioContextLike);
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const ctx = canvas?.getContext('2d') ?? null;
  if (canvas === null || ctx === null) {
    fail(canvas, 'Canvas not supported');
    return;
  }
  const crt = document.getElementById('crt');
  const live = document.getElementById('live');
  const qa = parseQaParams(window.location.search);
  const doFetch: typeof fetch = (input, init) => window.fetch(input, init);

  const config = await loadConfig({ fetch: doFetch });
  const online = config.apiUrl !== null;
  const remote = config.apiUrl === null ? null : createRemoteClient({ apiUrl: config.apiUrl, fetch: doFetch });
  const store = createLocalStore(safeStorage(), (m) => console.warn(m));
  const sfx = createSfx(audioFactory);
  const renderer = createRenderer(ctx, makeSurface);
  const announcer = createAnnouncer(live);

  const app = createCabinetApp({
    online,
    store,
    remote,
    sfx,
    seed: () => qa.seed ?? randomSeed(),
    hooks: {
      gameEvents: (game, events) => renderer.onGameEvents(game, events),
      newGame: () => renderer.resetGame(),
      screenChanged: (cab) => {
        pulseCrt(crt);
        canvas.setAttribute('aria-label', canvasLabel(cab));
      },
      announce: (text) => announcer.announce(text),
      toast: (text, uiTick) => renderer.toast(text, uiTick),
    },
  });

  const relayout = (): void => applyLayout(canvas, crt, screenLayout(window.innerWidth, window.innerHeight));
  relayout();
  window.addEventListener('resize', relayout);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const handled = app.keyDown(e.key, e.repeat);
    if (handled || ALWAYS_PREVENT.has(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => app.keyUp(e.key));
  window.addEventListener('blur', () => app.blur());
  document.addEventListener('visibilitychange', () => app.setHidden(document.visibilityState === 'hidden'));

  if (qa.enabled) {
    window.__KIROMAN_QA__ = createQaApi(app.qaHost);
    console.info('qa: hooks attached; this session will not submit scores remotely if any mutator is used');
  }

  const first = app.view().cabinet;
  canvas.setAttribute('aria-label', canvasLabel(first));
  announcer.announce(screenAnnouncement(first));

  const loop = createLoop({
    now: () => performance.now(),
    raf: (cb) => window.requestAnimationFrame(cb),
    onStep: () => app.step(),
    onRender: () => renderer.draw(app.view()),
  });
  loop.start();
}

boot().catch((e: unknown) => {
  console.error('KIRO-MAN failed to boot', e);
});
