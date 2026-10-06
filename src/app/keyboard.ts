/**
 * Per-screen key mapping (binding, coin-credit-system design "Keyboard → event mapping", overview §6).
 * `key` is a `KeyboardEvent.key` value. On `initials` every letter types (no hotkeys), only the Arrow keys
 * navigate, Enter confirms, and `5` is the only coin key. On every other screen C/5 insert a coin and M
 * mutes; P and Arrows/WASD only mean something while playing; Enter starts on attract and confirms on the
 * incident and high-score screens.
 */
import type { Screen } from '../arcade/cabinet';
import type { InitialsKey } from '../arcade/initials';
import type { Dir } from '../engine';

export type AppAction =
  | { type: 'coin' }
  | { type: 'mute' }
  | { type: 'pause' }
  | { type: 'dir'; dir: Dir }
  /** The app attaches the seed (crypto, or the QA seed) before dispatching `start`. */
  | { type: 'start' }
  | { type: 'confirm' }
  | { type: 'initialsKey'; key: InitialsKey };

const ARROW_DIRS: Readonly<Record<string, Dir>> = { ArrowUp: 1, ArrowRight: 2, ArrowDown: 3, ArrowLeft: 4 };
const WASD_DIRS: Readonly<Record<string, Dir>> = { w: 1, d: 2, s: 3, a: 4 };
const ARROW_INITIALS: Readonly<Record<string, InitialsKey>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const LETTER_RE = /^[a-zA-Z]$/;

/** The movement direction for a key while playing (Arrows and WASD, either case), or null. */
export function directionForKey(key: string): Dir | null {
  return ARROW_DIRS[key] ?? (key.length === 1 ? (WASD_DIRS[key.toLowerCase()] ?? null) : null);
}

export function mapKey(screen: Screen, key: string): AppAction | null {
  if (screen === 'initials') {
    if (LETTER_RE.test(key)) return { type: 'initialsKey', key: { char: key } };
    const nav = ARROW_INITIALS[key];
    if (nav !== undefined) return { type: 'initialsKey', key: nav };
    if (key === 'Enter') return { type: 'initialsKey', key: 'enter' };
    if (key === '5') return { type: 'coin' };
    return null;
  }
  if (key === 'c' || key === 'C' || key === '5') return { type: 'coin' };
  if (key === 'm' || key === 'M') return { type: 'mute' };
  if (screen === 'playing') {
    if (key === 'p' || key === 'P') return { type: 'pause' };
    const dir = directionForKey(key);
    return dir === null ? null : { type: 'dir', dir };
  }
  if (key === 'Enter') {
    if (screen === 'attract') return { type: 'start' };
    if (screen === 'incident' || screen === 'highscores') return { type: 'confirm' };
  }
  return null;
}
