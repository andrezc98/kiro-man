/**
 * Original 8x8 pixel art (AP-2.3), stored as rows of hex palette indices with `.` for transparent.
 * Every moving actor has two animation frames. Power-up icons are generic symbols drawn for this game
 * (a bolt, a shield, a copy stack, a globe, an eye) next to 3-letter text labels; no official logos.
 *
 * Hex digits: 0 black 1 night 2 plum 3 dark green 4 rust 5 dark grey 6 light grey 7 white 8 red
 * 9 orange a yellow b green c blue d Kiro purple e pink f peach.
 */
import type { EnemyId, PowerKind } from '../engine';

export const SPRITE_SIZE = 8;

export type SpriteId =
  | 'kiro'
  | 'clone'
  | 'latency'
  | 'throttle'
  | 'coldstart'
  | 'outage'
  | 'bug'
  | 'lambda'
  | 'shield'
  | 'autoscaling'
  | 'cloudfront'
  | 'cloudwatch'
  | 'pad'
  | 'rack'
  | 'door';

/** `SPRITES[id][frame][row]`, each row 8 characters from `0-9a-f.`. */
export const SPRITES: Readonly<Record<SpriteId, readonly (readonly string[])[]>> = {
  // The player: Kiro's ghost, purple with a white highlight, eyes looking right (flipped for left).
  kiro: [
    ['..dddd..', '.d7dddd.', 'd77dd77d', 'd71dd71d', 'dddddddd', 'dddddddd', 'dddddddd', 'd.dd.dd.'],
    ['..dddd..', '.d7dddd.', 'd77dd77d', 'd71dd71d', 'dddddddd', 'dddddddd', 'dddddddd', '.dd.dd.d'],
  ],
  // The Auto Scaling clone: the same ghost rendered as a green replica with hollow eyes.
  clone: [
    ['..bbbb..', '.b7bbbb.', 'b77bb77b', 'b73bb73b', 'bbbbbbbb', 'b3bbbb3b', 'bbbbbbbb', 'b.bb.bb.'],
    ['..bbbb..', '.b7bbbb.', 'b77bb77b', 'b73bb73b', 'bbbbbbbb', 'b3bbbb3b', 'bbbbbbbb', '.bb.bb.b'],
  ],
  // Latency: a sulking hourglass whose sand drains between frames.
  latency: [
    ['99999999', '.9aaaa9.', '.90aa09.', '..9aa9..', '..9..9..', '.9....9.', '9.aaaa.9', '99999999'],
    ['99999999', '.9.aa.9.', '.90aa09.', '..9aa9..', '..9a.9..', '.9.aa.9.', '9aaaaaa9', '99999999'],
  ],
  // Throttle: a red blob wearing a white limiter bar, legs scuttling.
  throttle: [
    ['..8888..', '.888888.', '88788788', '88088088', '88888888', '87777778', '88888888', '.8.88.8.'],
    ['..8888..', '.888888.', '88788788', '88088088', '88888888', '87777778', '88888888', '8.8..8.8'],
  ],
  // Cold Start: a frosty ice cube with a glint that moves.
  coldstart: [
    ['cccccccc', 'c77ccccc', 'c7cccc6c', 'cc1cc1cc', 'cccccccc', 'c6cccc7c', 'cccccccc', '.c.cc.c.'],
    ['cccccccc', 'cccccc7c', 'c6cccc7c', 'cc1cc1cc', 'cccccccc', 'c7cccc6c', 'cccccccc', 'c.c..c.c'],
  ],
  // Outage: a storm cloud with red eyes dropping lightning.
  outage: [
    ['..2222..', '.222222.', '22222222', '28822882', '22222222', '.222222.', '..a..a..', '.a..a...'],
    ['..2222..', '.222222.', '22222222', '28822882', '22222222', '.222222.', '...a..a.', '..a..a..'],
  ],
  // A bug (pellet): a tiny green beetle wiggling its legs.
  bug: [
    ['........', '........', '..3..3..', '...bb...', '..3bb3..', '...33...', '........', '........'],
    ['........', '........', '...33...', '..3bb3..', '...bb...', '..3..3..', '........', '........'],
  ],
  // AWS Lambda pickup: a lightning bolt (speed).
  lambda: [
    ['....99..', '...99...', '..99....', '.999999.', '....99..', '...99...', '..99....', '.9......'],
    ['....aa..', '...aa...', '..aa....', '.aaaaaa.', '....aa..', '...aa...', '..aa....', '.a......'],
  ],
  // AWS Shield pickup: a heater shield with a highlight.
  shield: [
    ['cccccccc', 'c7cccc1c', 'c7cccc1c', 'c7cccc1c', 'c7cccc1c', '.c7cc1c.', '..cccc..', '...cc...'],
    ['77777777', '7c7777c7', '7c7777c7', '7c7777c7', '7c7777c7', '.7c77c7.', '..7777..', '...77...'],
  ],
  // EC2 Auto Scaling pickup: two stacked copies (scale out).
  autoscaling: [
    ['bbbbb...', 'b...b...', 'b.bbbbb.', 'b.b.b.b.', 'bbbbb.b.', '..b...b.', '..bbbbb.', '........'],
    ['........', '.bbbbb..', '.b...b..', '.b.bbbbb', '.b.b.b.b', '.bbbbb.b', '...b...b', '...bbbbb'],
  ],
  // CloudFront pickup: a globe with meridians (edge locations around the world).
  cloudfront: [
    ['..eeee..', '.e.ee.e.', 'e..ee..e', 'eeeeeeee', 'e..ee..e', '.e.ee.e.', '..eeee..', '........'],
    ['..eeee..', '.ee.e.e.', 'e.ee..ee', 'eeeeeeee', 'e.ee..ee', '.ee.e.e.', '..eeee..', '........'],
  ],
  // CloudWatch pickup: an eye that blinks.
  cloudwatch: [
    ['........', '..aaaa..', '.aa11aa.', 'aa1171aa', 'aa1111aa', '.aa11aa.', '..aaaa..', '........'],
    ['........', '........', '........', 'aaaaaaaa', '.aaaaaa.', '..aaaa..', '........', '........'],
  ],
  // CloudFront edge pad: concentric rings that pulse while CloudFront is active.
  pad: [
    ['..eeee..', '.e....e.', 'e..ee..e', 'e.e..e.e', 'e.e..e.e', 'e..ee..e', '.e....e.', '..eeee..'],
    ['........', '..eeee..', '.e....e.', '.e.ee.e.', '.e.ee.e.', '.e....e.', '..eeee..', '........'],
  ],
  // A server-rack wall tile: two rack units with status LEDs (the second frame blinks them).
  rack: [
    ['11111111', '1b111111', '15555551', '11111111', '11111111', '111111a1', '15555551', '11111111'],
    ['11111111', '13111111', '15555551', '11111111', '11111111', '11111191', '15555551', '11111111'],
  ],
  // The enemy pen door.
  door: [['........', '........', '........', 'eeeeeeee', 'e7e7e7e7', '........', '........', '........']],
};

export const ENEMY_SPRITE: Readonly<Record<EnemyId, SpriteId>> = {
  latency: 'latency',
  throttle: 'throttle',
  coldstart: 'coldstart',
  outage: 'outage',
};

/** Each enemy's signature color (CloudWatch outlines, roster text). */
export const ENEMY_COLOR: Readonly<Record<EnemyId, number>> = {
  latency: 9,
  throttle: 8,
  coldstart: 12,
  outage: 14,
};

export const POWER_SPRITE: Readonly<Record<PowerKind, SpriteId>> = {
  lambda: 'lambda',
  shield: 'shield',
  autoscaling: 'autoscaling',
  cloudfront: 'cloudfront',
  cloudwatch: 'cloudwatch',
};

/** Palette index of a sprite pixel character, or null for transparent. */
export function pixelIndex(ch: string): number | null {
  if (ch === '.') return null;
  const n = Number.parseInt(ch, 16);
  return Number.isNaN(n) ? null : n;
}

/** Problems with the sprite table (empty when valid): sizes, frame counts and characters. */
export function validateSprites(sprites: Readonly<Record<string, readonly (readonly string[])[]>> = SPRITES): string[] {
  const problems: string[] = [];
  for (const [id, frames] of Object.entries(sprites)) {
    if (frames.length < 1 || frames.length > 2) problems.push(`${id}: ${frames.length} frames`);
    frames.forEach((rows, f) => {
      if (rows.length !== SPRITE_SIZE) problems.push(`${id}[${f}]: ${rows.length} rows`);
      rows.forEach((row, r) => {
        if (row.length !== SPRITE_SIZE) problems.push(`${id}[${f}][${r}]: width ${row.length}`);
        if (!/^[0-9a-f.]*$/.test(row)) problems.push(`${id}[${f}][${r}]: bad character in "${row}"`);
      });
    });
  }
  return problems;
}
