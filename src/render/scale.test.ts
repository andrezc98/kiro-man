import { describe, expect, it } from 'vitest';
import { screenLayout } from './crt';
import { integerScale } from './scale';

describe('integerScale', () => {
  it('picks the largest integer factor that fits', () => {
    expect(integerScale(1920, 1080)).toBe(4);
    expect(integerScale(960, 720)).toBe(3);
    expect(integerScale(1280, 720)).toBe(3);
    expect(integerScale(640, 480)).toBe(2);
    expect(integerScale(639, 480)).toBe(1);
  });

  it('is 1 for viewports smaller than 320x240', () => {
    expect(integerScale(100, 100)).toBe(1);
    expect(integerScale(320, 239)).toBe(1);
    expect(integerScale(0, 0)).toBe(1);
  });

  it('screenLayout gives the CSS size for the scale', () => {
    expect(screenLayout(1920, 1080)).toEqual({ scale: 4, width: 1280, height: 960 });
  });
});
