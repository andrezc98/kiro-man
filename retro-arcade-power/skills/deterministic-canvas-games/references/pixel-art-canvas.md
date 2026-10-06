# Pixel-art canvas

Crisp retro graphics on a modern display come from three things: a small fixed internal resolution, integer scaling with smoothing off, and drawing only whole pixels from a fixed palette.

## 1. Internal resolution and integer scale

Render to a 320x240 canvas and scale the element by the largest integer that fits the window:

```ts
export const SCREEN_W = 320;
export const SCREEN_H = 240;

export function integerScale(w: number, h: number): number {
  const s = Math.min(Math.floor(w / SCREEN_W), Math.floor(h / SCREEN_H));
  return Number.isFinite(s) && s >= 1 ? s : 1;
}

function layout(canvas: HTMLCanvasElement): void {
  const s = integerScale(window.innerWidth, window.innerHeight);
  canvas.style.width = `${SCREEN_W * s}px`;
  canvas.style.height = `${SCREEN_H * s}px`;
}
```

```css
canvas {
  image-rendering: pixelated;   /* nearest-neighbor upscaling */
  image-rendering: crisp-edges; /* fallback for older engines */
}
```

```ts
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false; // also on every offscreen canvas you drawImage from
```

A non-integer scale (for example 2.5x) makes some source pixels two device pixels wide and others three, which looks like shimmering. 1920x1080 gives 4x (1280x960).

## 2. A fixed palette by index

Draw with palette indices, not free-form colors, so every screen stays consistent and sprites can be validated:

```ts
export const PALETTE = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#9046FF', '#FF77A8', '#FFCCAA',
] as const;

export function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number): void {
  ctx.fillStyle = PALETTE[c]!;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}
```

## 3. Sprites as data

Keep 8x8 sprites as strings of palette digits in code (no image files to load, nothing to license):

```ts
// '.' is transparent, hex digits are palette indices
export const GHOST_FRAMES = [
  [
    '..dddd..',
    '.dddddd.',
    'dd7dd7dd',
    'dd0dd0dd',
    'dddddddd',
    'dddddddd',
    'dddddddd',
    'd.dd.dd.',
  ],
  [
    '..dddd..',
    '.dddddd.',
    'dd7dd7dd',
    'dd0dd0dd',
    'dddddddd',
    'dddddddd',
    'dddddddd',
    '.dd.dd.d',
  ],
];

export function drawSprite(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number): void {
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!;
      if (ch !== '.') fillRect(ctx, ox + dx, oy + dy, 1, 1, parseInt(ch, 16));
    }
  });
}
```

Pre-render each frame once to an offscreen canvas and `drawImage` it at integer coordinates for speed.

Unit test the data: every row has 8 characters, every character is `.` or `0-9a-f`, and every frame has 8 rows.

## 4. A pixel font in code

`fillText` anti-aliases, so draw text from a 5x7 bitmap font:

```ts
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  // ... every character the game prints
};

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, c: number): void {
  let cx = Math.floor(x);
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['?']!;
    g.forEach((row, dy) => {
      for (let dx = 0; dx < 5; dx++) if (row[dx] === '#') fillRect(ctx, cx + dx, y + dy, 1, 1, c);
    });
    cx += 6; // 5 px glyph + 1 px spacing
  }
}
```

Keep the list of supported characters in one module and test that every string the game can print (including data such as facts) uses only those characters.

## 5. Sub-tile motion without sub-pixels

The simulation moves in fixed-point units (256 per 8 px tile). Convert in the renderer and floor:

```ts
const px = Math.floor(m.tile.x * 8 + (dx * m.progress * 8) / 256);
const py = Math.floor(m.tile.y * 8 + (dy * m.progress * 8) / 256);
drawSprite(ctx, frame, px, py + HUD_HEIGHT);
```

## 6. CRT feel with CSS, not the game canvas

Scanlines as an overlay element above the canvas keep the game pixels clean and are trivial to disable for reduced motion:

```css
#crt {
  position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgb(0 0 0 / 0.25) 0 1px, transparent 1px 3px);
}
@media (prefers-reduced-motion: reduce) {
  #crt { animation: none; }
}
```

## 7. Accessibility

- Give the canvas `role="img"` and an `aria-label` that changes with the screen.
- Keep an `aria-live="polite"` region updated on screen changes and game over.
- Show the controls as HTML text next to the canvas.

## Checklist

- [ ] One fixed internal resolution; integer CSS scale only.
- [ ] `imageSmoothingEnabled = false` on every context; `image-rendering: pixelated`.
- [ ] Every draw call goes through a palette index and floored coordinates.
- [ ] Sprites and font are data in code, with validation tests.
- [ ] No official logos or third-party game assets.
