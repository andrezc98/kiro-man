/**
 * Fixed-timestep loop (AP-6.1): an accumulator over `requestAnimationFrame` runs whole 60 Hz steps and
 * renders once per frame. At most `maxSteps` steps run per frame; any backlog beyond that (a stalled
 * tab, a debugger pause) is dropped instead of spiraling. `now` and `raf` are injected for tests.
 */

export interface LoopOpts {
  now: () => number;
  raf: (cb: (t: number) => void) => unknown;
  stepHz?: number;
  maxSteps?: number;
  onStep: () => void;
  /** `alpha` is the leftover fraction of a step in the accumulator (0..1). */
  onRender: (alpha: number) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
  /** Runs one frame's worth of work for `t` (ms); exposed for tests. Returns the steps taken. */
  frame(t: number): number;
  readonly running: boolean;
}

export function createLoop(opts: LoopOpts): Loop {
  const stepMs = 1000 / (opts.stepHz ?? 60);
  const maxSteps = opts.maxSteps ?? 5;
  let acc = 0;
  let last: number | null = null;
  let running = false;

  function frame(t: number): number {
    if (last === null) last = t;
    const dt = Math.max(0, t - last);
    last = t;
    acc += dt;
    let steps = 0;
    // The epsilon absorbs float drift so 60 frames of 1000/60 ms give exactly 60 steps.
    while (acc + 1e-6 >= stepMs && steps < maxSteps) {
      opts.onStep();
      acc -= stepMs;
      steps++;
    }
    // Drop the backlog after a stall so the next frame does not try to catch up.
    if (steps === maxSteps && acc >= stepMs) acc = 0;
    if (acc < 0) acc = 0;
    opts.onRender(acc / stepMs);
    return steps;
  }

  function tick(t: number): void {
    if (!running) return;
    frame(t);
    opts.raf(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = opts.now();
      opts.raf(tick);
    },
    stop() {
      running = false;
    },
    frame,
    get running() {
      return running;
    },
  };
}
