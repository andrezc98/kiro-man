/**
 * Every character the 5x7 pixel font draws (overview §7.5). Facts are validated against this list after
 * uppercasing, and `src/render/font.ts` must have a bitmap for each entry (a render unit test asserts it).
 */
export const FONT_GLYPHS: readonly string[] = Object.freeze(
  Array.from(" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?'\"-+/()#%&*=<>_@"),
);

const GLYPH_SET: ReadonlySet<string> = new Set(FONT_GLYPHS);

/** True when every character of `text` has a font glyph. */
export function usesOnlyFontGlyphs(text: string): boolean {
  for (const ch of text) {
    if (!GLYPH_SET.has(ch)) return false;
  }
  return true;
}
