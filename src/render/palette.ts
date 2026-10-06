/**
 * KIRO-16 (overview §9.2): the only colors the canvas ever draws with (AP-2.1). Sprites and the font
 * store palette indices; `color(i)` turns an index into the CSS hex string for `fillStyle`.
 */
export const PALETTE: readonly string[] = Object.freeze([
  '#000000', // 0 black
  '#1D2B53', // 1 night blue
  '#7E2553', // 2 plum
  '#008751', // 3 dark green
  '#AB5236', // 4 rust
  '#5F574F', // 5 dark grey
  '#C2C3C7', // 6 light grey
  '#FFF1E8', // 7 white
  '#FF004D', // 8 red
  '#FFA300', // 9 orange
  '#FFEC27', // 10 yellow
  '#00E436', // 11 green
  '#29ADFF', // 12 blue
  '#9046FF', // 13 Kiro purple
  '#FF77A8', // 14 pink
  '#FFCCAA', // 15 peach
]);

/** Named indices so drawing code reads as intent rather than numbers. */
export const C = {
  black: 0,
  night: 1,
  plum: 2,
  darkGreen: 3,
  rust: 4,
  darkGrey: 5,
  lightGrey: 6,
  white: 7,
  red: 8,
  orange: 9,
  yellow: 10,
  green: 11,
  blue: 12,
  purple: 13,
  pink: 14,
  peach: 15,
} as const;

export type ColorIndex = number;

/** CSS color for a palette index; throws on anything outside 0..15 (a programming error). */
export function color(i: ColorIndex): string {
  const c = PALETTE[i];
  if (c === undefined || !Number.isInteger(i)) throw new RangeError(`palette index out of range: ${i}`);
  return c;
}
