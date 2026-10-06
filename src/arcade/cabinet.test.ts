import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { usesOnlyFontGlyphs } from '../content/glyphs';
import type { InputLog } from '../engine';
import {
  DEFAULT_INITIALS,
  ENEMY_NAMES,
  MAX_SUBMIT_LOG_EVENTS,
  TIMINGS,
  initialCabinet,
  reduce,
  rootCause,
} from './cabinet';
import type { CabinetEvent, CabinetState, Effect, GameSummary, Screen } from './cabinet';

function summary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    seed: 0xdeadbeef,
    score: 1230,
    level: 2,
    bugsEaten: 100,
    servicesUsed: { lambda: 1, shield: 0, autoscaling: 2, cloudfront: 0, cloudwatch: 0 },
    lastKiller: 'throttle',
    gameOverReason: 'caught',
    inputLog: [
      [120, 2],
      [300, 3],
    ],
    tainted: false,
    ...overrides,
  };
}

/** Folds events through `reduce`, collecting every effect. */
function run(s: CabinetState, events: CabinetEvent[]): { state: CabinetState; effects: Effect[] } {
  const effects: Effect[] = [];
  let state = s;
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

const ticks = (n: number): CabinetEvent[] => Array.from({ length: n }, () => ({ type: 'uiTick' }) as const);

/** Cabinet on `playing` with `credits` left. */
function playing(online = true, credits = 0): CabinetState {
  const coins = Array.from({ length: credits + 1 }, () => ({ type: 'coin' }) as const);
  return run(initialCabinet(online), [...coins, { type: 'start', seed: 42 }]).state;
}

/** Cabinet on `incident` past the Enter lockout. */
function incident(sum: GameSummary, qualifies: boolean, online = true): CabinetState {
  return run(playing(online), [{ type: 'gameOver', summary: sum, qualifies }, ...ticks(TIMINGS.incidentLockoutTicks)]).state;
}

function initialsScreen(sum: GameSummary = summary(), online = true): CabinetState {
  return reduce(incident(sum, true, online), { type: 'confirm' }).state;
}

const submits = (effects: Effect[]) => effects.filter((e) => e.type === 'submitRemote');

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('initialCabinet', () => {
  it('starts on attract with 0 credits; online decides the initial remote status', () => {
    const s = initialCabinet(true);
    expect(s).toMatchObject({ screen: 'attract', credits: 0, attractPanel: 'title', online: true, remoteStatus: 'idle' });
    expect(initialCabinet(false)).toMatchObject({ online: false, remoteStatus: 'offline' });
  });
});

describe('coins', () => {
  it('a coin works on every screen, including playing and initials, with the coin sfx', () => {
    const screens: Array<[Screen, CabinetState]> = [
      ['attract', initialCabinet(true)],
      ['playing', playing()],
      ['incident', incident(summary(), true)],
      ['initials', initialsScreen()],
      ['highscores', reduce(incident(summary(), false), { type: 'confirm' }).state],
    ];
    for (const [screen, s] of screens) {
      expect(s.screen).toBe(screen);
      const r = reduce(s, { type: 'coin' });
      expect(r.state.credits).toBe(s.credits + 1);
      expect(r.state.screen).toBe(screen);
      expect(r.effects).toEqual([{ type: 'sfx', name: 'coin' }]);
    }
  });

  it('a coin at 99 is rejected with the denied sfx', () => {
    const s = run(initialCabinet(true), Array.from({ length: 99 }, () => ({ type: 'coin' }) as const)).state;
    expect(s.credits).toBe(99);
    const r = reduce(s, { type: 'coin' });
    expect(r.state.credits).toBe(99);
    expect(r.effects).toEqual([{ type: 'sfx', name: 'denied' }]);
  });
});

describe('start', () => {
  it('with credits: subtracts one, plays start, emits startEngine with the given seed, shows playing', () => {
    const s = run(initialCabinet(true), [{ type: 'coin' }, { type: 'coin' }]).state;
    const r = reduce(s, { type: 'start', seed: 0xabc });
    expect(r.state.credits).toBe(1);
    expect(r.state.screen).toBe('playing');
    expect(r.state.screenTicks).toBe(0);
    expect(r.effects).toEqual([
      { type: 'sfx', name: 'start' },
      { type: 'startEngine', seed: 0xabc },
    ]);
  });

  it('with 0 credits: no game, credits unchanged, only the denied sfx, and the fast flash for 60 ticks', () => {
    const r = reduce(initialCabinet(true), { type: 'start', seed: 1 });
    expect(r.state.screen).toBe('attract');
    expect(r.state.credits).toBe(0);
    expect(r.effects).toEqual([{ type: 'sfx', name: 'denied' }]);
    expect(r.state.insertCoinFlash).toBe(60);
    expect(run(r.state, ticks(59)).state.insertCoinFlash).toBe(1);
    expect(run(r.state, ticks(60)).state.insertCoinFlash).toBe(0);
    expect(run(r.state, ticks(61)).state.insertCoinFlash).toBe(0);
  });

  it('Enter (start or confirm) is ignored while playing', () => {
    const s = playing(true, 3);
    expect(reduce(s, { type: 'start', seed: 9 })).toEqual({ state: s, effects: [] });
    expect(reduce(s, { type: 'confirm' })).toEqual({ state: s, effects: [] });
  });

  it('start is ignored on incident, initials and highscores', () => {
    for (const s of [incident(summary(), true), initialsScreen(), reduce(incident(summary(), false), { type: 'confirm' }).state]) {
      const withCredit = reduce(s, { type: 'coin' }).state;
      expect(reduce(withCredit, { type: 'start', seed: 1 })).toEqual({ state: withCredit, effects: [] });
    }
  });
});

describe('attract', () => {
  it('alternates title and score panels every 480 UI ticks', () => {
    const s = initialCabinet(true);
    expect(run(s, ticks(479)).state.attractPanel).toBe('title');
    expect(run(s, ticks(480)).state.attractPanel).toBe('scores');
    expect(run(s, ticks(959)).state.attractPanel).toBe('scores');
    expect(run(s, ticks(960)).state.attractPanel).toBe('title');
  });

  it('counts uiTick globally and per screen', () => {
    const s = run(initialCabinet(true), ticks(5)).state;
    expect(s.uiTick).toBe(5);
    expect(s.screenTicks).toBe(5);
    const p = run(s, [{ type: 'coin' }, { type: 'start', seed: 1 }, ...ticks(2)]).state;
    expect(p.uiTick).toBe(7);
    expect(p.screenTicks).toBe(2);
  });
});

describe('game over and the Incident Report', () => {
  it('gameOver while playing shows the incident screen with the summary', () => {
    const sum = summary();
    const r = reduce(playing(), { type: 'gameOver', summary: sum, qualifies: true });
    expect(r.state.screen).toBe('incident');
    expect(r.state.summary).toEqual(sum);
    expect(r.state.localQualifies).toBe(true);
    expect(r.effects).toEqual([]);
  });

  it('a second gameOver while already on incident is ignored', () => {
    const s = reduce(playing(), { type: 'gameOver', summary: summary(), qualifies: true }).state;
    const again = reduce(s, { type: 'gameOver', summary: summary({ score: 5 }), qualifies: false });
    expect(again).toEqual({ state: s, effects: [] });
  });

  it('gameOver outside playing is ignored', () => {
    const s = initialCabinet(true);
    expect(reduce(s, { type: 'gameOver', summary: summary(), qualifies: true })).toEqual({ state: s, effects: [] });
  });

  it('confirm during the 60-tick lockout is ignored, and accepted at 60', () => {
    const s = reduce(playing(), { type: 'gameOver', summary: summary(), qualifies: true }).state;
    const at59 = run(s, ticks(59)).state;
    expect(reduce(at59, { type: 'confirm' })).toEqual({ state: at59, effects: [] });
    const at60 = reduce(at59, { type: 'uiTick' }).state;
    expect(reduce(at60, { type: 'confirm' }).state.screen).toBe('initials');
  });

  it('a qualifying score goes to initials entry starting at AAA', () => {
    const s = initialsScreen();
    expect(s.screen).toBe('initials');
    expect(s.initials).toMatchObject({ letters: [0, 0, 0], cursor: 0, done: false });
  });
});

describe('root cause', () => {
  it('names the enemy that caught Kiro', () => {
    expect(rootCause({ lastKiller: 'latency', gameOverReason: 'caught' })).toBe('LATENCY CAUGHT KIRO');
    expect(rootCause({ lastKiller: 'throttle', gameOverReason: 'caught' })).toBe('THROTTLE CAUGHT KIRO');
    expect(rootCause({ lastKiller: 'coldstart', gameOverReason: 'caught' })).toBe('COLD START CAUGHT KIRO');
    expect(rootCause({ lastKiller: 'outage', gameOverReason: 'caught' })).toBe('OUTAGE CAUGHT KIRO');
  });

  it('time limit and QA texts', () => {
    expect(rootCause({ lastKiller: null, gameOverReason: 'timeLimit' })).toBe('SHIFT ENDED (30:00)');
    expect(rootCause({ lastKiller: null, gameOverReason: 'qa' })).toBe('MANUAL FAILOVER');
  });

  it('every root-cause text is drawable with the pixel font', () => {
    const texts = [
      ...Object.keys(ENEMY_NAMES).map((k) => rootCause({ lastKiller: k as keyof typeof ENEMY_NAMES, gameOverReason: 'caught' })),
      rootCause({ lastKiller: null, gameOverReason: 'timeLimit' }),
      rootCause({ lastKiller: null, gameOverReason: 'qa' }),
      rootCause({ lastKiller: null, gameOverReason: 'caught' }),
    ];
    for (const t of texts) expect(usesOnlyFontGlyphs(t)).toBe(true);
  });
});

describe('initials entry through the cabinet', () => {
  it('typed letters, arrows and Enter save locally, submit remotely and show the high scores', () => {
    const sum = summary();
    const r = run(initialsScreen(sum), [
      { type: 'initialsKey', key: { char: 'k' } },
      { type: 'initialsKey', key: { char: 'i' } },
      { type: 'initialsKey', key: 'up' },
      { type: 'initialsKey', key: 'enter' },
    ]);
    expect(r.state.screen).toBe('highscores');
    expect(r.state.lastInitials).toBe('KIB');
    expect(r.state.remoteStatus).toBe('submitting');
    expect(r.effects).toEqual([
      { type: 'saveLocalScore', entry: { initials: 'KIB', score: 1230, level: 2 } },
      { type: 'submitRemote', submission: { initials: 'KIB', seed: sum.seed, inputLog: sum.inputLog, claimedScore: 1230 } },
    ]);
  });

  it('an emitted submitRemote sets remoteStatus = submitting in the same reduce result', () => {
    const r = reduce(initialsScreen(), { type: 'initialsKey', key: 'enter' });
    expect(submits(r.effects)).toHaveLength(1);
    expect(r.state.remoteStatus).toBe('submitting');
    expect(r.state.remoteDetail).toBeNull();
  });

  it('typed lowercase is uppercased, digits and non-ASCII letters are ignored', () => {
    const r = run(initialsScreen(), [
      { type: 'initialsKey', key: { char: '7' } },
      { type: 'initialsKey', key: { char: 'Ä' } },
      { type: 'initialsKey', key: { char: 'z' } },
    ]);
    expect(r.state.initials?.letters).toEqual([25, 0, 0]);
    expect(r.effects).toEqual([]);
  });

  it('auto-confirms the current initials after 1800 UI ticks', () => {
    const s = reduce(initialsScreen(), { type: 'initialsKey', key: { char: 'q' } }).state;
    const before = run(s, ticks(1799));
    expect(before.state.screen).toBe('initials');
    expect(before.effects).toEqual([]);
    const after = reduce(before.state, { type: 'uiTick' });
    expect(after.state.screen).toBe('highscores');
    expect(after.state.lastInitials).toBe('QAA');
    expect(after.effects[0]).toEqual({ type: 'saveLocalScore', entry: { initials: 'QAA', score: 1230, level: 2 } });
  });

  it('offline: confirming initials saves locally, emits no submitRemote, and shows offline', () => {
    const r = reduce(initialsScreen(summary(), false), { type: 'initialsKey', key: 'enter' });
    expect(r.effects).toEqual([{ type: 'saveLocalScore', entry: { initials: 'AAA', score: 1230, level: 2 } }]);
    expect(r.state.remoteStatus).toBe('offline');
  });

  it('a tainted summary emits no submitRemote and leaves remoteStatus idle', () => {
    const r = reduce(initialsScreen(summary({ tainted: true })), { type: 'initialsKey', key: 'enter' });
    expect(submits(r.effects)).toEqual([]);
    expect(r.effects).toHaveLength(1);
    expect(r.state.remoteStatus).toBe('idle');
  });

  it('a log of more than 10000 events emits no submitRemote and sets rejected / LOG TOO LONG', () => {
    const big: InputLog = Array.from({ length: MAX_SUBMIT_LOG_EVENTS + 1 }, (_, i) => [i, ((i % 4) + 1) as 1 | 2 | 3 | 4]);
    const r = reduce(initialsScreen(summary({ inputLog: big })), { type: 'initialsKey', key: 'enter' });
    expect(submits(r.effects)).toEqual([]);
    expect(r.state.remoteStatus).toBe('rejected');
    expect(r.state.remoteDetail).toBe('LOG TOO LONG');
  });

  it('exactly 10000 events is still submitted', () => {
    const max: InputLog = Array.from({ length: MAX_SUBMIT_LOG_EVENTS }, (_, i) => [i, 1]);
    const r = reduce(initialsScreen(summary({ inputLog: max })), { type: 'initialsKey', key: 'enter' });
    expect(submits(r.effects)).toHaveLength(1);
  });

  it('initials keys outside the initials screen are ignored', () => {
    const s = playing();
    expect(reduce(s, { type: 'initialsKey', key: { char: 'a' } })).toEqual({ state: s, effects: [] });
  });

  it('localSaved sets the highlighted rank', () => {
    const s = reduce(initialsScreen(), { type: 'initialsKey', key: 'enter' }).state;
    expect(s.highlightRank).toBeNull();
    expect(reduce(s, { type: 'localSaved', rank: 3 }).state.highlightRank).toBe(3);
  });
});

describe('non-qualifying scores (CC-8.2)', () => {
  it('skip initials and go straight to the high scores', () => {
    const r = reduce(incident(summary(), false), { type: 'confirm' });
    expect(r.state.screen).toBe('highscores');
    expect(r.effects.some((e) => e.type === 'saveLocalScore')).toBe(false);
  });

  it('a score > 0 online is submitted as KIR when no initials were confirmed this session', () => {
    const sum = summary({ score: 70 });
    const r = reduce(incident(sum, false), { type: 'confirm' });
    expect(r.effects).toEqual([
      { type: 'submitRemote', submission: { initials: DEFAULT_INITIALS, seed: sum.seed, inputLog: sum.inputLog, claimedScore: 70 } },
    ]);
    expect(DEFAULT_INITIALS).toBe('KIR');
    expect(r.state.remoteStatus).toBe('submitting');
  });

  it('uses the last-confirmed initials of the cabinet session', () => {
    const afterFirst = run(initialsScreen(), [
      { type: 'initialsKey', key: { char: 'z' } },
      { type: 'initialsKey', key: { char: 'e' } },
      { type: 'initialsKey', key: { char: 'd' } },
      { type: 'initialsKey', key: 'enter' },
      { type: 'confirm' },
    ]).state;
    expect(afterFirst.screen).toBe('attract');
    const second = run(afterFirst, [
      { type: 'coin' },
      { type: 'start', seed: 5 },
      { type: 'gameOver', summary: summary({ score: 40 }), qualifies: false },
      ...ticks(60),
      { type: 'confirm' },
    ]);
    const sub = submits(second.effects);
    expect(sub).toHaveLength(1);
    expect(sub[0]).toMatchObject({ submission: { initials: 'ZED', claimedScore: 40 } });
  });

  it('a tainted non-qualifying score emits nothing', () => {
    const r = reduce(incident(summary({ score: 70, tainted: true }), false), { type: 'confirm' });
    expect(r.effects).toEqual([]);
    expect(r.state.remoteStatus).toBe('idle');
  });

  it('a non-qualifying score with more than 10000 events emits nothing and shows LOG TOO LONG', () => {
    const big: InputLog = Array.from({ length: MAX_SUBMIT_LOG_EVENTS + 1 }, (_, i) => [i, 1]);
    const r = reduce(incident(summary({ score: 70, inputLog: big }), false), { type: 'confirm' });
    expect(r.effects).toEqual([]);
    expect(r.state).toMatchObject({ remoteStatus: 'rejected', remoteDetail: 'LOG TOO LONG' });
  });

  it('offline: no submission, status offline', () => {
    const r = reduce(incident(summary({ score: 70 }), false, false), { type: 'confirm' });
    expect(r.effects).toEqual([]);
    expect(r.state.remoteStatus).toBe('offline');
  });

  it('score 0 does not qualify: straight to the high scores with no remote submission', () => {
    const r = reduce(incident(summary({ score: 0 }), false), { type: 'confirm' });
    expect(r.state.screen).toBe('highscores');
    expect(r.effects).toEqual([]);
    expect(r.state.remoteStatus).toBe('idle');
  });
});

describe('high-score screen', () => {
  const hs = (): CabinetState => reduce(incident(summary(), false), { type: 'confirm' }).state;

  it('returns to attract after 600 UI ticks, keeping credits', () => {
    const s = run(hs(), [{ type: 'coin' }, { type: 'coin' }]).state;
    expect(run(s, ticks(599)).state.screen).toBe('highscores');
    const back = run(s, ticks(600)).state;
    expect(back.screen).toBe('attract');
    expect(back.credits).toBe(2);
    expect(back.attractPanel).toBe('title');
  });

  it('Enter returns to attract', () => {
    expect(reduce(hs(), { type: 'confirm' }).state.screen).toBe('attract');
  });
});

describe('remoteStatus events', () => {
  it('store the status and the uppercased detail', () => {
    const s = reduce(initialsScreen(), { type: 'initialsKey', key: 'enter' }).state;
    expect(reduce(s, { type: 'remoteStatus', status: 'verified' }).state).toMatchObject({
      remoteStatus: 'verified',
      remoteDetail: null,
    });
    expect(reduce(s, { type: 'remoteStatus', status: 'rejected', detail: 'replay_mismatch' }).state).toMatchObject({
      remoteStatus: 'rejected',
      remoteDetail: 'REPLAY_MISMATCH',
    });
  });

  it('are still stored after the user has left the high-score screen', () => {
    const s = run(reduce(initialsScreen(), { type: 'initialsKey', key: 'enter' }).state, [{ type: 'confirm' }]).state;
    expect(s.screen).toBe('attract');
    expect(reduce(s, { type: 'remoteStatus', status: 'offline' }).state.remoteStatus).toBe('offline');
  });

  it('a new game resets the remote status', () => {
    const s = run(reduce(initialsScreen(), { type: 'initialsKey', key: 'enter' }).state, [
      { type: 'remoteStatus', status: 'rejected', detail: 'x' },
      { type: 'confirm' },
      { type: 'coin' },
      { type: 'start', seed: 3 },
    ]).state;
    expect(s).toMatchObject({ screen: 'playing', remoteStatus: 'idle', remoteDetail: null, summary: null });
  });
});

describe('purity', () => {
  it('the same state and event always give the same result, and the input is never mutated', () => {
    const states = [
      initialCabinet(true),
      playing(),
      incident(summary(), true),
      initialsScreen(),
      reduce(incident(summary(), false), { type: 'confirm' }).state,
    ];
    const events: CabinetEvent[] = [
      { type: 'coin' },
      { type: 'start', seed: 77 },
      { type: 'confirm' },
      { type: 'gameOver', summary: summary(), qualifies: true },
      { type: 'initialsKey', key: { char: 'b' } },
      { type: 'initialsKey', key: 'enter' },
      { type: 'uiTick' },
      { type: 'remoteStatus', status: 'verified' },
      { type: 'localSaved', rank: 1 },
    ];
    for (const s of states) {
      const frozen = deepFreeze(structuredClone(s));
      for (const e of events) {
        const a = reduce(frozen, deepFreeze(structuredClone(e)));
        const b = reduce(frozen, e);
        expect(a).toEqual(b);
      }
      expect(frozen).toEqual(s);
    }
  });

  it('cabinet.ts imports nothing from render, audio or app', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'cabinet.ts'), 'utf8');
    const specs = [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec).not.toMatch(/render|audio|\/app/);
  });
});
