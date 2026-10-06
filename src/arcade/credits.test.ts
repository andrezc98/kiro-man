import { describe, expect, it } from 'vitest';
import { MAX_CREDITS, insertCoin, tryStart } from './credits';

describe('insertCoin', () => {
  it('adds one credit', () => {
    expect(insertCoin(0)).toEqual({ credits: 1, accepted: true });
    expect(insertCoin(41)).toEqual({ credits: 42, accepted: true });
  });

  it('accepts the coin that reaches 99', () => {
    expect(insertCoin(98)).toEqual({ credits: 99, accepted: true });
  });

  it('rejects a coin at 99 and keeps credits at 99', () => {
    expect(MAX_CREDITS).toBe(99);
    expect(insertCoin(99)).toEqual({ credits: 99, accepted: false });
  });
});

describe('tryStart', () => {
  it('costs exactly one credit', () => {
    expect(tryStart(1)).toEqual({ credits: 0, started: true });
    expect(tryStart(99)).toEqual({ credits: 98, started: true });
  });

  it('does nothing with 0 credits', () => {
    expect(tryStart(0)).toEqual({ credits: 0, started: false });
  });
});
