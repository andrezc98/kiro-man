/**
 * GE AC-8: replaying MAX_TICKS (108000) ticks finishes in under 1.5 s on a developer machine.
 * Lives in tests/ (not a pure dir) because it reads the wall clock.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { MAX_TICKS } from '../../src/engine/constants';
import { PERF_MAZE } from '../../src/engine/test-fixtures';
import { replay } from '../../src/shared/replay';

describe('replay performance', () => {
  it(
    'a full 108000-tick replay (4 roaming enemies, full-region BFS) takes < 1.5 s',
    { timeout: 10000 },
    () => {
      replay(1, [], { maze: PERF_MAZE, maxTicks: 2000 }); // warm up the JIT
      const t0 = performance.now();
      const r = replay(0x4b49524f, [], { maze: PERF_MAZE });
      const ms = performance.now() - t0;
      console.info(`perf: ${r.ticks} ticks replayed in ${ms.toFixed(1)} ms`);
      expect(r.status).toBe('complete');
      expect(r.ticks).toBe(MAX_TICKS);
      expect(r.finalState.gameOverReason).toBe('timeLimit');
      expect(r.finalState.enemies.every((e) => e.mode === 'active')).toBe(true);
      expect(ms).toBeLessThan(1500);
    },
  );
});
