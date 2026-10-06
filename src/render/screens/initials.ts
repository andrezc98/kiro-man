/**
 * Initials entry (CC-7): three large slots starting at AAA, the active slot blinking with up/down
 * arrows, the controls, and the auto-confirm countdown (1800 UI ticks).
 */
import { initialsString, INITIALS_TIMEOUT_TICKS } from '../../arcade/initials';
import type { Gfx } from '../gfx';
import { C } from '../palette';
import { scoreText } from '../view';
import type { RenderView } from '../view';

/** Whole seconds left before the initials auto-confirm (60 UI ticks per second). */
export function secondsLeft(idle: number): number {
  return Math.max(0, Math.ceil((INITIALS_TIMEOUT_TICKS - idle) / 60));
}

function arrow(g: Gfx, cx: number, y: number, up: boolean, c: number): void {
  for (let i = 0; i < 4; i++) {
    const row = up ? y + i : y + 3 - i;
    g.rect(cx - i, row, i * 2 + 1, 1, c);
  }
}

export function drawInitials(g: Gfx, view: RenderView): void {
  const cab = view.cabinet;
  const st = cab.initials;
  const t = cab.screenTicks;
  g.clear(C.black);
  g.titleText('NEW HIGH SCORE!', 160 - 89, 18, 2, C.pink, C.purple, C.plum);
  g.textCenter(`SCORE ${scoreText(cab.summary?.score ?? 0)}`, 44, C.white);
  g.textCenter('ENTER YOUR INITIALS', 64, C.yellow);
  if (st === null) return;
  const name = initialsString(st);
  const slotW = 36;
  const x0 = 160 - (slotW * 3) / 2;
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * slotW;
    const active = i === st.cursor;
    const lit = !active || ((t >> 3) & 1) === 0;
    g.frame(x + 2, 88, slotW - 4, 40, active ? C.purple : C.night);
    if (lit) g.text(name[i] ?? 'A', x + 8, 94, active ? C.white : C.lightGrey, 4);
    g.rect(x + 6, 124, slotW - 12, 2, active ? C.yellow : C.darkGrey);
    if (active) {
      arrow(g, x + slotW / 2, 80, true, C.yellow);
      arrow(g, x + slotW / 2, 132, false, C.yellow);
    }
  }
  g.textCenter('UP/DOWN: LETTER   LEFT/RIGHT: SLOT', 156, C.lightGrey);
  g.textCenter('TYPE A-Z TO SPELL, ENTER TO CONFIRM', 168, C.lightGrey);
  const secs = secondsLeft(st.idle);
  g.textCenter(`AUTO-CONFIRM IN ${String(secs).padStart(2, '0')}`, 196, secs <= 5 ? C.red : C.darkGrey);
}
