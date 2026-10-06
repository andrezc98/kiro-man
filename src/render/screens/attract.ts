/**
 * Attract mode (CC-3): the title panel (logo, cast of incidents, the AWS power-ups, a looping chase) and
 * the high-score panel, alternating every 480 UI ticks; INSERT COIN blinks at a 30-tick period (PRESS
 * ENTER once there is a credit) and flashes fast for 60 ticks after a start without credits.
 */
import { TIMINGS } from '../../arcade/cabinet';
import type { CabinetState } from '../../arcade/cabinet';
import { CATALOG, ENEMY_ORDER } from '../../engine';
import type { EnemyId } from '../../engine';
import type { Gfx } from '../gfx';
import { C } from '../palette';
import { ENEMY_COLOR, ENEMY_SPRITE, POWER_SPRITE } from '../sprites';
import { textWidth } from '../font';
import { drawScoreTable, globalPanelNote } from './highscores';
import { highScore, scoreText } from '../view';
import type { RenderView } from '../view';

const CAST: Readonly<Record<EnemyId, { name: string; blurb: string }>> = {
  latency: { name: 'LATENCY', blurb: 'SLOW, STEADY, ALWAYS FOLLOWS' },
  throttle: { name: 'THROTTLE', blurb: 'CUTS YOU OFF UP AHEAD' },
  coldstart: { name: 'COLD START', blurb: 'FREEZES, THEN DASHES' },
  outage: { name: 'OUTAGE', blurb: 'WANDERS AND KILLS THE LIGHTS' },
};

/** Whether the coin prompt is lit this tick (CC-2.2, CC-3.1). */
export function coinPromptVisible(cab: Pick<CabinetState, 'uiTick' | 'insertCoinFlash'>): boolean {
  if (cab.insertCoinFlash > 0) return Math.floor(cab.insertCoinFlash / TIMINGS.failedStartFlashToggle) % 2 === 0;
  return cab.uiTick % TIMINGS.insertCoinBlinkPeriod < TIMINGS.insertCoinBlinkPeriod / 2;
}

function drawCoinPrompt(g: Gfx, cab: CabinetState, y: number): void {
  if (coinPromptVisible(cab)) {
    const flashing = cab.insertCoinFlash > 0;
    const text = cab.credits >= 1 && !flashing ? 'PRESS ENTER' : 'INSERT COIN';
    g.textCenter(text, y, flashing ? C.red : C.yellow, 2);
  }
  g.textCenter(`CREDIT ${String(cab.credits).padStart(2, '0')}`, 228, C.lightGrey);
}

function drawTop(g: Gfx, view: RenderView): void {
  g.text('1UP', 8, 2, C.red);
  g.text(scoreText(view.game?.score ?? 0), 30, 2, C.white);
  g.textRight(`HI ${scoreText(highScore(view.local, 0))}`, 312, 2, C.yellow);
}

function drawTitlePanel(g: Gfx, view: RenderView): void {
  const cab = view.cabinet;
  const t = cab.screenTicks;
  const title = 'KIRO-MAN';
  g.titleText(title, 160 - textWidth(title, 4) / 2, 16, 4, C.pink, C.purple, C.plum);
  g.textCenter('OUTAGE IN THE DATA CENTER', 50, C.blue);

  // The cast, revealed one by one like an arcade roll call.
  g.textCenter('- THE INCIDENTS -', 64, C.lightGrey);
  ENEMY_ORDER.forEach((id, i) => {
    if (t < 20 + i * 25) return;
    const y = 76 + i * 13;
    g.sprite(ENEMY_SPRITE[id], (t >> 4) & 1, 52, y - 1);
    g.text(CAST[id].name, 66, y, ENEMY_COLOR[id]);
    if (t >= 32 + i * 25) g.text(CAST[id].blurb, 132, y, C.lightGrey);
  });

  // The AWS power-ups with their labels.
  if (t >= 130) {
    g.textCenter('- AWS POWER-UPS -', 130, C.lightGrey);
    CATALOG.forEach((d, i) => {
      const x = 40 + i * 52;
      g.sprite(POWER_SPRITE[d.kind], (t >> 4) & 1, x, 142);
      g.text(d.label, x + 11, 143, d.color);
    });
  }

  // A looping chase along the bottom: Kiro eats a row of bugs with the incidents on its tail.
  const span = 420;
  const lead = ((cab.uiTick * 3) >> 1) % span;
  const kx = lead - 60;
  for (let bx = 8; bx < 312; bx += 12) if (bx > kx + 6) g.sprite('bug', ((cab.uiTick >> 4) + bx) & 1, bx, 160);
  g.sprite('kiro', (cab.uiTick >> 2) & 1, kx, 160);
  ENEMY_ORDER.forEach((id, i) => g.sprite(ENEMY_SPRITE[id], (cab.uiTick >> 3) & 1, kx - 22 - i * 12, 160));

  drawCoinPrompt(g, cab, 184);
  g.textCenter('C OR 5: COIN    ENTER: START', 206, C.darkGrey);
}

function drawScoresPanel(g: Gfx, view: RenderView): void {
  g.titleText('HIGH SCORES', 160 - textWidth('HIGH SCORES', 2) / 2, 16, 2, C.yellow, C.orange, C.rust);
  drawScoreTable(
    g,
    30,
    40,
    'LOCAL TOP 10',
    C.purple,
    view.local,
    null,
    null,
    true,
  );
  drawScoreTable(g, 186, 40, 'GLOBAL TOP 10', C.blue, view.global.list, globalPanelNote(view.global), null, true);
  drawCoinPrompt(g, view.cabinet, 184);
  g.textCenter('C OR 5: COIN    ENTER: START', 206, C.darkGrey);
}

export function drawAttract(g: Gfx, view: RenderView): void {
  g.clear(C.black);
  drawTop(g, view);
  if (view.cabinet.attractPanel === 'scores') drawScoresPanel(g, view);
  else drawTitlePanel(g, view);
}
