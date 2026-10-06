import services from '../content/services.json';
import { CATALOG_ORDER, CLONE_SPEED, PICKUP_THRESHOLD_STEP, PICKUP_TTL, SCORE_PICKUP } from './constants';
import { bfsNearest, sameTile } from './maze';
import { advanceMover, occupiedTile } from './movement';
import { pick } from './rng';
import { addScore, eatBugAt } from './scoring';
import type { GameState, PowerKind, Vec } from './types';

/** One `services.json` entry (overview §5.7). */
export interface ServiceDef {
  kind: PowerKind;
  label: string;
  name: string;
  durationTicks: number;
  color: number;
  effect: string;
}

const LABEL_RE = /^[A-Z]{3}$/;

function fail(msg: string): never {
  throw new Error(`services.json invalid: ${msg}`);
}

/** Load-time validation: kinds and order exactly CATALOG_ORDER, label `^[A-Z]{3}$`, duration 1..3600, color 0..15. */
export function validateCatalog(raw: unknown): ServiceDef[] {
  if (!Array.isArray(raw)) fail('not an array');
  if (raw.length !== CATALOG_ORDER.length) fail(`expected ${CATALOG_ORDER.length} entries, found ${raw.length}`);
  return raw.map((item: unknown, i): ServiceDef => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) fail(`entry ${i} is not an object`);
    const o = item as Record<string, unknown>;
    const kind = CATALOG_ORDER[i] as PowerKind;
    if (o.kind !== kind) fail(`entry ${i} kind must be "${kind}"`);
    if (typeof o.label !== 'string' || !LABEL_RE.test(o.label)) fail(`entry ${i} label must match ^[A-Z]{3}$`);
    if (typeof o.name !== 'string' || o.name.length === 0) fail(`entry ${i} name must be a non-empty string`);
    const d = o.durationTicks;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 3600) {
      fail(`entry ${i} durationTicks must be an integer 1..3600`);
    }
    const c = o.color;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 15) fail(`entry ${i} color must be 0..15`);
    if (typeof o.effect !== 'string' || o.effect.length === 0) fail(`entry ${i} effect must be a non-empty string`);
    return { kind, label: o.label, name: o.name, durationTicks: d, color: c, effect: o.effect };
  });
}

/** The validated power-up catalog in CATALOG_ORDER (single source of truth for engine, render and MCP). */
export const CATALOG: readonly ServiceDef[] = Object.freeze(validateCatalog(services));

export function serviceDef(kind: PowerKind): ServiceDef {
  return CATALOG[CATALOG_ORDER.indexOf(kind)] as ServiceDef;
}

export function durationOf(kind: PowerKind): number {
  return serviceDef(kind).durationTicks;
}

/** `isActive(s, k) := (s.active[k] ?? 0) > 0`. */
export function isActive(state: GameState, kind: PowerKind): boolean {
  return (state.active[kind] ?? 0) > 0;
}

/**
 * Phase (2), first in every playing step: decrement each active timer in CATALOG_ORDER; at 0 remove it.
 * Expiry side effects: autoscaling → clone removed; cloudfront → warpLock reset.
 */
export function tickPowerUps(state: GameState): void {
  for (const kind of CATALOG_ORDER) {
    const left = state.active[kind];
    if (left === undefined || left <= 0) continue;
    const next = left - 1;
    if (next > 0) {
      state.active[kind] = next;
      continue;
    }
    delete state.active[kind];
    if (kind === 'autoscaling') state.clone = null;
    else if (kind === 'cloudfront') state.player.warpLock = -1;
  }
}

/**
 * Applies exactly the collection effect: `active[kind] = duration` (reset, no stacking), the clone spawn rule
 * (only when no clone exists), `stats.servicesUsed[kind]++`, and a `powerUpPickup` event.
 * It does NOT add the 50-point pickup score (`collectPickup` does). Used by pickups, QA hooks and P3 grants.
 */
export function applyPowerUp(state: GameState, kind: PowerKind): void {
  state.active[kind] = durationOf(kind);
  state.stats.servicesUsed[kind] += 1;
  state.events.push({ type: 'powerUpPickup', kind });
  if (kind === 'autoscaling' && state.clone === null) {
    const at = { x: state.player.tile.x, y: state.player.tile.y };
    state.clone = { tile: at, dir: 0, progress: 0 };
    state.events.push({ type: 'cloneSpawn', at: { x: at.x, y: at.y } });
  }
}

/** Player-only pickup collection at `occ(player)`: +50 then the collection effect. */
export function collectPickup(state: GameState): void {
  const p = state.pickup;
  if (p === null || !sameTile(p.at, occupiedTile(state.player))) return;
  state.pickup = null;
  addScore(state, SCORE_PICKUP);
  applyPowerUp(state, p.kind);
}

/**
 * Phase (8) spawn rule: `if (bugsEatenThisLevel >= nextPickupThreshold) { nextPickupThreshold += 60;
 * if (pickup === null) spawn }`. Spawn draws the kind first, then a slot (row-major, excluding occ(player));
 * with no slot left there is no spawn and no second draw. Returns true when a pickup spawned this step.
 */
export function maybeSpawnPickup(state: GameState): boolean {
  if (state.bugsEatenThisLevel < state.nextPickupThreshold) return false;
  state.nextPickupThreshold += PICKUP_THRESHOLD_STEP;
  if (state.pickup !== null) return false;
  const kind = pick(state.rng, CATALOG_ORDER);
  const occ = occupiedTile(state.player);
  const slots = state.maze.slots.filter((s) => !sameTile(s, occ));
  if (slots.length === 0) return false;
  const slot = pick(state.rng, slots) as Vec;
  state.pickup = { kind, at: { x: slot.x, y: slot.y }, ttl: PICKUP_TTL };
  state.events.push({ type: 'powerUpSpawn', kind, at: { x: slot.x, y: slot.y } });
  return true;
}

/** Phase (8) after the spawn rule: a pickup that existed before this step loses 1 ttl and vanishes at 0. */
export function tickPickup(state: GameState, spawnedThisStep: boolean): void {
  if (spawnedThisStep || state.pickup === null) return;
  state.pickup.ttl -= 1;
  if (state.pickup.ttl <= 0) state.pickup = null;
}

/** Phase (5): the Auto Scaling clone BFSes to the nearest bug at speed 32 and eats at `occ(clone)`. */
export function updateClone(state: GameState): void {
  const clone = state.clone;
  if (clone === null) return;
  const { maze, bugs } = state;
  advanceMover(maze, clone, CLONE_SPEED, (m) => bfsNearest(maze, m.tile, (x, y) => bugs[y * maze.w + x] === 1));
  eatBugAt(state, occupiedTile(clone), 'clone');
}

/**
 * Binding warp check at the end of phase (4), only while CloudFront is active.
 * Arriving on pad i (tile changed this step, or standing still on it) teleports to pad (i+1) mod 4 with
 * progress 0 (direction kept, leftover dropped); the arrival pad is locked until the player leaves it.
 */
export function warpCheck(state: GameState, tileChangedThisStep: boolean): void {
  if (!isActive(state, 'cloudfront')) return;
  const p = state.player;
  const pads = state.maze.pads;
  const i = pads.findIndex((pad) => sameTile(pad, p.tile));
  if (i === -1) {
    p.warpLock = -1;
    return;
  }
  if (i !== p.warpLock && (tileChangedThisStep || p.progress === 0)) {
    const j = (i + 1) % pads.length;
    const dest = pads[j] as Vec;
    p.tile = { x: dest.x, y: dest.y };
    p.progress = 0;
    p.warpLock = j;
    state.events.push({ type: 'warp', from: i, to: j });
  }
}
