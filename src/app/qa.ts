/**
 * QA hooks (overview §9.7, arcade-presentation design). Attached as `window.__KIROMAN_QA__` only when the
 * page URL has `?qa=1`; in QA mode only, `&seed=<uint32>` replaces the random seed. Every mutator taints
 * the session (no remote submission; local saves still work) and is followed by the app's phase-based
 * game-over check.
 */
import type { Screen } from '../arcade/cabinet';
import { CATALOG_ORDER, applyPowerUp, forceGameOver } from '../engine';
import type { GameState, InputLog, PowerKind } from '../engine';

export const MAX_SEED = 4294967295;

export interface QaParams {
  enabled: boolean;
  /** The pinned seed, or null to use a random one. */
  seed: number | null;
}

/** Parses `location.search`. A bad `seed` is ignored with an info message. */
export function parseQaParams(search: string, info: (m: string) => void = (m) => console.info(m)): QaParams {
  const params = new URLSearchParams(search);
  if (params.get('qa') !== '1') return { enabled: false, seed: null };
  const raw = params.get('seed');
  if (raw === null) return { enabled: true, seed: null };
  if (/^\d+$/.test(raw) && Number(raw) <= MAX_SEED) return { enabled: true, seed: Number(raw) };
  info(`qa: ignoring invalid seed "${raw}"`);
  return { enabled: true, seed: null };
}

export interface LastSubmission {
  seed: number;
  inputLog: InputLog;
  claimedScore: number;
}

/** What the QA API needs from the app. */
export interface QaHost {
  /** The running game while the cabinet is on `playing`, otherwise null. */
  activeGame(): GameState | null;
  screen(): Screen;
  score(): number;
  /** Taints the session, handles events appended since `eventsBefore`, runs the game-over check. */
  mutated(game: GameState, eventsBefore: number): void;
  lastSubmission(): LastSubmission | null;
}

export interface QaApi {
  grantPowerUp(kind: PowerKind): boolean;
  releaseEnemies(): boolean;
  setInvulnerable(ticks: number): boolean;
  forceGameOver(): boolean;
  getScreen(): Screen;
  getScore(): number;
  getLastSubmission(): LastSubmission | null;
}

export function createQaApi(host: QaHost): QaApi {
  function mutate(run: (g: GameState) => void): boolean {
    const g = host.activeGame();
    if (g === null || g.phase === 'gameOver') return false;
    const before = g.events.length;
    run(g);
    host.mutated(g, before);
    return true;
  }
  return {
    grantPowerUp(kind) {
      if (!CATALOG_ORDER.includes(kind)) throw new TypeError(`unknown power-up kind: ${String(kind)}`);
      return mutate((g) => applyPowerUp(g, kind));
    },
    releaseEnemies() {
      return mutate((g) => {
        for (const e of g.enemies) if (e.mode === 'pen') e.releaseIn = 0;
      });
    },
    setInvulnerable(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) throw new TypeError('setInvulnerable expects a non-negative integer');
      return mutate((g) => {
        g.player.invuln = ticks;
      });
    },
    forceGameOver() {
      return mutate((g) => forceGameOver(g));
    },
    getScreen: () => host.screen(),
    getScore: () => host.score(),
    getLastSubmission: () => {
      const s = host.lastSubmission();
      return s === null ? null : { seed: s.seed, inputLog: s.inputLog.map(([t, d]) => [t, d]), claimedScore: s.claimedScore };
    },
  };
}
