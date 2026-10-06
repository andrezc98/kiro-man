import { describe, expect, it } from 'vitest';
import { initialCabinet } from '../arcade/cabinet';
import type { CabinetState, GameSummary, RemoteStatus } from '../arcade/cabinet';
import { initialInitials } from '../arcade/initials';
import { CATALOG_ORDER, DYING_TICKS, applyPowerUp, createGame, forceGameOver, step } from '../engine';
import type { GameState } from '../engine';
import { fakeCtx, fakeSurfaces } from '../test-support/canvas';
import { startPlaying, stepN } from '../test-support/engine';
import { activePowerUps, timerBarWidth } from './hud';
import { PALETTE } from './palette';
import { SHUTTER_TICKS, createRenderer, shutterHeight } from './renderer';
import { coinPromptVisible } from './screens/attract';
import { globalPanelNote, remoteStatusLine } from './screens/highscores';
import { FACT_LINE_CHARS, incidentNumber, sourceHost, wrapText } from './screens/incident';
import { secondsLeft } from './screens/initials';
import { moverPixel } from './screens/playing';
import { highScore, scoreText } from './view';
import type { GlobalBoard, RenderView } from './view';

const LOCAL = [
  { initials: 'KIR', score: 12340, level: 3 },
  { initials: 'AWS', score: 900, level: 1 },
];

function summary(over: Partial<GameSummary> = {}): GameSummary {
  return {
    seed: 0xdeadbeef,
    score: 4210,
    level: 2,
    bugsEaten: 321,
    servicesUsed: { lambda: 2, shield: 1, autoscaling: 0, cloudfront: 3, cloudwatch: 1 },
    lastKiller: 'coldstart',
    gameOverReason: 'caught',
    inputLog: [[3, 2]],
    tainted: false,
    ...over,
  };
}

function cab(over: Partial<CabinetState>): CabinetState {
  return { ...initialCabinet(true), screenTicks: 200, uiTick: 1234, ...over };
}

function view(c: CabinetState, game: GameState | null = null, over: Partial<RenderView> = {}): RenderView {
  const global: GlobalBoard = { status: 'ok', list: LOCAL };
  return { cabinet: c, game, local: LOCAL, global, paused: false, muted: false, fatal: null, ...over };
}

/** A game with Outage released, every power-up active, the clone out and a pickup on the field. */
function busyGame(): GameState {
  const g = startPlaying(42);
  for (const e of g.enemies) e.releaseIn = 0;
  for (const k of CATALOG_ORDER) applyPowerUp(g, k);
  g.player.invuln = 10000;
  stepN(g, 40, 4);
  g.pickup = { kind: 'shield', at: { x: g.maze.slots[0]!.x, y: g.maze.slots[0]!.y }, ttl: 100 };
  return g;
}

function views(): RenderView[] {
  const out: RenderView[] = [];
  for (const credits of [0, 1, 12]) {
    for (const t of [0, 5, 40, 200]) out.push(view(cab({ screen: 'attract', credits, screenTicks: t, uiTick: t })));
  }
  out.push(view(cab({ screen: 'attract', insertCoinFlash: 33 })));
  for (const status of ['ok', 'loading', 'offline', 'disabled'] as const) {
    out.push(view(cab({ screen: 'attract', attractPanel: 'scores' }), null, { global: { status, list: status === 'ok' ? LOCAL : [] } }));
  }
  const ready = createGame(7);
  out.push(view(cab({ screen: 'playing', screenTicks: 2 }), ready));
  const busy = busyGame();
  for (const t of [0, 3, 8, 13]) {
    const g = structuredClone(busy);
    stepN(g, t, 2);
    out.push(view(cab({ screen: 'playing' }), g));
  }
  out.push(view(cab({ screen: 'playing' }), busy, { paused: true }));
  const dying = structuredClone(busy);
  dying.phase = 'dying';
  for (const left of [DYING_TICKS, 80, 60, 40, 10, 1]) out.push(view(cab({ screen: 'playing' }), { ...dying, phaseTimer: left }));
  out.push(view(cab({ screen: 'playing' }), { ...busy, phase: 'levelClear', phaseTimer: 100 }));
  out.push(view(cab({ screen: 'playing' }), { ...busy, phase: 'levelClear', phaseTimer: 10 }));
  const over = structuredClone(busy);
  forceGameOver(over);
  out.push(view(cab({ screen: 'playing' }), over));
  const sums = [
    summary(),
    summary({ lastKiller: null, gameOverReason: 'timeLimit' }),
    summary({ lastKiller: null, gameOverReason: 'qa', servicesUsed: { lambda: 0, shield: 0, autoscaling: 0, cloudfront: 0, cloudwatch: 0 } }),
  ];
  for (const s of sums) {
    for (const t of [0, 30, 90]) out.push(view(cab({ screen: 'incident', summary: s, screenTicks: t, localQualifies: t > 50 })));
  }
  out.push(view(cab({ screen: 'incident', summary: null })));
  for (const cursor of [0, 1, 2] as const) {
    out.push(view(cab({ screen: 'initials', summary: summary(), initials: { ...initialInitials(), letters: [10, 8, 17], cursor, idle: 1700 } })));
  }
  const statuses: RemoteStatus[] = ['idle', 'submitting', 'verified', 'rejected', 'offline'];
  for (const remoteStatus of statuses) {
    out.push(view(cab({ screen: 'highscores', remoteStatus, remoteDetail: remoteStatus === 'rejected' ? 'REPLAY_MISMATCH' : null, highlightRank: 1 })));
  }
  out.push(view(cab({}), null, { fatal: 'MAZE ERROR' }));
  return out;
}

describe('renderer', () => {
  it('draws every screen and state with palette colors, integer coordinates and known glyphs only', () => {
    const rec = fakeCtx();
    const missing = new Set<string>();
    const r = createRenderer(rec.ctx, fakeSurfaces(rec), { onMissingGlyph: (ch) => missing.add(ch) });
    const all = views();
    for (const v of all) {
      if (v.game !== null) r.onGameEvents(v.game, v.game.events);
      r.draw(v);
    }
    r.toast('SOUND OFF', 1234);
    r.draw(all[0]!);
    expect([...missing]).toEqual([]);
    expect(rec.nonIntegerCoords).toBe(0);
    for (const s of rec.styles) expect(PALETTE).toContain(s);
    expect(rec.blits).toBeGreaterThan(1000);
  });

  it('turns engine events into render-only effects without touching the game', () => {
    const rec = fakeCtx();
    const r = createRenderer(rec.ctx, fakeSurfaces(rec));
    const g = startPlaying(3);
    const before = JSON.stringify(g);
    r.onGameEvents(g, [
      { type: 'powerUpSpawn', kind: 'lambda', at: { x: 1, y: 1 } },
      { type: 'powerUpPickup', kind: 'autoscaling' },
      { type: 'shieldBlock', enemy: 'latency' },
      { type: 'cloneSpawn', at: { x: 2, y: 1 } },
      { type: 'warp', from: 0, to: 1 },
      { type: 'levelClear', level: 1, bonus: 500 },
      { type: 'death', enemy: 'outage' },
    ]);
    r.draw(view(cab({ screen: 'playing' }), g));
    r.resetGame();
    r.draw(view(cab({ screen: 'playing' }), g));
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('render helpers', () => {
  it('interpolates movers from tile + progress and floors to whole pixels', () => {
    expect(moverPixel({ tile: { x: 3, y: 4 }, dir: 0, progress: 0 })).toEqual({ x: 24, y: 48 });
    expect(moverPixel({ tile: { x: 3, y: 4 }, dir: 2, progress: 128 })).toEqual({ x: 28, y: 48 });
    expect(moverPixel({ tile: { x: 3, y: 4 }, dir: 4, progress: 33 })).toEqual({ x: 22, y: 48 });
    expect(moverPixel({ tile: { x: 3, y: 4 }, dir: 1, progress: 255 })).toEqual({ x: 24, y: 40 });
  });

  it('wraps facts to 36 characters, hard-splitting long words', () => {
    expect(wrapText('A B C', 3)).toEqual(['A B', 'C']);
    expect(wrapText('ABCDEFGH XY', 3)).toEqual(['ABC', 'DEF', 'GH', 'XY']);
    expect(wrapText('  spaced   out  ', 20)).toEqual(['spaced out']);
    expect(wrapText('', 10)).toEqual([]);
    expect(() => wrapText('x', 0)).toThrow(RangeError);
    const text = 'CLOUDFRONT SERVES CONTENT FROM A GLOBAL NETWORK OF EDGE LOCATIONS CLOSE TO YOUR VIEWERS.';
    const lines = wrapText(text);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(FACT_LINE_CHARS);
    expect(lines.join(' ')).toBe(text);
  });

  it('formats incident numbers, sources and scores', () => {
    expect(incidentNumber(0xdeadbeef)).toBe('DEADBEEF');
    expect(incidentNumber(255)).toBe('000000FF');
    expect(sourceHost('https://docs.aws.amazon.com/lambda/x.html')).toBe('DOCS.AWS.AMAZON.COM');
    expect(sourceHost('not a url')).toBe('AWS DOCUMENTATION');
    expect(scoreText(42)).toBe('000042');
    expect(scoreText(12345678)).toBe('12345678');
    expect(highScore(LOCAL, 50)).toBe(12340);
    expect(highScore([], 50)).toBe(50);
  });

  it('timer bars shrink with the remaining time', () => {
    expect(timerBarWidth(360, 360)).toBe(16);
    expect(timerBarWidth(180, 360)).toBe(8);
    expect(timerBarWidth(1, 360)).toBe(1);
    expect(timerBarWidth(0, 360)).toBe(0);
    const g = startPlaying(1);
    applyPowerUp(g, 'cloudwatch');
    applyPowerUp(g, 'lambda');
    expect(activePowerUps(g).map((p) => p.kind)).toEqual(['lambda', 'cloudwatch']);
    step(g, 0);
    expect(activePowerUps(g)[0]!.remaining).toBe(359);
  });

  it('INSERT COIN blinks at a 30-tick period and flashes every 4 ticks after a failed start', () => {
    const lit = Array.from({ length: 30 }, (_, t) => coinPromptVisible({ uiTick: t, insertCoinFlash: 0 }));
    expect(lit.filter(Boolean)).toHaveLength(15);
    expect(lit.slice(0, 15).every(Boolean)).toBe(true);
    const flash = Array.from({ length: 60 }, (_, i) => coinPromptVisible({ uiTick: 0, insertCoinFlash: 60 - i }));
    // Toggles every 4 ticks regardless of the slow blink phase.
    expect(flash.slice(1, 5).every(Boolean)).toBe(true);
    expect(flash.slice(5, 9).some(Boolean)).toBe(false);
    expect(flash.slice(9, 13).every(Boolean)).toBe(true);
  });

  it('remote status lines and global panel notes', () => {
    expect(remoteStatusLine('verified', null).text).toBe('GLOBAL: VERIFIED BY REPLAY');
    expect(remoteStatusLine('rejected', 'LOG TOO LONG').text).toBe('GLOBAL: REJECTED (LOG TOO LONG)');
    expect(remoteStatusLine('offline', null).text).toBe('GLOBAL: OFFLINE');
    expect(remoteStatusLine('submitting', null).text).toContain('SUBMITTING');
    expect(globalPanelNote({ status: 'disabled', list: [] })).toBe('OFFLINE');
    expect(globalPanelNote({ status: 'offline', list: [] })).toBe('OFFLINE');
    expect(globalPanelNote({ status: 'loading', list: [] })).toBe('CONNECTING...');
    expect(globalPanelNote({ status: 'ok', list: [] })).toBeNull();
  });

  it('shutter closes over the first ticks of a screen; initials countdown in seconds', () => {
    expect(shutterHeight(0)).toBe(120);
    expect(shutterHeight(SHUTTER_TICKS)).toBe(0);
    expect(shutterHeight(5)).toBe(60);
    expect(secondsLeft(0)).toBe(30);
    expect(secondsLeft(1799)).toBe(1);
    expect(secondsLeft(1800)).toBe(0);
  });
});
