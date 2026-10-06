import { describe, expect, it } from 'vitest';
import { CATALOG_ORDER, ENEMY_ORDER } from '../engine';
import { PALETTE, color } from './palette';
import { ENEMY_COLOR, ENEMY_SPRITE, POWER_SPRITE, SPRITES, SPRITE_SIZE, pixelIndex, validateSprites } from './sprites';
import type { SpriteId } from './sprites';

describe('palette', () => {
  it('is exactly KIRO-16', () => {
    expect(PALETTE).toHaveLength(16);
    expect(PALETTE[13]).toBe('#9046FF');
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('rejects indices outside 0..15', () => {
    expect(color(0)).toBe('#000000');
    expect(() => color(16)).toThrow(RangeError);
    expect(() => color(-1)).toThrow(RangeError);
    expect(() => color(1.5)).toThrow(RangeError);
  });
});

describe('sprites', () => {
  it('pass validation: 8x8, 1-2 frames, only 0-9a-f and .', () => {
    expect(validateSprites()).toEqual([]);
  });

  it('every pixel is a palette index 0..15 or transparent', () => {
    for (const frames of Object.values(SPRITES)) {
      for (const rows of frames) {
        for (const row of rows) {
          for (const ch of row) {
            const i = pixelIndex(ch);
            if (ch === '.') expect(i).toBeNull();
            else expect(i !== null && i >= 0 && i <= 15).toBe(true);
          }
        }
      }
    }
  });

  it('every moving actor and animated icon has two distinct frames', () => {
    const animated: SpriteId[] = ['kiro', 'clone', 'bug', 'pad', 'rack', ...ENEMY_ORDER.map((e) => ENEMY_SPRITE[e]), ...CATALOG_ORDER.map((k) => POWER_SPRITE[k])];
    for (const id of animated) {
      const frames = SPRITES[id];
      expect(frames, id).toHaveLength(2);
      expect(frames[0]!.join(''), id).not.toBe(frames[1]!.join(''));
    }
  });

  it('the four enemies look different and have distinct signature colors', () => {
    const looks = new Set(ENEMY_ORDER.map((e) => SPRITES[ENEMY_SPRITE[e]][0]!.join('')));
    expect(looks.size).toBe(4);
    expect(new Set(ENEMY_ORDER.map((e) => ENEMY_COLOR[e])).size).toBe(4);
  });

  it('validation catches malformed sprites', () => {
    const bad = { x: [['........', '.......', '..g.....', '........', '........', '........', '........', '........']] };
    const problems = validateSprites(bad);
    expect(problems.some((p) => p.includes('width 7'))).toBe(true);
    expect(problems.some((p) => p.includes('bad character'))).toBe(true);
    expect(validateSprites({ y: [] })).toEqual(['y: 0 frames']);
    expect(SPRITE_SIZE).toBe(8);
  });
});
