/**
 * Initials-entry reducer (CC-7). Letters are stored as indices 0..25, so `initialsString` can only ever
 * produce `^[A-Z]{3}$` (CC-7.4); this module owns that invariant (ranking.ts re-checks it on insert).
 */

/** Auto-confirm after this many UI ticks on the initials screen without a confirm (CC-7.3). */
export const INITIALS_TIMEOUT_TICKS = 1800;

export interface InitialsState {
  letters: [number, number, number];
  cursor: 0 | 1 | 2;
  /** UI ticks spent on the screen so far. */
  idle: number;
  done: boolean;
}

export type InitialsKey = 'up' | 'down' | 'left' | 'right' | 'enter' | { char: string } | 'tick';

const LETTER_RE = /^[A-Za-z]$/;
const ALPHABET = 26;

/** Three slots starting at "AAA", cursor on the first slot (CC-7.1). */
export function initialInitials(): InitialsState {
  return { letters: [0, 0, 0], cursor: 0, idle: 0, done: false };
}

function setLetter(letters: InitialsState['letters'], slot: 0 | 1 | 2, value: number): InitialsState['letters'] {
  const next: InitialsState['letters'] = [letters[0], letters[1], letters[2]];
  next[slot] = value;
  return next;
}

function cycle(value: number, delta: number): number {
  return (value + delta + ALPHABET) % ALPHABET;
}

/** Pure and total; returns a new state. Once `done`, every key is ignored. */
export function initialsReduce(s: InitialsState, k: InitialsKey): InitialsState {
  if (s.done) return s;
  if (typeof k === 'object') {
    if (!LETTER_RE.test(k.char)) return s;
    const value = k.char.toUpperCase().charCodeAt(0) - 65;
    const cursor = s.cursor === 2 ? 2 : ((s.cursor + 1) as 1 | 2);
    return { ...s, letters: setLetter(s.letters, s.cursor, value), cursor };
  }
  switch (k) {
    case 'up':
      return { ...s, letters: setLetter(s.letters, s.cursor, cycle(s.letters[s.cursor], 1)) };
    case 'down':
      return { ...s, letters: setLetter(s.letters, s.cursor, cycle(s.letters[s.cursor], -1)) };
    case 'left':
      return s.cursor === 0 ? s : { ...s, cursor: (s.cursor - 1) as 0 | 1 };
    case 'right':
      return s.cursor === 2 ? s : { ...s, cursor: (s.cursor + 1) as 1 | 2 };
    case 'enter':
      return { ...s, done: true };
    case 'tick': {
      const idle = s.idle + 1;
      return { ...s, idle, done: idle >= INITIALS_TIMEOUT_TICKS };
    }
  }
}

/** Always matches `^[A-Z]{3}$`. */
export function initialsString(s: InitialsState): string {
  return s.letters.map((i) => String.fromCharCode(65 + (((i % ALPHABET) + ALPHABET) % ALPHABET))).join('');
}
