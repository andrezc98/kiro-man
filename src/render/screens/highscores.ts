/**
 * The high-score screen (CC-8): local and global top-10 panels side by side, the new local entry
 * highlighted, and the remote submission status (SUBMITTING / VERIFIED / REJECTED / OFFLINE).
 * `drawScoreTable` is shared with the attract-mode score panel.
 */
import type { RemoteStatus } from '../../arcade/cabinet';
import { MAX_ENTRIES } from '../../leaderboard/ranking';
import type { ScoreEntry } from '../../leaderboard/ranking';
import type { Gfx } from '../gfx';
import { C } from '../palette';
import { scoreText } from '../view';
import type { GlobalBoard, RenderView } from '../view';

const ROW_H = 10;

/** Text and color for the remote status line. */
export function remoteStatusLine(status: RemoteStatus, detail: string | null): { text: string; color: number } {
  switch (status) {
    case 'submitting':
      return { text: 'GLOBAL: SUBMITTING...', color: C.yellow };
    case 'verified':
      return { text: 'GLOBAL: VERIFIED BY REPLAY', color: C.green };
    case 'rejected':
      return { text: `GLOBAL: REJECTED${detail === null ? '' : ` (${detail})`}`, color: C.red };
    case 'offline':
      return { text: 'GLOBAL: OFFLINE', color: C.lightGrey };
    case 'idle':
      return { text: 'GLOBAL: NOT SUBMITTED', color: C.darkGrey };
  }
}

/** The message shown instead of rows when the global panel has none to show. */
export function globalPanelNote(board: GlobalBoard): string | null {
  if (board.status === 'disabled' || board.status === 'offline') return 'OFFLINE';
  if (board.status === 'loading') return 'CONNECTING...';
  return null;
}

/** One ranked table: "01 KIR 012340 L3" rows; `highlight` is a 1-based rank drawn blinking in yellow. */
export function drawScoreTable(
  g: Gfx,
  x: number,
  y: number,
  title: string,
  titleColor: number,
  list: readonly ScoreEntry[],
  note: string | null,
  highlight: number | null,
  blinkOn: boolean,
): void {
  g.text(title, x, y, titleColor);
  g.rect(x, y + 9, 94, 1, titleColor);
  if (note !== null) {
    g.text(note, x, y + 16, C.darkGrey);
    return;
  }
  // Empty ranks are shown as dashes so the table always reads as a full top 10.
  for (let i = list.length; i < MAX_ENTRIES; i++) {
    const ry = y + 15 + i * ROW_H;
    g.text(String(i + 1).padStart(2, '0'), x, ry, C.night);
    g.text('---  -------', x + 16, ry, C.night);
  }
  list.forEach((e, i) => {
    const rank = i + 1;
    const ry = y + 15 + i * ROW_H;
    const hot = highlight === rank;
    if (hot && !blinkOn) return;
    const rankColor = rank === 1 ? C.yellow : rank <= 3 ? C.orange : C.lightGrey;
    g.text(String(rank).padStart(2, '0'), x, ry, hot ? C.yellow : rankColor);
    g.text(e.initials, x + 16, ry, hot ? C.yellow : C.white);
    g.text(scoreText(e.score, 7), x + 40, ry, hot ? C.yellow : C.lightGrey);
    g.text(`L${e.level}`, x + 86, ry, hot ? C.yellow : C.darkGrey);
  });
}

export function drawHighscores(g: Gfx, view: RenderView): void {
  const cab = view.cabinet;
  const t = cab.screenTicks;
  g.clear(C.black);
  g.titleText('HIGH SCORES', 160 - 65, 10, 2, C.yellow, C.orange, C.rust);
  g.textCenter('SERVICE LEVEL LEADERS', 30, C.darkGrey);
  const blinkOn = ((t >> 3) & 1) === 0;
  drawScoreTable(g, 30, 46, 'LOCAL TOP 10', C.purple, view.local, null, cab.highlightRank, blinkOn);
  drawScoreTable(g, 186, 46, 'GLOBAL TOP 10', C.blue, view.global.list, globalPanelNote(view.global), null, true);
  const s = remoteStatusLine(cab.remoteStatus, cab.remoteDetail);
  if (!(cab.remoteStatus === 'submitting' && ((t >> 4) & 1) === 1)) g.textCenter(s.text, 202, s.color);
  if (((t >> 4) & 1) === 0) g.textCenter('PRESS ENTER', 220, C.white);
}
