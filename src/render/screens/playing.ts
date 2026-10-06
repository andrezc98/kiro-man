/**
 * The playing screen (AP-3): the server-rack maze, bugs, edge pads, the power-up pickup, Outage darkness,
 * the CloudWatch target overlay, the clone, the four enemies and Kiro, interpolated from tile + progress
 * and floored to whole pixels; plus READY / LEVEL CLEAR / PAUSED banners, the ghost-fade death animation,
 * and short render-only effects (score pop-ups, sparks) driven by engine events. Nothing here mutates
 * engine state.
 */
import {
  CATALOG,
  DIR_VEC,
  DYING_TICKS,
  ENEMY_ORDER,
  LEVEL_CLEAR_TICKS,
  READY_TICKS,
  Tile,
  isActive,
  isDark,
  levelFor,
} from '../../engine';
import type { Enemy, GameEvent, GameState, Maze, Mover, PowerKind } from '../../engine';
import { textWidth } from '../font';
import { bayer, createGfx } from '../gfx';
import type { Gfx, SpriteVariant } from '../gfx';
import { C } from '../palette';
import { ENEMY_COLOR, ENEMY_SPRITE, POWER_SPRITE } from '../sprites';
import { MAZE_Y, TILE_PX } from '../view';
import type { RenderView } from '../view';

const f = Math.floor;

/** Screen position of a mover: `tile*8 + dir*progress*8/256`, floored (AP-3.1, overview §5.4). */
export function moverPixel(m: Mover): { x: number; y: number } {
  const v = DIR_VEC[m.dir] ?? { x: 0, y: 0 };
  return {
    x: f(m.tile.x * TILE_PX + (v.x * m.progress * TILE_PX) / 256),
    y: f(m.tile.y * TILE_PX + (v.y * m.progress * TILE_PX) / 256) + MAZE_Y,
  };
}

function isWallAt(maze: Maze, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= maze.w || y >= maze.h) return true;
  return maze.cells[y * maze.w + x] === Tile.Wall;
}

function ledHash(x: number, y: number): number {
  return (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
}

type BgMode = 0 | 1 | 'flash';

/** Pre-renders the static maze: rack tiles with glowing edges facing the aisles, the pen door, pen floor. */
function buildBackground(g: Gfx, maze: Maze, mode: BgMode): CanvasImageSource {
  const s = g.makeSurface(maze.w * TILE_PX, maze.h * TILE_PX);
  const bg = createGfx(s.ctx, g.makeSurface);
  const edge = mode === 'flash' ? C.white : C.blue;
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      const px = x * TILE_PX;
      const py = y * TILE_PX;
      const cell = maze.cells[y * maze.w + x];
      if (cell === Tile.Door) {
        bg.sprite('door', 0, px, py);
        continue;
      }
      if (cell === Tile.Pen) {
        bg.pixel(px + 3, py + 4, C.night);
        continue;
      }
      if (cell !== Tile.Wall) continue;
      if (mode === 'flash') bg.rect(px, py, TILE_PX, TILE_PX, C.night);
      else bg.sprite('rack', mode === 1 && ledHash(x, y) % 3 === 0 ? 1 : 0, px, py);
      const up = !isWallAt(maze, x, y - 1);
      const down = !isWallAt(maze, x, y + 1);
      const left = !isWallAt(maze, x - 1, y);
      const right = !isWallAt(maze, x + 1, y);
      if (up) bg.rect(px, py, TILE_PX, 1, edge);
      if (down) bg.rect(px, py + TILE_PX - 1, TILE_PX, 1, edge);
      if (left) bg.rect(px, py, 1, TILE_PX, edge);
      if (right) bg.rect(px + TILE_PX - 1, py, 1, TILE_PX, edge);
      // Inner corners: an open diagonal behind two wall neighbors gets a single edge pixel.
      if (!up && !left && !isWallAt(maze, x - 1, y - 1)) bg.pixel(px, py, edge);
      if (!up && !right && !isWallAt(maze, x + 1, y - 1)) bg.pixel(px + TILE_PX - 1, py, edge);
      if (!down && !left && !isWallAt(maze, x - 1, y + 1)) bg.pixel(px, py + TILE_PX - 1, edge);
      if (!down && !right && !isWallAt(maze, x + 1, y + 1)) bg.pixel(px + TILE_PX - 1, py + TILE_PX - 1, edge);
    }
  }
  return s.canvas;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  color: number;
  born: number;
  life: number;
}

interface Burst {
  x: number;
  y: number;
  color: number;
  born: number;
}

const POPUP_LIFE = 50;
const BURST_LIFE = 18;
const SHIELD_RING: readonly (readonly [number, number])[] = (() => {
  const pts: [number, number][] = [];
  for (let i = 2; i <= 9; i++) pts.push([i, 0], [i, 11], [0, i], [11, i]);
  pts.push([1, 1], [10, 1], [1, 10], [10, 10]);
  return pts.map(([x, y]) => [x - 2, y - 2] as const);
})();
const SPARK_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function serviceName(kind: PowerKind): string {
  return (CATALOG.find((d) => d.kind === kind)?.name ?? kind).toUpperCase();
}

function serviceColor(kind: PowerKind): number {
  return CATALOG.find((d) => d.kind === kind)?.color ?? C.white;
}

export interface PlayingLayer {
  /** Feed the events of every engine step (render-only effects). */
  onEvents(game: GameState, events: readonly GameEvent[]): void;
  reset(): void;
  draw(view: RenderView, game: GameState): void;
}

export function createPlayingLayer(g: Gfx): PlayingLayer {
  const backgrounds = new WeakMap<Maze, Map<BgMode, CanvasImageSource>>();
  let popups: Popup[] = [];
  let bursts: Burst[] = [];
  const padFlash = new Map<number, number>();
  let darkWall: CanvasImageSource | null = null;
  let darkEdge: CanvasImageSource | null = null;

  function background(maze: Maze, mode: BgMode): CanvasImageSource {
    let byMode = backgrounds.get(maze);
    if (byMode === undefined) {
      byMode = new Map();
      backgrounds.set(maze, byMode);
    }
    let img = byMode.get(mode);
    if (img === undefined) {
      img = buildBackground(g, maze, mode);
      byMode.set(mode, img);
    }
    return img;
  }

  function ditherTile(fill: number | null, threshold: number): CanvasImageSource {
    const s = g.makeSurface(TILE_PX, TILE_PX);
    const t = createGfx(s.ctx, g.makeSurface);
    if (fill !== null) t.rect(0, 0, TILE_PX, TILE_PX, fill);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) if (bayer(x, y) < threshold) t.pixel(x, y, C.black);
    }
    return s.canvas;
  }

  function popup(text: string, cx: number, y: number, color: number, born: number, life = POPUP_LIFE): void {
    const w = textWidth(text);
    const x = Math.min(Math.max(f(cx - w / 2), 2), 318 - w);
    popups.push({ text, x, y: Math.max(MAZE_Y, y), color, born, life });
  }

  function playerCenter(game: GameState): { x: number; y: number } {
    const p = moverPixel(game.player);
    return { x: p.x + 4, y: p.y + 4 };
  }

  const layer: PlayingLayer = {
    onEvents(game, events) {
      const t = game.tick;
      for (const e of events) {
        switch (e.type) {
          case 'powerUpSpawn':
            popup(
              CATALOG.find((d) => d.kind === e.kind)?.label ?? '',
              e.at.x * TILE_PX + 4,
              e.at.y * TILE_PX + MAZE_Y - 8,
              serviceColor(e.kind),
              t,
              60,
            );
            break;
          case 'powerUpPickup': {
            const c = playerCenter(game);
            popup(serviceName(e.kind), c.x, c.y - 14, serviceColor(e.kind), t, 70);
            bursts.push({ x: c.x, y: c.y, color: serviceColor(e.kind), born: t });
            break;
          }
          case 'shieldBlock': {
            const c = playerCenter(game);
            popup('+200 BLOCKED', c.x, c.y - 14, C.blue, t);
            bursts.push({ x: c.x, y: c.y, color: C.blue, born: t });
            break;
          }
          case 'cloneSpawn':
            popup('SCALE OUT!', e.at.x * TILE_PX + 4, e.at.y * TILE_PX + MAZE_Y - 10, C.green, t);
            break;
          case 'warp': {
            padFlash.set(e.from, t);
            padFlash.set(e.to, t);
            const c = playerCenter(game);
            bursts.push({ x: c.x, y: c.y, color: C.pink, born: t });
            break;
          }
          case 'levelClear':
            popup(`+${e.bonus} BONUS`, 160, MAZE_Y + (game.maze.pen[0]?.y ?? 12) * TILE_PX - 10, C.yellow, t, LEVEL_CLEAR_TICKS);
            break;
          default:
            break;
        }
      }
    },
    reset() {
      popups = [];
      bursts = [];
      padFlash.clear();
    },
    draw(view, game) {
      const tick = game.tick;
      const ui = view.cabinet.uiTick;
      const maze = game.maze;
      const dyingElapsed = game.phase === 'dying' ? DYING_TICKS - game.phaseTimer : -1;
      const shake = dyingElapsed >= 0 && dyingElapsed < 12 ? (tick & 1) * 2 - 1 : 0;
      const ox = shake;
      const oy = MAZE_Y;

      // 1. Static maze (LEDs blink by swapping two pre-rendered frames; LEVEL CLEAR flashes the racks).
      let mode: BgMode = ((ui >> 5) & 1) as 0 | 1;
      if (game.phase === 'levelClear' && (((LEVEL_CLEAR_TICKS - game.phaseTimer) >> 3) & 1) === 1) mode = 'flash';
      g.blit(background(maze, mode), ox, oy);

      // 2. Edge pads: dim while CloudFront is off, pulsing rings while it is on.
      const cdn = isActive(game, 'cloudfront');
      maze.pads.forEach((p, i) => {
        const flashAge = tick - (padFlash.get(i) ?? -1000);
        const v: SpriteVariant =
          flashAge >= 0 && flashAge < 20
            ? { solid: C.white }
            : cdn
              ? { remap: { 14: ((tick >> 3) + i) & 1 ? C.blue : C.pink } }
              : { solid: C.darkGrey };
        g.sprite('pad', cdn ? (tick >> 3) & 1 : 0, p.x * TILE_PX + ox, p.y * TILE_PX + oy, v);
      });

      // 3. Bugs, hidden on dark tiles (AP-3.2).
      const outage = game.enemies.find((e) => e.id === 'outage');
      const outageOut = outage !== undefined && outage.mode !== 'pen';
      for (let i = 0; i < game.bugs.length; i++) {
        if (game.bugs[i] !== 1) continue;
        const x = i % maze.w;
        const y = (i - x) / maze.w;
        if (outageOut && isDark(game, x, y)) continue;
        g.sprite('bug', ((tick >> 4) + x + y) & 1, x * TILE_PX + ox, y * TILE_PX + oy);
      }

      // 4. Outage darkness: dark tiles in palette 1/0 with a dithered rim one tile further out.
      if (outageOut && outage !== undefined) {
        darkWall ??= ditherTile(C.night, 6);
        darkEdge ??= ditherTile(null, 7);
        const R = 5;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const x = outage.tile.x + dx;
            const y = outage.tile.y + dy;
            if (x < 0 || y < 0 || x >= maze.w || y >= maze.h) continue;
            const px = x * TILE_PX + ox;
            const py = y * TILE_PX + oy;
            if (isDark(game, x, y)) {
              if (isWallAt(maze, x, y)) g.blit(darkWall, px, py);
              else g.rect(px, py, TILE_PX, TILE_PX, C.black);
            } else if (Math.abs(dx) + Math.abs(dy) === R) {
              g.blit(darkEdge, px, py);
            }
          }
        }
      }

      // 5. The pickup, blinking in its last 2 seconds.
      const pk = game.pickup;
      if (pk !== null && !(pk.ttl < 120 && ((tick >> 2) & 1) === 1)) {
        g.sprite(POWER_SPRITE[pk.kind], (tick >> 4) & 1, pk.at.x * TILE_PX + ox, pk.at.y * TILE_PX + oy);
      }

      const hideEnemies = dyingElapsed >= 24;

      // 6. CloudWatch: each released enemy's target tile as a blinking outline plus a dotted line (AP-3.3).
      if (isActive(game, 'cloudwatch') && !hideEnemies) {
        for (const e of game.enemies) {
          if (e.mode === 'pen') continue;
          const c = ENEMY_COLOR[e.id];
          const tx = e.target.x * TILE_PX + ox;
          const ty = e.target.y * TILE_PX + oy;
          const ep = moverPixel(e);
          g.line(ep.x + 4 + ox, ep.y + 4, tx + 4, ty + 4, c, 3, (tick >> 2) % 3);
          if (((tick >> 3) & 1) === 0) g.frame(tx, ty, TILE_PX, TILE_PX, c);
          else g.frame(tx + 1, ty + 1, TILE_PX - 2, TILE_PX - 2, c);
        }
      }

      // 7. The Auto Scaling clone (blinks before it scales in).
      const clone = game.clone;
      if (clone !== null && !hideEnemies) {
        const left = game.active.autoscaling ?? 0;
        if (!(left < 90 && ((tick >> 2) & 1) === 1)) {
          const cp = moverPixel(clone);
          g.sprite('clone', clone.dir === 0 ? 0 : (tick >> 2) & 1, cp.x + ox, cp.y, { flip: clone.dir === 4 });
        }
      }

      // 8. Enemies, in ENEMY_ORDER.
      if (!hideEnemies) {
        for (const id of ENEMY_ORDER) {
          const e = game.enemies.find((en) => en.id === id);
          if (e !== undefined) drawEnemy(e, tick, ox);
        }
      }

      // 9. Kiro.
      drawPlayer(game, tick, ox, dyingElapsed);

      // 10. Render-only effects.
      drawEffects(tick);

      // 11. Banners.
      if (game.phase === 'ready') {
        const lv = levelFor(game.level);
        const sub = `LEVEL ${game.level}  ${lv.id} ${lv.name.toUpperCase()}`;
        banner(maze, 'READY!', C.yellow, sub, C.lightGrey, game.phaseTimer > READY_TICKS - 8);
      } else if (game.phase === 'levelClear') {
        banner(maze, 'LEVEL CLEAR', C.green, `${levelFor(game.level).id} SERVICE RESTORED`, C.lightGrey, false);
      }
      if (view.paused) banner(maze, 'PAUSED', C.white, 'PRESS P TO RESUME', C.lightGrey, false);
    },
  };

  function drawEnemy(e: Enemy, tick: number, ox: number): void {
    const p = moverPixel(e);
    let x = p.x + ox;
    let y = p.y;
    const sprite = ENEMY_SPRITE[e.id];
    if (e.mode === 'pen') {
      // Waiting in the pen: bob up and down, each enemy out of phase.
      y += ((tick + ENEMY_ORDER.indexOf(e.id) * 9) >> 4) & 1 ? -1 : 0;
      g.sprite(sprite, (tick >> 4) & 1, x, y);
      return;
    }
    if (e.cold?.phase === 'frozen') {
      // Frozen: frosted grey, shivering just before it dashes (a fair warning).
      if (e.cold.timer < 30) x += (tick >> 1) & 1 ? 1 : -1;
      g.sprite(sprite, 0, x, y, { remap: { 12: C.lightGrey, 6: C.white } });
      return;
    }
    if (e.cold?.phase === 'dash' && e.dir !== 0) {
      const v = DIR_VEC[e.dir] ?? { x: 0, y: 0 };
      g.sprite(sprite, 0, x - v.x * 4, y - v.y * 4, { solid: C.blue, dissolve: 10 });
    }
    const rate = e.id === 'latency' ? 4 : 3;
    g.sprite(sprite, (tick >> rate) & 1, x, y);
  }

  function drawPlayer(game: GameState, tick: number, ox: number, dyingElapsed: number): void {
    const pl = game.player;
    const p = moverPixel(pl);
    const x = p.x + ox;
    const flip = pl.facing === 4;
    if (dyingElapsed >= 0) {
      // Ghost-fade death: a beat of stillness, then Kiro flickers, rises and dissolves into sparks.
      if (dyingElapsed < 24) {
        g.sprite('kiro', 0, x, p.y, { flip, remap: (tick >> 2) & 1 ? { 13: C.white } : undefined });
        return;
      }
      const t = dyingElapsed - 24;
      const dissolve = Math.min(16, f(t / 3));
      const remap: Readonly<Record<number, number>> = t < 12 ? { 13: C.pink } : t < 24 ? { 13: C.lightGrey, 7: C.white } : { 13: C.darkGrey, 7: C.lightGrey };
      g.sprite('kiro', (tick >> 3) & 1, x, p.y - f(t / 6), { flip, remap, dissolve });
      if (t < 40) {
        const r = 4 + f(t / 2);
        SPARK_DIRS.forEach(([dx, dy], i) => {
          g.pixel(x + 4 + dx * r, p.y + 4 + dy * r, (i + (t >> 2)) & 1 ? C.white : C.purple);
        });
      }
      return;
    }
    if (pl.invuln > 0 && ((tick >> 1) & 1) === 1) return;
    const moving = pl.dir !== 0 && game.phase === 'playing';
    if (isActive(game, 'lambda') && moving) {
      const v = DIR_VEC[pl.dir] ?? { x: 0, y: 0 };
      g.sprite('kiro', 0, x - v.x * 6, p.y - v.y * 6, { flip, solid: C.rust, dissolve: 11 });
      g.sprite('kiro', 0, x - v.x * 3, p.y - v.y * 3, { flip, solid: C.orange, dissolve: 6 });
    }
    g.sprite('kiro', moving ? (tick >> 2) & 1 : 0, x, p.y, { flip });
    const shield = game.active.shield ?? 0;
    if (shield > 0 && !(shield < 120 && ((tick >> 2) & 1) === 1)) {
      SHIELD_RING.forEach(([dx, dy]) => g.pixel(x + dx, p.y + dy, C.blue));
      const [sx, sy] = SHIELD_RING[(tick >> 1) % SHIELD_RING.length] as readonly [number, number];
      g.pixel(x + sx, p.y + sy, C.white);
    }
  }

  function drawEffects(tick: number): void {
    popups = popups.filter((p) => tick - p.born >= 0 && tick - p.born < p.life);
    for (const p of popups) {
      const age = tick - p.born;
      if (age > p.life - 12 && ((age >> 1) & 1) === 1) continue;
      const y = p.y - f(age / 4);
      g.rect(p.x - 1, y - 1, textWidth(p.text) + 2, 9, C.black);
      g.text(p.text, p.x, y, p.color);
    }
    bursts = bursts.filter((b) => tick - b.born >= 0 && tick - b.born < BURST_LIFE);
    for (const b of bursts) {
      const r = 3 + (tick - b.born);
      for (const [dx, dy] of SPARK_DIRS) g.pixel(b.x + dx * r, b.y + dy * r, b.color);
    }
  }

  /** A boxed banner just below the enemy pen (so the pen and Kiro's spawn stay visible). */
  function banner(maze: Maze, title: string, titleColor: number, sub: string, subColor: number, hideTitle: boolean): void {
    const tw = textWidth(title, 2);
    const sw = textWidth(sub);
    const w = Math.max(tw, sw) + 16;
    const h = 34;
    const x = f(160 - w / 2);
    const penBottom = maze.pen.reduce((m, p) => Math.max(m, p.y), 0);
    const y = MAZE_Y + (penBottom + 1) * TILE_PX + 2;
    g.rect(x, y, w, h, C.black);
    g.frame(x, y, w, h, C.purple);
    g.frame(x + 2, y + 2, w - 4, h - 4, C.night);
    if (!hideTitle) g.textCenter(title, y + 6, titleColor, 2);
    g.textCenter(sub, y + 23, subColor);
  }

  return layer;
}
