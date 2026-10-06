/**
 * The cabinet: a pure reducer over screens (coin-credit-system design, overview §6). The app feeds it
 * keyboard-derived events and a `uiTick` per 60 Hz step, then executes the returned effects. `reduce`
 * returns a new state and never mutates its input. Credits are only computed by `credits.ts`.
 */
import type { EnemyId, InputLog, PowerKind } from '../engine';
import { insertCoin, tryStart } from './credits';
import { initialInitials, initialsReduce, initialsString } from './initials';
import type { InitialsKey, InitialsState } from './initials';

export type Screen = 'attract' | 'playing' | 'incident' | 'initials' | 'highscores';

/** Every sound the game plays; the cabinet emits `coin`, `start` and `denied`, audio plays the rest from engine events. */
export type SfxName =
  | 'coin'
  | 'start'
  | 'denied'
  | 'eat'
  | 'powerUp'
  | 'shieldBlock'
  | 'death'
  | 'levelClear'
  | 'gameOver';

export interface GameSummary {
  seed: number;
  score: number;
  level: number;
  bugsEaten: number;
  servicesUsed: Record<PowerKind, number>;
  lastKiller: EnemyId | null;
  gameOverReason: 'caught' | 'timeLimit' | 'qa';
  inputLog: InputLog;
  tainted: boolean;
}

export type RemoteStatus = 'idle' | 'submitting' | 'verified' | 'rejected' | 'offline';

export interface CabinetState {
  screen: Screen;
  credits: number;
  uiTick: number;
  /** UI ticks since the current screen was entered. */
  screenTicks: number;
  /** Remaining ticks of the fast INSERT COIN flash after a failed start. */
  insertCoinFlash: number;
  attractPanel: 'title' | 'scores';
  summary: GameSummary | null;
  initials: InitialsState | null;
  lastInitials: string | null;
  highlightRank: number | null;
  remoteStatus: RemoteStatus;
  remoteDetail: string | null;
  /** Fixed for the session (decided by `loadConfig` before the cabinet is created). */
  online: boolean;
  localQualifies: boolean;
}

export type CabinetEvent =
  | { type: 'coin' }
  | { type: 'start'; seed: number }
  | { type: 'confirm' }
  | { type: 'gameOver'; summary: GameSummary; qualifies: boolean }
  | { type: 'initialsKey'; key: InitialsKey }
  | { type: 'uiTick' }
  | { type: 'remoteStatus'; status: RemoteStatus; detail?: string }
  | { type: 'localSaved'; rank: number | null };

export interface SubmissionPayload {
  initials: string;
  seed: number;
  inputLog: InputLog;
  claimedScore: number;
}

export type Effect =
  | { type: 'sfx'; name: SfxName }
  | { type: 'startEngine'; seed: number }
  | { type: 'saveLocalScore'; entry: { initials: string; score: number; level: number } }
  | { type: 'submitRemote'; submission: SubmissionPayload };

/** Timings in UI ticks (60 Hz), from the design's "Timings" paragraph. */
export const TIMINGS = {
  insertCoinBlinkPeriod: 30,
  failedStartFlashTicks: 60,
  failedStartFlashToggle: 4,
  attractPanelTicks: 480,
  incidentLockoutTicks: 60,
  highscoreDwellTicks: 600,
} as const;

/** Above this many input events no submission is sent (status REJECTED, "LOG TOO LONG"). */
export const MAX_SUBMIT_LOG_EVENTS = 10000;

/** The initials used for a non-qualifying remote submission when none were confirmed this session. */
export const DEFAULT_INITIALS = 'KIR';

export const ENEMY_NAMES: Readonly<Record<EnemyId, string>> = {
  latency: 'LATENCY',
  throttle: 'THROTTLE',
  coldstart: 'COLD START',
  outage: 'OUTAGE',
};

/** Incident Report root cause (CC-5.1). */
export function rootCause(summary: Pick<GameSummary, 'lastKiller' | 'gameOverReason'>): string {
  if (summary.lastKiller !== null) return `${ENEMY_NAMES[summary.lastKiller]} CAUGHT KIRO`;
  if (summary.gameOverReason === 'timeLimit') return 'SHIFT ENDED (30:00)';
  if (summary.gameOverReason === 'qa') return 'MANUAL FAILOVER';
  // A normal final death always records its killer; keep the text sensible if it ever does not.
  return 'KIRO WENT DOWN';
}

export function initialCabinet(online: boolean): CabinetState {
  return {
    screen: 'attract',
    credits: 0,
    uiTick: 0,
    screenTicks: 0,
    insertCoinFlash: 0,
    attractPanel: 'title',
    summary: null,
    initials: null,
    lastInitials: null,
    highlightRank: null,
    remoteStatus: online ? 'idle' : 'offline',
    remoteDetail: null,
    online,
    localQualifies: false,
  };
}

type Out = { state: CabinetState; effects: Effect[] };

const same = (state: CabinetState): Out => ({ state, effects: [] });

function enter(s: CabinetState, screen: Screen): CabinetState {
  return { ...s, screen, screenTicks: 0 };
}

/**
 * The remote submission decision shared by CC-8.1 and CC-8.2 (binding remoteStatus transitions):
 * offline → 'offline'; tainted → 'idle'; log over 10000 events → 'rejected' / LOG TOO LONG;
 * otherwise emit `submitRemote` and set 'submitting' in the same result.
 */
function remoteSubmission(s: CabinetState, summary: GameSummary, initials: string): Out {
  if (!s.online) return { state: { ...s, remoteStatus: 'offline', remoteDetail: null }, effects: [] };
  if (summary.tainted) return { state: { ...s, remoteStatus: 'idle', remoteDetail: null }, effects: [] };
  if (summary.inputLog.length > MAX_SUBMIT_LOG_EVENTS) {
    return { state: { ...s, remoteStatus: 'rejected', remoteDetail: 'LOG TOO LONG' }, effects: [] };
  }
  return {
    state: { ...s, remoteStatus: 'submitting', remoteDetail: null },
    effects: [
      {
        type: 'submitRemote',
        submission: { initials, seed: summary.seed, inputLog: summary.inputLog, claimedScore: summary.score },
      },
    ],
  };
}

/** Initials confirmed (Enter or timeout): save locally, maybe submit, show the high scores. */
function finishInitials(s: CabinetState, initials: InitialsState): Out {
  const summary = s.summary;
  const name = initialsString(initials);
  const base = { ...enter(s, 'highscores'), initials, lastInitials: name, highlightRank: null };
  if (summary === null) return same(base);
  const save: Effect = { type: 'saveLocalScore', entry: { initials: name, score: summary.score, level: summary.level } };
  const remote = remoteSubmission(base, summary, name);
  return { state: remote.state, effects: [save, ...remote.effects] };
}

/** Incident Report confirmed after the lockout. */
function confirmIncident(s: CabinetState): Out {
  if (s.screenTicks < TIMINGS.incidentLockoutTicks) return same(s);
  if (s.localQualifies) return same({ ...enter(s, 'initials'), initials: initialInitials() });
  const base = { ...enter(s, 'highscores'), highlightRank: null };
  const summary = s.summary;
  // CC-8.2: a non-qualifying score > 0 is still submitted (emitted in this confirm's result).
  if (summary === null || summary.score <= 0) {
    return same({ ...base, remoteStatus: s.online ? 'idle' : 'offline', remoteDetail: null });
  }
  return remoteSubmission(base, summary, s.lastInitials ?? DEFAULT_INITIALS);
}

function uiTick(s: CabinetState): Out {
  const t: CabinetState = {
    ...s,
    uiTick: s.uiTick + 1,
    screenTicks: s.screenTicks + 1,
    insertCoinFlash: Math.max(0, s.insertCoinFlash - 1),
  };
  switch (t.screen) {
    case 'attract': {
      const panel = Math.floor(t.screenTicks / TIMINGS.attractPanelTicks) % 2 === 0 ? 'title' : 'scores';
      return same(panel === t.attractPanel ? t : { ...t, attractPanel: panel });
    }
    case 'initials': {
      if (t.initials === null) return same(t);
      const next = initialsReduce(t.initials, 'tick');
      return next.done ? finishInitials(t, next) : same({ ...t, initials: next });
    }
    case 'highscores':
      if (t.screenTicks >= TIMINGS.highscoreDwellTicks) return same({ ...enter(t, 'attract'), attractPanel: 'title' });
      return same(t);
    default:
      return same(t);
  }
}

/** Pure and total over its typed inputs; unknown events for a screen return the state unchanged. */
export function reduce(s: CabinetState, e: CabinetEvent): Out {
  switch (e.type) {
    case 'coin': {
      const r = insertCoin(s.credits);
      return { state: { ...s, credits: r.credits }, effects: [{ type: 'sfx', name: r.accepted ? 'coin' : 'denied' }] };
    }
    case 'start': {
      if (s.screen !== 'attract') return same(s);
      const r = tryStart(s.credits);
      if (!r.started) {
        return {
          state: { ...s, insertCoinFlash: TIMINGS.failedStartFlashTicks },
          effects: [{ type: 'sfx', name: 'denied' }],
        };
      }
      return {
        state: {
          ...enter(s, 'playing'),
          credits: r.credits,
          summary: null,
          initials: null,
          highlightRank: null,
          localQualifies: false,
          remoteStatus: s.online ? 'idle' : 'offline',
          remoteDetail: null,
        },
        effects: [
          { type: 'sfx', name: 'start' },
          { type: 'startEngine', seed: e.seed },
        ],
      };
    }
    case 'gameOver':
      if (s.screen !== 'playing') return same(s);
      return same({ ...enter(s, 'incident'), summary: e.summary, localQualifies: e.qualifies });
    case 'confirm':
      if (s.screen === 'incident') return confirmIncident(s);
      if (s.screen === 'highscores') return same({ ...enter(s, 'attract'), attractPanel: 'title' });
      return same(s);
    case 'initialsKey': {
      if (s.screen !== 'initials' || s.initials === null) return same(s);
      const next = initialsReduce(s.initials, e.key);
      if (next === s.initials) return same(s);
      return next.done ? finishInitials(s, next) : same({ ...s, initials: next });
    }
    case 'uiTick':
      return uiTick(s);
    case 'remoteStatus':
      return same({ ...s, remoteStatus: e.status, remoteDetail: e.detail === undefined ? null : e.detail.toUpperCase() });
    case 'localSaved':
      return same({ ...s, highlightRank: e.rank });
  }
}
