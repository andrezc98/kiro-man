import { describe, expect, it } from 'vitest';
import { initialCabinet } from '../arcade/cabinet';
import type { CabinetState, GameSummary } from '../arcade/cabinet';
import { canvasLabel, createAnnouncer, milestoneCrossed, screenAnnouncement } from './a11y';

const summary: GameSummary = {
  seed: 1,
  score: 2500,
  level: 2,
  bugsEaten: 10,
  servicesUsed: { lambda: 0, shield: 0, autoscaling: 0, cloudfront: 0, cloudwatch: 0 },
  lastKiller: 'throttle',
  gameOverReason: 'caught',
  inputLog: [],
  tainted: false,
};

function on(screen: CabinetState['screen'], over: Partial<CabinetState> = {}): CabinetState {
  return { ...initialCabinet(true), screen, ...over };
}

describe('a11y', () => {
  it('announces each 1000-point milestone once', () => {
    expect(milestoneCrossed(990, 1000)).toBe(1000);
    expect(milestoneCrossed(1000, 1010)).toBeNull();
    expect(milestoneCrossed(1990, 3010)).toBe(3000);
    expect(milestoneCrossed(0, 999)).toBeNull();
    expect(milestoneCrossed(500, 500)).toBeNull();
  });

  it('describes every screen, including game over with the root cause', () => {
    expect(screenAnnouncement(on('attract', { credits: 1 }))).toContain('1 credit.');
    expect(screenAnnouncement(on('attract', { credits: 2 }))).toContain('2 credits');
    expect(screenAnnouncement(on('playing'))).toContain('Game started');
    const over = screenAnnouncement(on('incident', { summary }));
    expect(over).toContain('Game over');
    expect(over).toContain('throttle caught kiro');
    expect(over).toContain('2500');
    expect(screenAnnouncement(on('incident'))).toBe('Game over.');
    expect(screenAnnouncement(on('initials'))).toContain('initials');
    expect(screenAnnouncement(on('highscores', { remoteStatus: 'verified' }))).toContain('verified');
    expect(screenAnnouncement(on('highscores', { remoteStatus: 'rejected', remoteDetail: 'LOG TOO LONG' }))).toContain(
      'log too long',
    );
    expect(screenAnnouncement(on('highscores', { remoteStatus: 'offline' }))).toContain('offline');
  });

  it('labels the canvas with the screen and credits', () => {
    expect(canvasLabel(on('playing', { credits: 3 }))).toBe('KIRO-MAN arcade screen: game in progress, 3 credits');
  });

  it('re-announces identical messages by clearing the region first', () => {
    const el = { textContent: '' as string | null };
    const writes: (string | null)[] = [];
    const proxy = {
      get textContent() {
        return el.textContent;
      },
      set textContent(v: string | null) {
        writes.push(v);
        el.textContent = v;
      },
    };
    const a = createAnnouncer(proxy);
    a.announce('Paused.');
    a.announce('Paused.');
    expect(writes).toEqual(['Paused.', '', 'Paused.']);
    expect(() => createAnnouncer(null).announce('x')).not.toThrow();
  });
});
