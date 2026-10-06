# Fixed-timestep loop

The simulation advances in whole steps at a fixed rate (60 Hz). The browser's `requestAnimationFrame` fires at the display's rate (60, 120, 144 Hz, or slower when the tab is busy), so the loop has to translate wall-clock frames into a whole number of simulation steps. Variable-delta updates (`position += speed * dt`) are not deterministic and cannot be replayed; a fixed step can.

## The accumulator loop

```ts
export interface LoopOpts {
  now: () => number;                          // performance.now in the browser, a fake in tests
  raf: (cb: (t: number) => void) => unknown;  // requestAnimationFrame in the browser
  stepHz?: number;                            // default 60
  maxSteps?: number;                          // default 5: the spiral-of-death cap
  onStep: () => void;                         // one simulation step
  onRender: (alpha: number) => void;          // leftover fraction of a step, 0..1
}

export function createLoop(opts: LoopOpts) {
  const stepMs = 1000 / (opts.stepHz ?? 60);
  const maxSteps = opts.maxSteps ?? 5;
  let acc = 0;
  let last: number | null = null;
  let running = false;

  function frame(t: number): number {
    if (last === null) last = t;
    const dt = Math.max(0, t - last);   // clocks can go backwards across tab switches
    last = t;
    acc += dt;
    let steps = 0;
    // The epsilon absorbs float drift so 60 frames of 1000/60 ms give exactly 60 steps.
    while (acc + 1e-6 >= stepMs && steps < maxSteps) {
      opts.onStep();
      acc -= stepMs;
      steps++;
    }
    // After a stall, drop the backlog instead of trying to catch up (no spiral of death).
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
    stop() { running = false; },
    frame, // exposed for tests
  };
}
```

Wire it up in the shell only:

```ts
const loop = createLoop({
  now: () => performance.now(),
  raf: (cb) => window.requestAnimationFrame(cb),
  onStep: () => app.step(),            // read held input, record it, step the engine
  onRender: () => renderer.draw(app.view()),
});
loop.start();
```

## Input inside the step, not inside the event handler

Key handlers only update a "held direction" stack. The step callback reads it once per step, records a change in the input log, then calls the engine:

```ts
function stepOnce(): void {
  const dir = dirStack.current();     // most recently pressed direction still held, or 0
  recorder.record(state.tick, dir);   // pushes [tick, dir] only when it changed
  step(state, dir);
}
```

This is what makes a recording exactly reproducible: the engine only ever sees one direction per tick, and the log says which.

## Pausing and hidden tabs

- On `visibilitychange` to hidden, stop stepping (or set a paused flag the step callback honors). The accumulator clamp means returning to the tab does not fast-forward.
- A pause key toggles the same flag. The renderer keeps drawing so a "PAUSED" banner can show.

## Rendering between steps

Movement looks smooth at 60 Hz without interpolating between steps when the display is also 60 Hz. For higher refresh rates, draw at `previous + (current - previous) * alpha`. Keep it in the renderer; the simulation never sees `alpha`.

## Testing the loop

Inject `now` and `raf` and drive `frame(t)` directly:

```ts
it('runs exactly 60 steps for 60 frames at 60 Hz', () => {
  let steps = 0;
  const loop = createLoop({ now: () => 0, raf: () => 0, onStep: () => steps++, onRender: () => {} });
  for (let i = 0; i <= 60; i++) loop.frame((i * 1000) / 60);
  expect(steps).toBe(60);
});

it('caps a stall at maxSteps and drops the backlog', () => {
  let steps = 0;
  const loop = createLoop({ now: () => 0, raf: () => 0, onStep: () => steps++, onRender: () => {} });
  loop.frame(0);
  expect(loop.frame(10_000)).toBe(5);
  expect(loop.frame(10_000 + 1000 / 60)).toBe(1);
});
```

## Checklist

- [ ] The engine has no notion of milliseconds; only ticks.
- [ ] The loop caps steps per frame and drops the backlog.
- [ ] Input is sampled once per step and recorded only on change.
- [ ] Hidden tabs and pause stop stepping.
- [ ] `now` and `raf` are injected so the loop is unit tested.
