import { describe, expect, it } from 'vitest';
import type { Screen } from '../arcade/cabinet';
import { directionForKey, mapKey } from './keyboard';

const OTHER_SCREENS: Screen[] = ['attract', 'playing', 'incident', 'highscores'];
const ALL_SCREENS: Screen[] = [...OTHER_SCREENS, 'initials'];

describe('mapKey on initials', () => {
  it('C, M, P, W, A, S, D (either case) map only to initialsKey({char})', () => {
    for (const ch of ['C', 'M', 'P', 'W', 'A', 'S', 'D', 'c', 'm', 'p', 'w', 'a', 's', 'd']) {
      expect(mapKey('initials', ch)).toEqual({ type: 'initialsKey', key: { char: ch } });
    }
  });

  it('every letter A-Z types', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') {
      expect(mapKey('initials', ch)).toEqual({ type: 'initialsKey', key: { char: ch } });
    }
  });

  it('5 is the coin key', () => {
    expect(mapKey('initials', '5')).toEqual({ type: 'coin' });
  });

  it('Arrows navigate and Enter confirms', () => {
    expect(mapKey('initials', 'ArrowUp')).toEqual({ type: 'initialsKey', key: 'up' });
    expect(mapKey('initials', 'ArrowDown')).toEqual({ type: 'initialsKey', key: 'down' });
    expect(mapKey('initials', 'ArrowLeft')).toEqual({ type: 'initialsKey', key: 'left' });
    expect(mapKey('initials', 'ArrowRight')).toEqual({ type: 'initialsKey', key: 'right' });
    expect(mapKey('initials', 'Enter')).toEqual({ type: 'initialsKey', key: 'enter' });
  });

  it('everything else is ignored', () => {
    for (const key of ['1', '0', ' ', 'Escape', 'Shift', 'Ä', 'é', 'Tab', 'F5', 'Backspace']) {
      expect(mapKey('initials', key)).toBeNull();
    }
  });
});

describe('mapKey on other screens', () => {
  it('C and 5 insert a coin and M mutes on every non-initials screen', () => {
    for (const screen of OTHER_SCREENS) {
      expect(mapKey(screen, 'c')).toEqual({ type: 'coin' });
      expect(mapKey(screen, 'C')).toEqual({ type: 'coin' });
      expect(mapKey(screen, '5')).toEqual({ type: 'coin' });
      expect(mapKey(screen, 'm')).toEqual({ type: 'mute' });
      expect(mapKey(screen, 'M')).toEqual({ type: 'mute' });
    }
  });

  it('5 is a coin on every screen', () => {
    for (const screen of ALL_SCREENS) expect(mapKey(screen, '5')).toEqual({ type: 'coin' });
  });

  it('Arrows and WASD steer only while playing', () => {
    const cases: Array<[string, number]> = [
      ['ArrowUp', 1],
      ['ArrowRight', 2],
      ['ArrowDown', 3],
      ['ArrowLeft', 4],
      ['w', 1],
      ['D', 2],
      ['s', 3],
      ['A', 4],
    ];
    for (const [key, dir] of cases) {
      expect(mapKey('playing', key)).toEqual({ type: 'dir', dir });
      for (const screen of ['attract', 'incident', 'highscores'] as const) expect(mapKey(screen, key)).toBeNull();
    }
  });

  it('P pauses only while playing', () => {
    expect(mapKey('playing', 'p')).toEqual({ type: 'pause' });
    expect(mapKey('playing', 'P')).toEqual({ type: 'pause' });
    expect(mapKey('attract', 'p')).toBeNull();
    expect(mapKey('highscores', 'P')).toBeNull();
  });

  it('Enter starts on attract, confirms on incident and highscores, and does nothing while playing', () => {
    expect(mapKey('attract', 'Enter')).toEqual({ type: 'start' });
    expect(mapKey('incident', 'Enter')).toEqual({ type: 'confirm' });
    expect(mapKey('highscores', 'Enter')).toEqual({ type: 'confirm' });
    expect(mapKey('playing', 'Enter')).toBeNull();
  });

  it('other letters do nothing', () => {
    for (const screen of OTHER_SCREENS) {
      expect(mapKey(screen, 'x')).toBeNull();
      expect(mapKey(screen, 'Q')).toBeNull();
    }
  });
});

describe('directionForKey', () => {
  it('maps Arrows and WASD and nothing else', () => {
    expect(directionForKey('ArrowLeft')).toBe(4);
    expect(directionForKey('W')).toBe(1);
    expect(directionForKey('x')).toBeNull();
    expect(directionForKey('Arrow')).toBeNull();
  });
});
