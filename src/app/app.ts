/**
 * The cabinet app: everything `main.ts` wires to the DOM, kept free of DOM access so it can be tested
 * with fakes. It turns keys into cabinet events, runs one 60 Hz step at a time (a `uiTick` for the
 * cabinet, then the engine while playing and not paused, recording the held direction first), runs the
 * phase-based game-over check after every engine step and QA mutation (overview §6), and executes the
 * cabinet's effects: sfx, startEngine, saveLocalScore and submitRemote → remoteStatus.
 */
import { reduce, initialCabinet } from '../arcade/cabinet';
import type { CabinetEvent, CabinetState, Effect } from '../arcade/cabinet';
import { soundsForEvents } from '../audio/sfx';
import type { Sfx } from '../audio/sfx';
import { createGame, createRecorder, step as engineStep } from '../engine';
import type { GameEvent, GameState, Recorder } from '../engine';
import { insertScore, qualifies } from '../leaderboard/ranking';
import type { ScoreEntry } from '../leaderboard/ranking';
import type { RemoteClient, RemoteErr } from '../leaderboard/remoteClient';
import type { Result } from '../shared/result';
import type { GlobalBoard, RenderView } from '../render/view';
import { milestoneCrossed, screenAnnouncement } from './a11y';
import { createDirStack, mapKey } from './keyboard';
import type { LastSubmission, QaHost } from './qa';
import { checkGameOver, createSession, resetForNewGame, summarize } from './session';

export interface AppHooks {
  gameEvents?(game: GameState, events: readonly GameEvent[]): void;
  newGame?(): void;
  screenChanged?(cab: CabinetState): void;
  announce?(text: string): void;
  toast?(text: string, uiTick: number): void;
}

export interface AppDeps {
  online: boolean;
  store: { load(): ScoreEntry[]; save(list: ScoreEntry[]): void };
  remote: RemoteClient | null;
  sfx: Sfx;
  /** A fresh game seed (crypto in the browser, the pinned QA seed in QA mode). */
  seed(): number;
  hooks?: AppHooks;
  warn?: (m: string) => void;
  error?: (m: string, e: unknown) => void;
}

export interface CabinetApp {
  /** One fixed 60 Hz step. */
  step(): void;
  /** Returns true when the key meant something on this screen (the caller then prevents the default). */
  keyDown(key: string, repeat: boolean): boolean;
  keyUp(key: string): void;
  /** Window blur: drop held directions. */
  blur(): void;
  /** Page visibility: hiding the page pauses play (AP-6.2). */
  setHidden(hidden: boolean): void;
  view(): RenderView;
  readonly qaHost: QaHost;
  /** Resolves when no remote request is in flight (tests). */
  idle(): Promise<void>;
}

/** Remote submit result → the cabinet's `remoteStatus` event (binding mapping, overview §7.2). */
export function remoteStatusEvent(r: Result<{ score: number; level: number }, RemoteErr>): CabinetEvent {
  if (r.ok) return { type: 'remoteStatus', status: 'verified' };
  if (r.error.kind === 'rejected') return { type: 'remoteStatus', status: 'rejected', detail: r.error.error };
  return { type: 'remoteStatus', status: 'offline' };
}

export function createCabinetApp(deps: AppDeps): CabinetApp {
  const hooks = deps.hooks ?? {};
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const error = deps.error ?? ((m: string, e: unknown) => console.error(m, e));
  let cabinet = initialCabinet(deps.online);
  let game: GameState | null = null;
  let recorder: Recorder = createRecorder();
  const session = createSession();
  let local: ScoreEntry[] = deps.store.load();
  let global: GlobalBoard = { status: deps.online && deps.remote !== null ? 'loading' : 'disabled', list: [] };
  let paused = false;
  let fatal: string | null = null;
  let lastSubmission: LastSubmission | null = null;
  let announcedScore = 0;
  const dirs = createDirStack();
  const queue: CabinetEvent[] = [];
  let draining = false;
  const inflight = new Set<Promise<unknown>>();

  // Boot-time check of the shipped mazes (overview §10: a broken maze is a fatal MAZE ERROR screen).
  try {
    createGame(0);
  } catch (e) {
    fatal = 'MAZE ERROR';
    error('KIRO-MAN cannot start: invalid shipped maze', e);
  }

  function track<T>(p: Promise<T>): void {
    const done = p.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(done);
    void done.then(() => inflight.delete(done));
  }

  function refreshGlobal(): void {
    const remote = deps.remote;
    if (remote === null || !cabinet.online) return;
    if (global.status !== 'ok') global = { status: 'loading', list: global.list };
    track(
      remote.getTop().then((r) => {
        global = r.ok ? { status: 'ok', list: r.value } : { status: 'offline', list: [] };
      }),
    );
  }

  function screenChanged(prev: CabinetState['screen']): void {
    dirs.clear();
    if (prev === 'playing') paused = false;
    hooks.screenChanged?.(cabinet);
    hooks.announce?.(screenAnnouncement(cabinet));
    if (cabinet.screen === 'highscores' || cabinet.screen === 'attract') refreshGlobal();
  }

  function startEngine(seed: number): void {
    try {
      game = createGame(seed);
    } catch (e) {
      fatal = 'MAZE ERROR';
      game = null;
      error('KIRO-MAN cannot start a game', e);
      return;
    }
    recorder = createRecorder();
    resetForNewGame(session);
    paused = false;
    announcedScore = 0;
    lastSubmission = null;
    hooks.newGame?.();
  }

  function saveLocal(entry: ScoreEntry): void {
    const r = insertScore(local, entry);
    if (!r.ok) {
      warn(`high scores: refusing invalid entry (${r.error})`);
      dispatch({ type: 'localSaved', rank: null });
      return;
    }
    local = r.list;
    deps.store.save(local);
    dispatch({ type: 'localSaved', rank: r.rank });
  }

  function submitRemote(sub: LastSubmission & { initials: string }): void {
    const remote = deps.remote;
    if (remote === null) {
      dispatch({ type: 'remoteStatus', status: 'offline' });
      return;
    }
    track(
      remote.submit(sub).then((r) => {
        if (!r.ok) warn(`leaderboard submit failed: ${r.error.kind}`);
        dispatch(remoteStatusEvent(r));
        if (r.ok) refreshGlobal();
      }),
    );
  }

  function run(effect: Effect): void {
    switch (effect.type) {
      case 'sfx':
        deps.sfx.play(effect.name);
        break;
      case 'startEngine':
        startEngine(effect.seed);
        break;
      case 'saveLocalScore':
        saveLocal(effect.entry);
        break;
      case 'submitRemote':
        submitRemote(effect.submission);
        break;
    }
  }

  function dispatch(e: CabinetEvent): void {
    queue.push(e);
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift() as CabinetEvent;
        const prev = cabinet.screen;
        const out = reduce(cabinet, next);
        cabinet = out.state;
        for (const effect of out.effects) run(effect);
        if (cabinet.screen !== prev) screenChanged(prev);
      }
    } finally {
      draining = false;
    }
  }

  /** After an engine step (from = 0) or a QA mutation (from = events length before it). */
  function afterGameChange(g: GameState, from: number): void {
    const events = g.events.slice(from);
    if (events.length > 0) {
      for (const name of soundsForEvents(events)) deps.sfx.play(name);
      hooks.gameEvents?.(g, events);
    }
    const milestone = milestoneCrossed(announcedScore, g.score);
    if (milestone !== null) hooks.announce?.(`Score ${milestone}.`);
    announcedScore = g.score;
    if (checkGameOver(g, session)) {
      const summary = summarize(g, recorder.log, session.tainted);
      lastSubmission = { seed: summary.seed, inputLog: summary.inputLog, claimedScore: summary.score };
      dispatch({ type: 'gameOver', summary, qualifies: qualifies(local, summary.score) });
    }
  }

  refreshGlobal();

  const qaHost: QaHost = {
    activeGame: () => (cabinet.screen === 'playing' ? game : null),
    screen: () => cabinet.screen,
    score: () => game?.score ?? 0,
    mutated(g, eventsBefore) {
      session.tainted = true;
      afterGameChange(g, eventsBefore);
    },
    lastSubmission: () => lastSubmission,
  };

  return {
    step() {
      if (fatal !== null) return;
      dispatch({ type: 'uiTick' });
      if (cabinet.screen !== 'playing' || game === null || paused || game.phase === 'gameOver') return;
      const dir = dirs.current();
      recorder.record(game.tick, dir);
      engineStep(game, dir);
      afterGameChange(game, 0);
    },
    keyDown(key, repeat) {
      deps.sfx.resume();
      if (fatal !== null) return false;
      const action = mapKey(cabinet.screen, key);
      if (action === null) return false;
      const navRepeat = action.type === 'initialsKey' && typeof action.key === 'string';
      if (repeat && action.type !== 'dir' && !navRepeat) return true;
      switch (action.type) {
        case 'coin':
          dispatch({ type: 'coin' });
          break;
        case 'mute': {
          const muted = deps.sfx.toggleMute();
          hooks.toast?.(muted ? 'SOUND OFF' : 'SOUND ON', cabinet.uiTick);
          hooks.announce?.(muted ? 'Sound off.' : 'Sound on.');
          break;
        }
        case 'pause':
          paused = !paused;
          hooks.announce?.(paused ? 'Paused. Press P to resume.' : 'Resumed.');
          break;
        case 'dir':
          dirs.press(key);
          break;
        case 'start':
          dispatch({ type: 'start', seed: deps.seed() >>> 0 });
          break;
        case 'confirm':
          dispatch({ type: 'confirm' });
          break;
        case 'initialsKey':
          dispatch({ type: 'initialsKey', key: action.key });
          break;
      }
      return true;
    },
    keyUp(key) {
      dirs.release(key);
    },
    blur() {
      dirs.clear();
    },
    setHidden(hidden) {
      if (hidden && cabinet.screen === 'playing' && !paused) {
        paused = true;
        hooks.announce?.('Paused. Press P to resume.');
      }
    },
    view: () => ({ cabinet, game, local, global, paused, muted: deps.sfx.muted, fatal }),
    qaHost,
    async idle() {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
  };
}
