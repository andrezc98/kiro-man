/**
 * Accessibility (AP-7.1): the canvas keeps `role="img"` with a label describing the current screen, and a
 * visually hidden `aria-live="polite"` region announces screen changes, every 1000-point milestone, and
 * game over. The text builders are pure so they can be unit tested.
 */
import { rootCause } from '../arcade/cabinet';
import type { CabinetState } from '../arcade/cabinet';

export const MILESTONE_STEP = 1000;

/** The highest multiple of `step` crossed going from `prev` to `next`, or null if none. */
export function milestoneCrossed(prev: number, next: number, step = MILESTONE_STEP): number | null {
  const a = Math.floor(prev / step);
  const b = Math.floor(next / step);
  return b > a && b > 0 ? b * step : null;
}

function creditsText(n: number): string {
  return `${n} credit${n === 1 ? '' : 's'}`;
}

/** What the live region says when the cabinet enters `cab.screen`. */
export function screenAnnouncement(cab: CabinetState): string {
  switch (cab.screen) {
    case 'attract':
      return `KIRO-MAN attract mode. ${creditsText(cab.credits)}. Press C or 5 to insert a coin, Enter to start.`;
    case 'playing':
      return 'Game started. Move with the arrow keys or W A S D. P pauses, M mutes.';
    case 'incident': {
      const s = cab.summary;
      if (s === null) return 'Game over.';
      return `Game over. Incident report: ${rootCause(s).toLowerCase()}. Final score ${s.score}, level ${s.level}. Press Enter to continue.`;
    }
    case 'initials':
      return 'New high score. Type three letters for your initials, or use the arrow keys, then press Enter.';
    case 'highscores':
      return `High scores. ${remoteText(cab)} Press Enter to return.`;
  }
}

function remoteText(cab: CabinetState): string {
  switch (cab.remoteStatus) {
    case 'submitting':
      return 'Submitting to the global leaderboard.';
    case 'verified':
      return 'Global score verified.';
    case 'rejected':
      return `Global score rejected${cab.remoteDetail === null ? '' : ` (${cab.remoteDetail.toLowerCase()})`}.`;
    case 'offline':
      return 'Global leaderboard offline.';
    case 'idle':
      return 'Not submitted to the global leaderboard.';
  }
}

/** Canvas `aria-label` for the current screen. */
export function canvasLabel(cab: CabinetState): string {
  const names: Record<CabinetState['screen'], string> = {
    attract: 'title and attract mode',
    playing: 'game in progress',
    incident: 'incident report',
    initials: 'initials entry',
    highscores: 'high score table',
  };
  return `KIRO-MAN arcade screen: ${names[cab.screen]}, ${creditsText(cab.credits)}`;
}

export interface Announcer {
  announce(text: string): void;
}

/** Writes to the live region; identical consecutive messages are re-announced by clearing first. */
export function createAnnouncer(el: { textContent: string | null } | null): Announcer {
  return {
    announce(text) {
      if (el === null) return;
      if (el.textContent === text) el.textContent = '';
      el.textContent = text;
    },
  };
}
