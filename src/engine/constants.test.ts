import { describe, expect, it } from 'vitest';
import { CATALOG_ORDER, ENEMY_ORDER, MAX_TICKS, TILE_UNITS, difficulty } from './constants';

describe('constants', () => {
  it('pins the binding orders and limits', () => {
    expect(ENEMY_ORDER).toEqual(['latency', 'throttle', 'coldstart', 'outage']);
    expect(CATALOG_ORDER).toEqual(['lambda', 'shield', 'autoscaling', 'cloudfront', 'cloudwatch']);
    expect(MAX_TICKS).toBe(108000);
    expect(TILE_UNITS).toBe(256);
  });

  it('level 1 matches overview §5.5', () => {
    expect(difficulty(1)).toEqual({
      speeds: { latency: 22, throttle: 29, coldstart: 46, outage: 26 },
      releaseDelays: { latency: 0, throttle: 180, coldstart: 360, outage: 540 },
      coldFrozen: 180,
    });
  });

  it('level 2 enemies are faster, released sooner and freeze shorter than level 1', () => {
    const l1 = difficulty(1);
    const l2 = difficulty(2);
    for (const id of ENEMY_ORDER) expect(l2.speeds[id]).toBeGreaterThan(l1.speeds[id]);
    for (const id of ['throttle', 'coldstart', 'outage'] as const) {
      expect(l2.releaseDelays[id]).toBeLessThan(l1.releaseDelays[id]);
    }
    expect(l2.coldFrozen).toBeLessThan(l1.coldFrozen);
  });

  it('difficulty increases up to level 7 and then stops', () => {
    for (let level = 2; level <= 7; level++) {
      expect(difficulty(level).speeds.latency).toBe(difficulty(level - 1).speeds.latency + 1);
    }
    expect(difficulty(7)).toEqual({
      speeds: { latency: 28, throttle: 35, coldstart: 52, outage: 32 },
      releaseDelays: { latency: 0, throttle: 90, coldstart: 180, outage: 270 },
      coldFrozen: 90,
    });
    expect(difficulty(8)).toEqual(difficulty(7));
    expect(difficulty(50)).toEqual(difficulty(7));
  });
});
