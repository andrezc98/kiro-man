import { describe, expect, it } from 'vitest';
import { createLoop } from './loop';

function harness() {
  let steps = 0;
  const alphas: number[] = [];
  const queued: ((t: number) => void)[] = [];
  const loop = createLoop({
    now: () => 0,
    raf: (cb) => queued.push(cb),
    onStep: () => {
      steps++;
    },
    onRender: (a) => alphas.push(a),
  });
  return { loop, queued, alphas, steps: () => steps };
}

describe('fixed-timestep loop', () => {
  it('runs one 60 Hz step per 16.67 ms and renders once per frame', () => {
    const h = harness();
    h.loop.frame(0);
    for (let i = 1; i <= 60; i++) h.loop.frame((i * 1000) / 60);
    expect(h.steps()).toBe(60);
    expect(h.alphas).toHaveLength(61);
  });

  it('accumulates short frames (120 Hz display)', () => {
    const h = harness();
    h.loop.frame(0);
    for (let i = 1; i <= 120; i++) h.loop.frame((i * 1000) / 120);
    expect(h.steps()).toBe(60);
  });

  it('after a 2 s stall runs only 5 steps and drops the backlog (no spiral)', () => {
    const h = harness();
    h.loop.frame(0);
    expect(h.loop.frame(2000)).toBe(5);
    expect(h.loop.frame(2000 + 1000 / 60)).toBe(1);
    expect(h.steps()).toBe(6);
  });

  it('reports the leftover fraction as alpha', () => {
    const h = harness();
    h.loop.frame(0);
    h.loop.frame(25);
    expect(h.steps()).toBe(1);
    expect(h.alphas[1]).toBeCloseTo(0.5, 5);
  });

  it('start schedules frames until stop', () => {
    const h = harness();
    h.loop.start();
    expect(h.loop.running).toBe(true);
    expect(h.queued).toHaveLength(1);
    h.queued.shift()!(1000 / 60);
    expect(h.steps()).toBe(1);
    expect(h.queued).toHaveLength(1);
    h.loop.stop();
    h.queued.shift()!(1000);
    expect(h.steps()).toBe(1);
    expect(h.queued).toHaveLength(0);
  });
});
