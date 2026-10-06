/**
 * The renderer: one draw per animation frame of the current cabinet screen into the 320x240 canvas,
 * plus a short shutter transition whenever the screen changes and brief toasts (e.g. SOUND OFF).
 * It reads engine and cabinet state and never mutates either.
 */
import type { GameEvent, GameState } from '../engine';
import { textWidth } from './font';
import { createGfx } from './gfx';
import type { Gfx, GfxOptions, MakeSurface } from './gfx';
import { drawHud } from './hud';
import { C } from './palette';
import { drawAttract } from './screens/attract';
import { drawHighscores } from './screens/highscores';
import { drawIncident } from './screens/incident';
import { drawInitials } from './screens/initials';
import { createPlayingLayer } from './screens/playing';
import type { RenderView } from './view';

export const SHUTTER_TICKS = 10;
const TOAST_TICKS = 90;

export interface Renderer {
  draw(view: RenderView): void;
  /** Feed every engine step's events (and QA-appended events) for render-only effects. */
  onGameEvents(game: GameState, events: readonly GameEvent[]): void;
  /** Call when a new game starts. */
  resetGame(): void;
  /** Shows a short message at the bottom of the screen for 1.5 s of UI ticks. */
  toast(text: string, uiTick: number): void;
}

/** Height in pixels of each shutter half `t` UI ticks into a screen (0 once the transition is over). */
export function shutterHeight(t: number): number {
  if (t >= SHUTTER_TICKS || t < 0) return 0;
  return Math.ceil(((SHUTTER_TICKS - t) / SHUTTER_TICKS) * 120);
}

function drawFatal(g: Gfx, message: string): void {
  g.clear(C.black);
  g.frame(20, 90, 280, 60, C.red);
  g.textCenter(message.toUpperCase(), 104, C.red, 2);
  g.textCenter('THE CABINET NEEDS A TECHNICIAN', 128, C.lightGrey);
}

export function createRenderer(ctx: CanvasRenderingContext2D, makeSurface: MakeSurface, opts: GfxOptions = {}): Renderer {
  const g = createGfx(ctx, makeSurface, opts);
  const playing = createPlayingLayer(g);
  let toast: { text: string; until: number } | null = null;

  return {
    draw(view) {
      ctx.imageSmoothingEnabled = false;
      if (view.fatal !== null) {
        drawFatal(g, view.fatal);
        return;
      }
      const cab = view.cabinet;
      switch (cab.screen) {
        case 'attract':
          drawAttract(g, view);
          break;
        case 'playing':
          g.clear(C.black);
          if (view.game !== null) {
            playing.draw(view, view.game);
            drawHud(g, view, view.game);
          }
          break;
        case 'incident':
          drawIncident(g, view);
          break;
        case 'initials':
          drawInitials(g, view);
          break;
        case 'highscores':
          drawHighscores(g, view);
          break;
      }
      const h = shutterHeight(cab.screenTicks);
      if (h > 0) {
        g.rect(0, 0, 320, h, C.black);
        g.rect(0, 240 - h, 320, h, C.black);
        g.rect(0, h, 320, 1, C.purple);
        g.rect(0, 239 - h, 320, 1, C.purple);
      }
      if (toast !== null) {
        if (cab.uiTick >= toast.until) toast = null;
        else {
          const w = textWidth(toast.text) + 8;
          g.rect(160 - w / 2, 226, w, 11, C.black);
          g.frame(160 - w / 2, 226, w, 11, C.darkGrey);
          g.textCenter(toast.text, 228, C.white);
        }
      }
    },
    onGameEvents: (game, events) => playing.onEvents(game, events),
    resetGame: () => playing.reset(),
    toast(text, uiTick) {
      toast = { text, until: uiTick + TOAST_TICKS };
    },
  };
}
