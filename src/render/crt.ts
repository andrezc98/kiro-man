/**
 * Screen layout and the CRT overlay (AP-1, AP-4). The canvas keeps its 320x240 backing store and is
 * displayed at an integer CSS scale; the `#crt` overlay (scanlines, vignette, flicker, all in CSS with
 * `pointer-events: none`) is sized to match it exactly. The flicker is disabled by CSS when the user
 * prefers reduced motion.
 */
import { SCREEN_H, SCREEN_W, integerScale } from './scale';

export interface ScreenLayout {
  scale: number;
  width: number;
  height: number;
}

/** The integer-scaled display size for a viewport. */
export function screenLayout(viewportW: number, viewportH: number): ScreenLayout {
  const scale = integerScale(viewportW, viewportH);
  return { scale, width: SCREEN_W * scale, height: SCREEN_H * scale };
}

/** Applies a layout to the canvas and its CRT overlay. */
export function applyLayout(canvas: HTMLCanvasElement, crt: HTMLElement | null, layout: ScreenLayout): void {
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  if (crt !== null) {
    crt.style.width = `${layout.width}px`;
    crt.style.height = `${layout.height}px`;
    crt.dataset.scale = String(layout.scale);
  }
}

/** Replays the brief CRT "roll" when the screen changes (purely cosmetic; CSS skips it for reduced motion). */
export function pulseCrt(crt: HTMLElement | null): void {
  if (crt === null) return;
  crt.classList.remove('crt-roll');
  // Reading layout restarts the CSS animation on the re-added class.
  void crt.offsetWidth;
  crt.classList.add('crt-roll');
}
