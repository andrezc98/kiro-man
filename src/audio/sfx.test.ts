import { describe, expect, it, vi } from 'vitest';
import { EAT_NOTES, PEAK_GAIN, SOUNDS, createSfx, soundsForEvents } from './sfx';
import type { AudioContextLike, SoundName } from './sfx';

interface FakeAudio {
  ctx: AudioContextLike;
  oscillators: { type: string; freqs: number[]; started: number; stopped: number }[];
  peakGains: number[];
  resumes: number;
}

function fakeAudio(state = 'running'): FakeAudio {
  const rec: FakeAudio = { ctx: null as unknown as AudioContextLike, oscillators: [], peakGains: [], resumes: 0 };
  const param = (onSet: (v: number) => void) => ({
    setValueAtTime: (v: number) => onSet(v),
    linearRampToValueAtTime: (v: number) => onSet(v),
  });
  rec.ctx = {
    currentTime: 1,
    destination: {},
    state,
    resume: () => {
      rec.resumes++;
      return Promise.resolve();
    },
    createOscillator() {
      const o = { type: 'sine', freqs: [] as number[], started: -1, stopped: -1 };
      rec.oscillators.push(o);
      return {
        get type() {
          return o.type;
        },
        set type(v: string) {
          o.type = v;
        },
        frequency: param((v) => o.freqs.push(v)),
        connect: () => undefined,
        start: (t: number) => {
          o.started = t;
        },
        stop: (t: number) => {
          o.stopped = t;
        },
      };
    },
    createGain() {
      return { gain: param((v) => rec.peakGains.push(v)), connect: () => undefined };
    },
  };
  return rec;
}

const ALL: SoundName[] = [
  'coin',
  'denied',
  'start',
  'eat',
  'powerUp',
  'shieldBlock',
  'warp',
  'cloneSpawn',
  'death',
  'levelClear',
  'gameOver',
];

describe('sfx', () => {
  it('defines a square/triangle note table for every sound', () => {
    for (const notes of Object.values(SOUNDS)) {
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(['square', 'triangle']).toContain(n.type);
        expect(n.freq).toBeGreaterThan(0);
        expect(n.durMs).toBeGreaterThan(0);
      }
    }
  });

  it('schedules one oscillator per note, in order, with a gain envelope that never exceeds PEAK_GAIN (0.18)', () => {
    const a = fakeAudio();
    const sfx = createSfx(() => a.ctx);
    sfx.resume();
    for (const name of ALL) sfx.play(name);
    const expected = ALL.reduce((n, s) => n + (s === 'eat' ? 1 : SOUNDS[s as Exclude<SoundName, 'eat'>].length), 0);
    expect(a.oscillators).toHaveLength(expected);
    for (const o of a.oscillators) {
      expect(['square', 'triangle']).toContain(o.type);
      expect(o.stopped).toBeGreaterThan(o.started);
      expect(o.started).toBeGreaterThanOrEqual(1);
    }
    expect(Math.max(...a.peakGains.filter((g) => g !== 1))).toBe(PEAK_GAIN);
  });

  it('routes every oscillator through its envelope into a master gain of 1 that is connected to destination', () => {
    const destination = { name: 'destination' };
    const edges = new Map<object, object[]>();
    const gainValues = new Map<object, number[]>();
    const oscillators: object[] = [];
    const node = (extra: Record<string, unknown>): object => {
      const n: Record<string, unknown> = { ...extra };
      n.connect = (to: object) => {
        edges.set(n, [...(edges.get(n) ?? []), to]);
        return to;
      };
      return n;
    };
    const param = { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined };
    const ctx: AudioContextLike = {
      currentTime: 0,
      destination,
      state: 'running',
      resume: () => Promise.resolve(),
      createOscillator() {
        const o = node({ type: 'sine', frequency: param, start: () => undefined, stop: () => undefined });
        oscillators.push(o);
        return o as never;
      },
      createGain() {
        const values: number[] = [];
        const g = node({
          gain: { setValueAtTime: (v: number) => values.push(v), linearRampToValueAtTime: (v: number) => values.push(v) },
        });
        gainValues.set(g, values);
        return g as never;
      },
    };
    const sfx = createSfx(() => ctx);
    sfx.resume();
    sfx.play('coin');
    expect(oscillators).toHaveLength(2);
    const masters = [...gainValues.keys()].filter((g) => edges.get(g)?.includes(destination));
    expect(masters).toHaveLength(1);
    const master = masters[0] as object;
    expect(gainValues.get(master)).toEqual([1]);
    for (const o of oscillators) {
      const envs = edges.get(o) ?? [];
      expect(envs).toHaveLength(1);
      const env = envs[0] as object;
      expect(edges.get(env)).toEqual([master]);
      // The envelope rises to PEAK_GAIN, holds near it, and only then falls to 0.
      expect(gainValues.get(env)).toEqual([0, PEAK_GAIN, PEAK_GAIN * 0.6, 0]);
    }
  });

  it('alternates the two bug pitches', () => {
    const a = fakeAudio();
    const sfx = createSfx(() => a.ctx);
    sfx.play('eat');
    sfx.play('eat');
    sfx.play('eat');
    expect(a.oscillators.map((o) => o.freqs[0])).toEqual([EAT_NOTES[0].freq, EAT_NOTES[1].freq, EAT_NOTES[0].freq]);
  });

  it('mute silences everything until unmuted', () => {
    const a = fakeAudio();
    const sfx = createSfx(() => a.ctx);
    expect(sfx.toggleMute()).toBe(true);
    expect(sfx.muted).toBe(true);
    for (const name of ALL) sfx.play(name);
    expect(a.oscillators).toHaveLength(0);
    expect(sfx.toggleMute()).toBe(false);
    sfx.play('coin');
    expect(a.oscillators.length).toBeGreaterThan(0);
    sfx.setMuted(true);
    expect(sfx.muted).toBe(true);
  });

  it('creates the context lazily and resumes a suspended one', () => {
    const a = fakeAudio('suspended');
    const factory = vi.fn(() => a.ctx);
    const sfx = createSfx(factory);
    expect(factory).not.toHaveBeenCalled();
    sfx.resume();
    sfx.resume();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a.resumes).toBe(2);
  });

  it('is a silent no-op without WebAudio, logging once', () => {
    const info = vi.fn();
    const sfx = createSfx(() => null, info);
    sfx.resume();
    for (const name of ALL) expect(() => sfx.play(name)).not.toThrow();
    expect(sfx.available).toBe(false);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('survives a factory that throws (blocked context)', () => {
    const info = vi.fn();
    const sfx = createSfx(() => {
      throw new Error('NotAllowedError');
    }, info);
    expect(() => sfx.resume()).not.toThrow();
    expect(() => sfx.play('coin')).not.toThrow();
    expect(sfx.available).toBe(false);
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('soundsForEvents', () => {
  it('maps engine events to sounds, with one eat per step and none on a death step', () => {
    expect(
      soundsForEvents([
        { type: 'bug', at: { x: 1, y: 1 }, by: 'player' },
        { type: 'bug', at: { x: 2, y: 1 }, by: 'clone' },
      ]),
    ).toEqual(['eat']);
    expect(
      soundsForEvents([
        { type: 'bug', at: { x: 1, y: 1 }, by: 'player' },
        { type: 'death', enemy: 'latency' },
      ]),
    ).toEqual(['death']);
    expect(
      soundsForEvents([
        { type: 'powerUpPickup', kind: 'autoscaling' },
        { type: 'cloneSpawn', at: { x: 1, y: 1 } },
        { type: 'shieldBlock', enemy: 'throttle' },
        { type: 'warp', from: 0, to: 1 },
        { type: 'levelClear', level: 1, bonus: 500 },
        { type: 'gameOver', reason: 'caught' },
        { type: 'powerUpSpawn', kind: 'lambda', at: { x: 1, y: 1 } },
      ]),
    ).toEqual(['powerUp', 'shieldBlock', 'cloneSpawn', 'warp', 'levelClear', 'gameOver']);
    expect(soundsForEvents([])).toEqual([]);
  });
});
