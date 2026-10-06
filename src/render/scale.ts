/** Integer scaling of the 320x240 screen (AP-1.1, property P11). */
export const SCREEN_W = 320;
export const SCREEN_H = 240;

/** The largest integer s >= 1 with 320s <= w and 240s <= h, or 1 when even s = 1 does not fit. */
export function integerScale(w: number, h: number): number {
  const s = Math.min(Math.floor(w / SCREEN_W), Math.floor(h / SCREEN_H));
  return Number.isFinite(s) && s >= 1 ? s : 1;
}
