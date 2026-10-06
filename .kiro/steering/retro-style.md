---
inclusion: fileMatch
fileMatchPattern: "src/render/**/*.ts"
---

# KIRO-MAN retro rendering style

## KIRO-16 palette

Draw only with these 16 colors, by index (`src/render/palette.ts`):

| Index | Hex | Index | Hex |
|---|---|---|---|
| 0 | `#000000` | 8 | `#FF004D` |
| 1 | `#1D2B53` | 9 | `#FFA300` |
| 2 | `#7E2553` | 10 | `#FFEC27` |
| 3 | `#008751` | 11 | `#00E436` |
| 4 | `#AB5236` | 12 | `#29ADFF` |
| 5 | `#5F574F` | 13 | `#9046FF` (Kiro purple) |
| 6 | `#C2C3C7` | 14 | `#FF77A8` |
| 7 | `#FFF1E8` | 15 | `#FFCCAA` |

## Resolution and scaling

- Internal resolution is 320x240. The maze is 40x28 tiles of 8 px on rows 2..29; rows 0..1 are the HUD.
- Scale the canvas by an integer factor only (`integerScale` in `src/render/scale.ts`).
- Set `ctx.imageSmoothingEnabled = false` on every 2D context, and CSS `image-rendering: pixelated` on the canvas.

## Drawing rules

- Text uses only the in-code 5x7 pixel font (`src/render/font.ts`). No web fonts, no `fillText`.
- No anti-aliasing and no sub-pixel draws: round every coordinate with `Math.floor` before drawing.
- Sprites are 8x8 with two animation frames, defined as palette-index arrays in `src/render/sprites.ts`. No image files under `src/`.
- Original pixel art only. No official AWS logos or icons; power-ups use our own icons plus three-letter labels.
- Render reads engine state and never mutates it. Sub-tile interpolation (`tile * 8 + dir * progress * 8 / 256`) happens here, in floats, then is floored.
