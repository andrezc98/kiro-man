import { describe, expect, it, vi } from 'vitest';
import type { Sfx, SoundName } from '../audio/sfx';
import type { ScoreEntry } from '../leaderboard/ranking';
import type { RemoteClient } from '../leaderboard/remoteClient';
import { validateReplay } from '../shared/replay';
import { err, ok } from '../shared/result';
import { createCabinetApp, remoteStatusEvent } from './app';
import type { AppDeps, CabinetApp } from './app';
import { createQaApi } from './qa';

function fakeSfx(): Sfx & { played: SoundName[] } {
  let muted = false;
  const played: SoundName[] = [];
  return {
    played,
    resume: () => undefined,
    play: (n) => {
      if (!muted) played.push(n);
    },
    toggleMute: () => (muted = !muted),
    setMuted: (m) => {
      muted = m;
    },
    get muted() {
      return muted;
    },
    available: true,
  };
}

function setup(over: Partial<AppDeps> = {}, initial: ScoreEntry[] = []) {
  const sfx = fakeSfx();
  const saved: ScoreEntry[][] = [];
  const announce = vi.fn();
  const toast = vi.fn();
  const newGame = vi.fn();
  const app = createCabinetApp({
    online: false,
    store: { load: () => initial.map((e) => ({ ...e })), save: (l) => saved.push(l) },
    remote: null,
    sfx,
    seed: () => 1234,
    hooks: { announce, toast, newGame },
    warn: () => undefined,
    ...over,
  });
  return { app, sfx, saved, announce, toast, newGame };
}

const press = (app: CabinetApp, key: string): void => {
  app.keyDown(key, false);
  app.keyUp(key);
};

/** Coin, start, hold Left to eat a row of bugs, then idle until Latency ends the game. */
function playToIncident(app: CabinetApp): void {
  press(app, 'c');
  press(app, 'Enter');
  app.keyDown('ArrowLeft', false);
  for (let i = 0; i < 300; i++) app.step();
  app.keyUp('ArrowLeft');
  for (let i = 0; i < 40000 && app.view().cabinet.screen === 'playing'; i++) app.step();
}

function remote(over: Partial<RemoteClient> = {}): RemoteClient & { submit: ReturnType<typeof vi.fn>; getTop: ReturnType<typeof vi.fn> } {
  return {
    getTop: vi.fn(async () => ok([{ initials: 'TOP', score: 99999, level: 9 }])),
    submit: vi.fn(async (s: { claimedScore: number }) => ok({ score: s.claimedScore, level: 1 })),
    ...over,
  } as never;
}

describe('cabinet app', () => {
  it('C adds a credit, Enter starts with that credit, and a real game reaches the Incident Report once', () => {
    const { app, sfx, announce, newGame } = setup();
    press(app, 'c');
    expect(app.view().cabinet.credits).toBe(1);
    press(app, 'Enter');
    const v = app.view();
    expect(v.cabinet.screen).toBe('playing');
    expect(v.cabinet.credits).toBe(0);
    expect(v.game?.seed).toBe(1234);
    expect(newGame).toHaveBeenCalledTimes(1);
    playToIncident(app);
    const after = app.view();
    expect(after.cabinet.screen).toBe('incident');
    const s = after.cabinet.summary!;
    expect(s.score).toBeGreaterThan(0);
    expect(s.gameOverReason).toBe('caught');
    expect(s.lastKiller).not.toBeNull();
    // The recorded log replays to the same score on the server-side validator.
    expect(validateReplay({ seed: s.seed, inputLog: s.inputLog, claimedScore: s.score })).toEqual({
      ok: true,
      score: s.score,
      level: s.level,
    });
    expect(sfx.played).toContain('coin');
    expect(sfx.played).toContain('start');
    expect(sfx.played).toContain('eat');
    expect(sfx.played.filter((n) => n === 'death')).toHaveLength(3);
    expect(sfx.played.filter((n) => n === 'gameOver')).toHaveLength(1);
    const tick = after.game!.tick;
    for (let i = 0; i < 100; i++) app.step();
    expect(app.view().game!.tick).toBe(tick);
    expect(announce.mock.calls.filter(([t]) => String(t).startsWith('Game over'))).toHaveLength(1);
  });

  it('Enter with no credits does not start; Enter is ignored while playing', () => {
    const { app, sfx } = setup();
    press(app, 'Enter');
    expect(app.view().cabinet.screen).toBe('attract');
    expect(sfx.played).toEqual(['denied']);
    press(app, '5');
    press(app, '5');
    press(app, 'Enter');
    expect(app.view().cabinet.credits).toBe(1);
    press(app, 'Enter');
    expect(app.view().cabinet.credits).toBe(1);
    expect(app.view().cabinet.screen).toBe('playing');
  });

  it('offline: qualifying score → initials → saved locally, status OFFLINE, back to attract', () => {
    const { app, saved } = setup();
    playToIncident(app);
    press(app, 'Enter');
    expect(app.view().cabinet.screen).toBe('incident');
    for (let i = 0; i < 60; i++) app.step();
    press(app, 'Enter');
    expect(app.view().cabinet.screen).toBe('initials');
    for (const k of ['k', 'i', 'r']) press(app, k);
    press(app, 'Enter');
    const v = app.view();
    expect(v.cabinet.screen).toBe('highscores');
    expect(v.cabinet.remoteStatus).toBe('offline');
    expect(v.cabinet.highlightRank).toBe(1);
    expect(v.local[0]).toMatchObject({ initials: 'KIR' });
    expect(saved).toHaveLength(1);
    expect(v.global.status).toBe('disabled');
    press(app, 'Enter');
    expect(app.view().cabinet.screen).toBe('attract');
  });

  it('online: submits after initials and shows VERIFIED, refreshing the global board', async () => {
    const r = remote();
    const { app } = setup({ online: true, remote: r });
    await app.idle();
    expect(app.view().global).toEqual({ status: 'ok', list: [{ initials: 'TOP', score: 99999, level: 9 }] });
    playToIncident(app);
    for (let i = 0; i < 60; i++) app.step();
    press(app, 'Enter');
    for (const k of ['a', 'w', 's']) press(app, k);
    press(app, 'Enter');
    expect(app.view().cabinet.remoteStatus).toBe('submitting');
    expect(r.submit).toHaveBeenCalledTimes(1);
    const sub = r.submit.mock.calls[0]![0];
    expect(sub.initials).toBe('AWS');
    expect(validateReplay(sub).ok).toBe(true);
    await app.idle();
    expect(app.view().cabinet.remoteStatus).toBe('verified');
    expect(r.getTop.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('online: a rejected submission shows REJECTED with the server error', async () => {
    const r = remote({ submit: vi.fn(async () => err({ kind: 'rejected' as const, error: 'replay_mismatch' })) });
    const { app } = setup({ online: true, remote: r });
    playToIncident(app);
    for (let i = 0; i < 60; i++) app.step();
    press(app, 'Enter');
    press(app, 'Enter');
    await app.idle();
    expect(app.view().cabinet.remoteStatus).toBe('rejected');
    expect(app.view().cabinet.remoteDetail).toBe('REPLAY_MISMATCH');
  });

  it('a failed global fetch shows OFFLINE in the panel without changing online', async () => {
    const r = remote({ getTop: vi.fn(async () => err({ kind: 'network' as const })) });
    const { app } = setup({ online: true, remote: r });
    await app.idle();
    expect(app.view().global.status).toBe('offline');
    expect(app.view().cabinet.online).toBe(true);
  });

  it('QA forceGameOver goes straight to the Incident Report and taints the session (no remote submit)', async () => {
    const r = remote();
    const { app, sfx } = setup({ online: true, remote: r });
    press(app, 'c');
    press(app, 'Enter');
    const qa = createQaApi(app.qaHost);
    app.keyDown('ArrowLeft', false);
    for (let i = 0; i < 200; i++) app.step();
    expect(qa.grantPowerUp('lambda')).toBe(true);
    expect(sfx.played).toContain('powerUp');
    expect(qa.forceGameOver()).toBe(true);
    expect(qa.getScreen()).toBe('incident');
    const s = app.view().cabinet.summary!;
    expect(s.tainted).toBe(true);
    expect(s.gameOverReason).toBe('qa');
    expect(sfx.played).toContain('gameOver');
    expect(qa.getLastSubmission()).toEqual({ seed: 1234, inputLog: s.inputLog, claimedScore: s.score });
    for (let i = 0; i < 60; i++) app.step();
    press(app, 'Enter');
    press(app, 'Enter');
    await app.idle();
    expect(app.view().cabinet.screen).toBe('highscores');
    expect(r.submit).not.toHaveBeenCalled();
    expect(app.view().cabinet.remoteStatus).toBe('idle');
    expect(qa.grantPowerUp('lambda')).toBe(false);
  });

  it('P pauses and resumes; hiding the page pauses; paused play does not advance', () => {
    const { app, announce } = setup();
    press(app, 'c');
    press(app, 'Enter');
    for (let i = 0; i < 10; i++) app.step();
    const t = app.view().game!.tick;
    press(app, 'p');
    expect(app.view().paused).toBe(true);
    for (let i = 0; i < 10; i++) app.step();
    expect(app.view().game!.tick).toBe(t);
    press(app, 'P');
    app.step();
    expect(app.view().game!.tick).toBe(t + 1);
    app.setHidden(true);
    expect(app.view().paused).toBe(true);
    expect(announce).toHaveBeenCalledWith('Paused. Press P to resume.');
  });

  it('M toggles mute with a toast; key repeats of C are ignored', () => {
    const { app, toast, sfx } = setup();
    press(app, 'm');
    expect(app.view().muted).toBe(true);
    expect(toast).toHaveBeenCalledWith('SOUND OFF', expect.any(Number));
    press(app, 'M');
    expect(sfx.muted).toBe(false);
    app.keyDown('c', false);
    app.keyDown('c', true);
    app.keyDown('c', true);
    expect(app.view().cabinet.credits).toBe(1);
  });

  it('records only held-direction changes and replays them faithfully', () => {
    const { app } = setup();
    press(app, 'c');
    press(app, 'Enter');
    for (let i = 0; i < 130; i++) app.step();
    app.keyDown('ArrowLeft', false);
    app.keyDown('ArrowLeft', true);
    for (let i = 0; i < 20; i++) app.step();
    app.keyDown('ArrowUp', false);
    for (let i = 0; i < 20; i++) app.step();
    app.keyUp('ArrowUp');
    for (let i = 0; i < 20; i++) app.step();
    const qa = createQaApi(app.qaHost);
    qa.forceGameOver();
    const log = app.view().cabinet.summary!.inputLog;
    expect(log.map(([, d]) => d)).toEqual([4, 1, 4]);
    expect(log.every(([t], i) => i === 0 || t > log[i - 1]![0])).toBe(true);
  });
});

describe('remoteStatusEvent', () => {
  it('maps submit results to cabinet statuses', () => {
    expect(remoteStatusEvent(ok({ score: 1, level: 1 }))).toEqual({ type: 'remoteStatus', status: 'verified' });
    expect(remoteStatusEvent(err({ kind: 'rejected', error: 'invalid_request' }))).toEqual({
      type: 'remoteStatus',
      status: 'rejected',
      detail: 'invalid_request',
    });
    for (const kind of ['network', 'timeout', 'http'] as const) {
      expect(remoteStatusEvent(err({ kind }))).toEqual({ type: 'remoteStatus', status: 'offline' });
    }
    expect(remoteStatusEvent(err({ kind: 'bad_response' }))).toEqual({ type: 'remoteStatus', status: 'offline' });
  });
});
