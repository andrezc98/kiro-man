/**
 * The Incident Report (CC-5.1, CC-6): incident number (seed in hex), root cause, final score, level
 * reached, bugs fixed, services used with counts, and one sourced AWS fact, uppercased and word-wrapped
 * to 36 characters. Enter is locked out for the first 60 UI ticks (the prompt appears after it).
 */
import { TIMINGS, rootCause } from '../../arcade/cabinet';
import type { GameSummary } from '../../arcade/cabinet';
import { pickFact } from '../../content/facts';
import { CATALOG } from '../../engine';
import type { Gfx } from '../gfx';
import { C } from '../palette';
import { POWER_SPRITE } from '../sprites';
import { scoreText } from '../view';
import type { RenderView } from '../view';

export const FACT_LINE_CHARS = 36;

/**
 * Greedy word wrap to `width` characters per line. Runs of spaces collapse; a word longer than the line
 * is hard-split across lines.
 */
export function wrapText(text: string, width: number = FACT_LINE_CHARS): string[] {
  if (width < 1) throw new RangeError('wrapText width must be >= 1');
  const lines: string[] = [];
  let line = '';
  for (const raw of text.split(/\s+/)) {
    let word = raw;
    if (word.length === 0) continue;
    while (word.length > 0) {
      if (line.length === 0) {
        if (word.length <= width) {
          line = word;
          word = '';
        } else {
          lines.push(word.slice(0, width));
          word = word.slice(width);
        }
      } else if (line.length + 1 + word.length <= width) {
        line = `${line} ${word}`;
        word = '';
      } else {
        lines.push(line);
        line = '';
      }
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** "INCIDENT #00C0FFEE": the seed as 8 uppercase hex digits. */
export function incidentNumber(seed: number): string {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/** The host part of a fact's source URL, uppercased for the pixel font. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.toUpperCase();
  } catch {
    return 'AWS DOCUMENTATION';
  }
}

function drawSummary(g: Gfx, s: GameSummary, t: number): void {
  const label = (text: string, y: number): void => {
    g.text(text, 16, y, C.lightGrey);
  };
  label('ROOT CAUSE', 34);
  g.text(rootCause(s), 100, 34, C.red);
  label('FINAL SCORE', 46);
  g.text(scoreText(s.score), 100, 46, C.white);
  label('LEVEL REACHED', 58);
  g.text(String(s.level), 100, 58, C.green);
  label('BUGS FIXED', 70);
  g.text(String(s.bugsEaten), 100, 70, C.green);
  label('SERVICES USED', 84);
  CATALOG.forEach((d, i) => {
    const x = 16 + i * 60;
    const n = s.servicesUsed[d.kind] ?? 0;
    const used = n > 0;
    g.sprite(POWER_SPRITE[d.kind], used ? (t >> 4) & 1 : 0, x, 95, used ? undefined : { solid: C.darkGrey });
    g.text(`${d.label} X${n}`, x + 11, 96, used ? d.color : C.darkGrey);
  });
}

export function drawIncident(g: Gfx, view: RenderView): void {
  const cab = view.cabinet;
  const s = cab.summary;
  const t = cab.screenTicks;
  g.clear(C.black);
  // Header: a red alert bar that pulses for the first second.
  const alert = t < 60 && ((t >> 3) & 1) === 1 ? C.plum : C.red;
  g.rect(0, 0, 320, 14, alert);
  g.text('INCIDENT REPORT', 6, 4, C.white);
  if (s === null) {
    g.textCenter('NO INCIDENT DATA', 120, C.lightGrey);
    return;
  }
  g.textRight(`#${incidentNumber(s.seed)}`, 314, 4, C.white);
  g.text('SEV-1  STATUS: GAME OVER', 16, 20, C.orange);
  drawSummary(g, s, t);

  // Lessons learned: one fact about a service used this game (DynamoDB when none were).
  const fact = pickFact(s.servicesUsed, s.seed);
  const lines = wrapText(fact.text.toUpperCase());
  const boxY = 112;
  const boxH = 22 + lines.length * 9 + 12;
  g.frame(40, boxY, 240, boxH, C.blue);
  g.rect(41, boxY + 1, 238, 10, C.night);
  g.text('LESSONS LEARNED: DID YOU KNOW?', 48, boxY + 3, C.yellow);
  lines.forEach((line, i) => g.text(line, 48, boxY + 16 + i * 9, C.white));
  g.text(`SOURCE: ${sourceHost(fact.sourceUrl)}`, 48, boxY + 18 + lines.length * 9, C.darkGrey);

  if (cab.localQualifies && ((t >> 3) & 1) === 0) g.textCenter('NEW LOCAL HIGH SCORE!', 206, C.pink);
  if (t >= TIMINGS.incidentLockoutTicks && ((t >> 4) & 1) === 0) g.textCenter('PRESS ENTER', 222, C.white);
}
