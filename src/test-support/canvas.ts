/** A recording fake 2D context and surface factory for render tests (tests only). */
import type { MakeSurface, Surface } from '../render/gfx';

export interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  /** Every value assigned to `fillStyle` / `strokeStyle`. */
  styles: Set<string>;
  fills: number;
  blits: number;
  nonIntegerCoords: number;
}

export function fakeCtx(): FakeCtx {
  const rec: FakeCtx = { ctx: null as unknown as CanvasRenderingContext2D, styles: new Set(), fills: 0, blits: 0, nonIntegerCoords: 0 };
  const check = (...n: number[]): void => {
    if (n.some((v) => !Number.isInteger(v))) rec.nonIntegerCoords++;
  };
  const target = {
    imageSmoothingEnabled: true,
    set fillStyle(v: string) {
      rec.styles.add(v);
    },
    get fillStyle(): string {
      return '';
    },
    set strokeStyle(v: string) {
      rec.styles.add(v);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      check(x, y, w, h);
      rec.fills++;
    },
    drawImage(_img: unknown, x: number, y: number) {
      check(x, y);
      rec.blits++;
    },
  };
  rec.ctx = target as unknown as CanvasRenderingContext2D;
  return rec;
}

/** A surface factory whose surfaces all record into `sink` as well. */
export function fakeSurfaces(sink: FakeCtx): MakeSurface {
  return (w: number, h: number): Surface => {
    const own = fakeCtx();
    const ctx = new Proxy(own.ctx, {
      set(t, p, v) {
        if (p === 'fillStyle') sink.styles.add(v as string);
        return Reflect.set(t, p, v);
      },
    });
    return { canvas: { width: w, height: h } as unknown as CanvasImageSource, ctx };
  };
}
