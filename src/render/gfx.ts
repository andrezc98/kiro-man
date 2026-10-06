/**
 * Drawing primitives over a 320x240 2D context (retro-style rules): palette indices only, integer
 * coordinates only (everything is floored), no smoothing. Sprites and glyphs are pre-rendered lazily into
 * small offscreen surfaces (one per sprite/frame/variant or glyph/color/scale) and blitted with
 * `drawImage`, which keeps per-frame work low.
 */
import { ADVANCE, GLYPH_H, glyphChar, glyphRows, textWidth } from './font';
import { color } from './palette';
import { SPRITES, SPRITE_SIZE, pixelIndex } from './sprites';
import type { SpriteId } from './sprites';
import { SCREEN_H, SCREEN_W } from './scale';

export interface Surface {
  canvas: CanvasImageSource;
  ctx: CanvasRenderingContext2D;
}

/** Creates an offscreen surface (a detached canvas in the browser, a fake in tests). */
export type MakeSurface = (w: number, h: number) => Surface;

export interface SpriteVariant {
  /** Mirror horizontally (Kiro looking left). */
  flip?: boolean;
  /** Draw every opaque pixel in this one palette color (silhouettes, after-images). */
  solid?: number;
  /** Per-index recolor, e.g. `{ 12: 6 }` to frost Cold Start. */
  remap?: Readonly<Record<number, number>>;
  /** 0..16: drop pixels whose ordered-dither threshold is below this (16 = invisible). */
  dissolve?: number;
}

/** 4x4 Bayer matrix: the ordered-dither thresholds used by `dissolve` and soft darkness edges. */
export const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function bayer(x: number, y: number): number {
  return (BAYER4[y & 3] as readonly number[])[x & 3] as number;
}

export interface Gfx {
  readonly ctx: CanvasRenderingContext2D;
  readonly makeSurface: MakeSurface;
  rect(x: number, y: number, w: number, h: number, c: number): void;
  /** 1 px outline. */
  frame(x: number, y: number, w: number, h: number, c: number): void;
  pixel(x: number, y: number, c: number): void;
  clear(c: number): void;
  sprite(id: SpriteId, frame: number, x: number, y: number, v?: SpriteVariant): void;
  /** Left-aligned 5x7 text at integer `scale`; returns the drawn width. */
  text(s: string, x: number, y: number, c: number, scale?: number): number;
  textCenter(s: string, y: number, c: number, scale?: number, cx?: number): void;
  textRight(s: string, right: number, y: number, c: number, scale?: number): void;
  /** Two-tone title text: glyph rows 0..2 in `top`, 3..6 in `bottom`, with a drop shadow. */
  titleText(s: string, x: number, y: number, scale: number, top: number, bottom: number, shadow: number): void;
  /** Bresenham line; with `dash > 0` only every `dash`-th pixel (offset by `phase`) is drawn. */
  line(x0: number, y0: number, x1: number, y1: number, c: number, dash?: number, phase?: number): void;
  blit(src: CanvasImageSource, x: number, y: number): void;
}

const f = Math.floor;

function variantKey(v: SpriteVariant | undefined): string {
  if (v === undefined) return '';
  const remap = v.remap === undefined ? '' : Object.entries(v.remap).map(([a, b]) => `${a}>${b}`).join(',');
  return `${v.flip === true ? 'f' : ''}|${v.solid ?? ''}|${remap}|${v.dissolve ?? 0}`;
}

export interface GfxOptions {
  /** Called for every character the font lacks (drawn as `?`); tests use it to prove glyph coverage. */
  onMissingGlyph?: (ch: string) => void;
}

export function createGfx(ctx: CanvasRenderingContext2D, makeSurface: MakeSurface, opts: GfxOptions = {}): Gfx {
  ctx.imageSmoothingEnabled = false;
  const spriteCache = new Map<string, CanvasImageSource | null>();
  const glyphCache = new Map<string, CanvasImageSource>();

  function fillOn(target: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number): void {
    target.fillStyle = color(c);
    target.fillRect(f(x), f(y), f(w), f(h));
  }

  function buildSprite(id: SpriteId, frame: number, v: SpriteVariant | undefined): CanvasImageSource | null {
    const frames = SPRITES[id];
    const rows = frames[frame % frames.length] as readonly string[];
    const dissolve = v?.dissolve ?? 0;
    if (dissolve >= 16) return null;
    const s = makeSurface(SPRITE_SIZE, SPRITE_SIZE);
    s.ctx.imageSmoothingEnabled = false;
    rows.forEach((row, py) => {
      for (let px = 0; px < row.length; px++) {
        const idx = pixelIndex(row[px] as string);
        if (idx === null) continue;
        const dx = v?.flip === true ? SPRITE_SIZE - 1 - px : px;
        if (dissolve > 0 && bayer(dx, py) < dissolve) continue;
        const out = v?.solid ?? v?.remap?.[idx] ?? idx;
        fillOn(s.ctx, dx, py, 1, 1, out);
      }
    });
    return s.canvas;
  }

  function glyph(ch: string, scale: number, top: number, bottom: number): CanvasImageSource {
    const key = `${ch}|${scale}|${top}|${bottom}`;
    const hit = glyphCache.get(key);
    if (hit !== undefined) return hit;
    const rows = glyphRows(ch);
    const s = makeSurface(5 * scale, GLYPH_H * scale);
    s.ctx.imageSmoothingEnabled = false;
    rows.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] === '#') fillOn(s.ctx, gx * scale, gy * scale, scale, scale, gy < 3 ? top : bottom);
      }
    });
    glyphCache.set(key, s.canvas);
    return s.canvas;
  }

  function drawString(s: string, x: number, y: number, scale: number, top: number, bottom: number): number {
    let cx = f(x);
    for (const ch of s) {
      if (opts.onMissingGlyph !== undefined && glyphChar(ch) !== ch) opts.onMissingGlyph(ch);
      if (ch !== ' ') ctx.drawImage(glyph(ch, scale, top, bottom), cx, f(y));
      cx += ADVANCE * scale;
    }
    return textWidth(s, scale);
  }

  const g: Gfx = {
    ctx,
    makeSurface,
    rect: (x, y, w, h, c) => fillOn(ctx, x, y, w, h, c),
    frame(x, y, w, h, c) {
      fillOn(ctx, x, y, w, 1, c);
      fillOn(ctx, x, y + h - 1, w, 1, c);
      fillOn(ctx, x, y, 1, h, c);
      fillOn(ctx, x + w - 1, y, 1, h, c);
    },
    pixel: (x, y, c) => fillOn(ctx, x, y, 1, 1, c),
    clear: (c) => fillOn(ctx, 0, 0, SCREEN_W, SCREEN_H, c),
    sprite(id, frame, x, y, v) {
      const key = `${id}#${frame}#${variantKey(v)}`;
      let img = spriteCache.get(key);
      if (img === undefined) {
        img = buildSprite(id, frame, v);
        spriteCache.set(key, img);
      }
      if (img !== null) ctx.drawImage(img, f(x), f(y));
    },
    text: (s, x, y, c, scale = 1) => drawString(s, x, y, scale, c, c),
    textCenter(s, y, c, scale = 1, cx = SCREEN_W / 2) {
      drawString(s, cx - textWidth(s, scale) / 2, y, scale, c, c);
    },
    textRight(s, right, y, c, scale = 1) {
      drawString(s, right - textWidth(s, scale), y, scale, c, c);
    },
    titleText(s, x, y, scale, top, bottom, shadow) {
      const d = Math.max(1, scale >> 1);
      drawString(s, x + d, y + d, scale, shadow, shadow);
      drawString(s, x, y, scale, top, bottom);
    },
    line(x0, y0, x1, y1, c, dash = 0, phase = 0) {
      let x = f(x0);
      let y = f(y0);
      const tx = f(x1);
      const ty = f(y1);
      const dx = Math.abs(tx - x);
      const dy = -Math.abs(ty - y);
      const sx = x < tx ? 1 : -1;
      const sy = y < ty ? 1 : -1;
      let e = dx + dy;
      let n = 0;
      for (;;) {
        if (dash <= 0 || (n + phase) % dash === 0) fillOn(ctx, x, y, 1, 1, c);
        if (x === tx && y === ty) break;
        const e2 = 2 * e;
        if (e2 >= dy) {
          e += dy;
          x += sx;
        }
        if (e2 <= dx) {
          e += dx;
          y += sy;
        }
        n++;
      }
    },
    blit: (src, x, y) => ctx.drawImage(src, f(x), f(y)),
  };
  return g;
}
