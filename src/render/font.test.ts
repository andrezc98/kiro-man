import { describe, expect, it } from 'vitest';
import { FONT_GLYPHS } from '../content/glyphs';
import { FACTS } from '../content/facts';
import { ADVANCE, GLYPHS, GLYPH_H, GLYPH_W, glyphChar, glyphRows, textWidth } from './font';

describe('5x7 font', () => {
  it('has a bitmap for every FONT_GLYPHS entry', () => {
    const missing = FONT_GLYPHS.filter((ch) => GLYPHS[ch] === undefined);
    expect(missing).toEqual([]);
  });

  it('every glyph is 7 rows of 5 pixels', () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      expect(rows, ch).toHaveLength(GLYPH_H);
      for (const row of rows) expect(row, ch).toMatch(new RegExp(`^[#.]{${GLYPH_W}}$`));
    }
  });

  it('every glyph except space lights at least one pixel', () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      if (ch === ' ') continue;
      expect(rows.join('').includes('#'), ch).toBe(true);
    }
  });

  it('draws unknown characters as ?', () => {
    expect(glyphChar('Ä')).toBe('?');
    expect(glyphChar('a')).toBe('?');
    expect(glyphRows('~')).toBe(GLYPHS['?']);
    expect(glyphChar('A')).toBe('A');
  });

  it('covers every uppercased fact', () => {
    for (const f of FACTS) for (const ch of f.text.toUpperCase()) expect(glyphChar(ch), f.id).toBe(ch);
  });

  it('measures text with a 1 px gap between glyphs', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('A')).toBe(5);
    expect(textWidth('AB')).toBe(ADVANCE + 5);
    expect(textWidth('AB', 2)).toBe((ADVANCE + 5) * 2);
  });
});
