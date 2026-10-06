/**
 * The in-game HUD in rows 0..1 (AP-3.6, CC-4.1): score, high score, level and hall, credits on the first
 * line; lives as ghost icons and the active power-ups (label + shrinking timer bar) on the second.
 */
import { CATALOG, CATALOG_ORDER, levelFor } from '../engine';
import type { GameState, PowerKind } from '../engine';
import type { Gfx } from './gfx';
import { C } from './palette';
import { highScore, scoreText } from './view';
import type { RenderView } from './view';

export const HUD_BAR_W = 16;
const SLOT_W = 40;
const POWER_X = 92;

/** Pixel width of a power-up timer bar: proportional, at least 1 px while active, 0 when inactive. */
export function timerBarWidth(remaining: number, duration: number, width = HUD_BAR_W): number {
  if (remaining <= 0 || duration <= 0) return 0;
  return Math.max(1, Math.min(width, Math.ceil((remaining / duration) * width)));
}

/** Active power-ups in catalog order with their remaining ticks. */
export function activePowerUps(game: GameState): { kind: PowerKind; remaining: number }[] {
  const out: { kind: PowerKind; remaining: number }[] = [];
  for (const kind of CATALOG_ORDER) {
    const remaining = game.active[kind] ?? 0;
    if (remaining > 0) out.push({ kind, remaining });
  }
  return out;
}

export function drawHud(g: Gfx, view: RenderView, game: GameState): void {
  const tick = game.tick;
  g.rect(0, 0, 320, 16, C.black);
  g.text('SCORE', 2, 1, C.lightGrey);
  g.text(scoreText(game.score), 36, 1, C.white);
  g.text('HI', 84, 1, C.lightGrey);
  g.text(scoreText(highScore(view.local, game.score)), 100, 1, C.yellow);
  g.text(`LV ${String(game.level).padStart(2, '0')}`, 148, 1, C.green);
  g.text(levelFor(game.level).id, 184, 1, C.darkGrey);
  g.textRight(`CREDIT ${String(view.cabinet.credits).padStart(2, '0')}`, 318, 1, C.lightGrey);

  // Lives: one ghost per remaining life (including the one in play).
  const lives = Math.max(0, game.lives);
  for (let i = 0; i < Math.min(lives, 9); i++) g.sprite('kiro', 0, 2 + i * 9, 8);

  // Active power-ups: label in the service color, timer bar beside it; both blink in the last 1.5 s.
  activePowerUps(game).forEach(({ kind, remaining }, i) => {
    const def = CATALOG.find((d) => d.kind === kind);
    if (def === undefined) return;
    const x = POWER_X + i * SLOT_W;
    const warn = remaining < 90 && ((tick >> 3) & 1) === 1;
    g.text(def.label, x, 9, warn ? C.white : def.color);
    const w = timerBarWidth(remaining, def.durationTicks);
    g.rect(x + 19, 11, HUD_BAR_W, 3, C.night);
    g.rect(x + 19, 11, w, 3, warn ? C.white : def.color);
  });
}
