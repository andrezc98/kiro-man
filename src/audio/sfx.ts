/**
 * WebAudio sound effects (AP-5). Each sound is a short table of square/triangle notes scheduled on the
 * context clock with a 0.18 gain envelope (no clicks), through one master gain. The context comes from
 * an injected factory, created on the first key press (`resume`), so autoplay rules are respected and
 * tests can pass a fake. With no context (unsupported or blocked) every call is a silent no-op.
 */
import type { SfxName } from '../arcade/cabinet';
import type { GameEvent } from '../engine';

/** Cabinet sounds plus the two engine-only ones. */
export type SoundName = SfxName | 'warp' | 'cloneSpawn';

export interface Note {
  freq: number;
  durMs: number;
  type: 'square' | 'triangle';
  /** Glide to this frequency over the note. */
  slideTo?: number;
}

interface ParamLike {
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}

interface NodeLike {
  connect(n: unknown): unknown;
}

export interface OscillatorLike extends NodeLike {
  type: string;
  frequency: ParamLike;
  start(t: number): void;
  stop(t: number): void;
}

export interface GainLike extends NodeLike {
  gain: ParamLike;
}

/** The subset of `AudioContext` this module uses. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state: string;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export const PEAK_GAIN = 0.18;

const sq = (freq: number, durMs: number, slideTo?: number): Note =>
  slideTo === undefined ? { freq, durMs, type: 'square' } : { freq, durMs, type: 'square', slideTo };
const tri = (freq: number, durMs: number, slideTo?: number): Note =>
  slideTo === undefined ? { freq, durMs, type: 'triangle' } : { freq, durMs, type: 'triangle', slideTo };

/** Every sound's note table. `eat` alternates between its two entries (AP-5.2). */
export const SOUNDS: Readonly<Record<Exclude<SoundName, 'eat'>, readonly Note[]>> = {
  coin: [sq(988, 60), sq(1319, 180)],
  denied: [sq(196, 90), sq(147, 160)],
  start: [sq(523, 80), sq(659, 80), sq(784, 80), sq(1047, 200)],
  powerUp: [sq(400, 180, 1200), sq(1600, 70)],
  shieldBlock: [sq(1200, 40), tri(600, 140, 200)],
  warp: [tri(200, 150, 1400), tri(1400, 120, 300)],
  cloneSpawn: [tri(660, 60), tri(880, 60), tri(1320, 90)],
  death: [
    tri(784, 70),
    tri(740, 70),
    tri(698, 70),
    tri(659, 70),
    tri(622, 70),
    tri(587, 70),
    tri(554, 70),
    tri(523, 120, 110),
    sq(200, 50),
    sq(150, 80),
  ],
  levelClear: [sq(523, 100), sq(659, 100), sq(784, 100), sq(1047, 100), sq(784, 100), sq(1047, 260)],
  gameOver: [tri(392, 200), tri(330, 200), tri(262, 200), tri(131, 500)],
};

export const EAT_NOTES: readonly [Note, Note] = [tri(520, 35, 300), tri(300, 35, 520)];

/** Sounds for one engine step's events, in a stable order; at most one `eat`, none on a death step. */
export function soundsForEvents(events: readonly GameEvent[]): SoundName[] {
  const out: SoundName[] = [];
  const has = (t: GameEvent['type']): boolean => events.some((e) => e.type === t);
  const dead = has('death');
  if (has('bug') && !dead) out.push('eat');
  if (has('powerUpPickup')) out.push('powerUp');
  if (has('shieldBlock')) out.push('shieldBlock');
  if (has('cloneSpawn')) out.push('cloneSpawn');
  if (has('warp')) out.push('warp');
  if (dead) out.push('death');
  if (has('levelClear')) out.push('levelClear');
  if (has('gameOver')) out.push('gameOver');
  return out;
}

export interface Sfx {
  /** Create or resume the context; call on every key press (cheap after the first). */
  resume(): void;
  play(name: SoundName): void;
  toggleMute(): boolean;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  /** False once the factory returned null or threw. */
  readonly available: boolean;
}

export function createSfx(
  factory: () => AudioContextLike | null,
  info: (m: string) => void = (m) => console.info(m),
): Sfx {
  let ctx: AudioContextLike | null = null;
  let master: GainLike | null = null;
  let tried = false;
  let failed = false;
  let muted = false;
  let eatToggle = 0;

  function unavailable(reason: string): void {
    if (!failed) info(`audio disabled: ${reason}`);
    failed = true;
    ctx = null;
    master = null;
  }

  function ensure(): AudioContextLike | null {
    if (ctx !== null || failed) return ctx;
    if (!tried) {
      tried = true;
      try {
        const c = factory();
        if (c === null) {
          unavailable('WebAudio is not supported');
          return null;
        }
        const m = c.createGain();
        m.gain.setValueAtTime(1, c.currentTime);
        m.connect(c.destination);
        ctx = c;
        master = m;
      } catch (e) {
        unavailable(e instanceof Error ? e.message : String(e));
      }
    }
    return ctx;
  }

  function resumeIfSuspended(c: AudioContextLike): void {
    if (c.state !== 'suspended') return;
    c.resume().catch((e: unknown) => unavailable(`resume failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  function schedule(c: AudioContextLike, out: GainLike, notes: readonly Note[]): void {
    let t = c.currentTime + 0.005;
    for (const n of notes) {
      const dur = n.durMs / 1000;
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, t);
      if (n.slideTo !== undefined) osc.frequency.linearRampToValueAtTime(n.slideTo, t + dur);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(PEAK_GAIN, t + Math.min(0.005, dur / 4));
      env.gain.linearRampToValueAtTime(PEAK_GAIN * 0.6, t + dur * 0.7);
      env.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(env);
      env.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.01);
      t += dur;
    }
  }

  return {
    resume() {
      const c = ensure();
      if (c !== null) resumeIfSuspended(c);
    },
    play(name) {
      if (muted) return;
      const c = ensure();
      if (c === null || master === null) return;
      resumeIfSuspended(c);
      let notes: readonly Note[];
      if (name === 'eat') {
        notes = [EAT_NOTES[eatToggle] as Note];
        eatToggle ^= 1;
      } else {
        notes = SOUNDS[name];
      }
      try {
        schedule(c, master, notes);
      } catch (e) {
        unavailable(e instanceof Error ? e.message : String(e));
      }
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    setMuted(m) {
      muted = m;
    },
    get muted() {
      return muted;
    },
    get available() {
      return !failed;
    },
  };
}
