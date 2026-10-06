import { DYING_TICKS, SCORE_SHIELD_BLOCK, SHIELD_INVULN_TICKS } from './constants';
import { sendHome } from './enemies';
import { sameTile } from './maze';
import { occupiedTile } from './movement';
import { isActive } from './powerups';
import { addScore } from './scoring';
import type { GameState, Vec } from './types';

/** Occupied tiles captured in phase (3), before any movement. `enemies[i]` follows ENEMY_ORDER. */
export interface PrevOcc {
  player: Vec;
  enemies: Vec[];
}

export function capturePrevOcc(state: GameState): PrevOcc {
  return { player: occupiedTile(state.player), enemies: state.enemies.map((e) => occupiedTile(e)) };
}

/**
 * Phase (7). Enemy `e` collides iff `occ(player) == occ(e)` OR (`occ(player) == prevOcc(e)` AND
 * `occ(e) == prevOcc(player)`). Skipped while `player.invuln > 0` and for pen enemies. Enemies are checked in
 * ENEMY_ORDER: with Shield the first one is blocked and the 30-tick invulnerability covers the rest; without
 * Shield the first one kills.
 */
export function resolveCollisions(state: GameState, prev: PrevOcc): void {
  const player = state.player;
  if (player.invuln > 0) return;
  const pOcc = occupiedTile(player);
  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    if (enemy === undefined || enemy.mode === 'pen') continue;
    const eOcc = occupiedTile(enemy);
    const ePrev = prev.enemies[i] as Vec;
    const hit = sameTile(pOcc, eOcc) || (sameTile(pOcc, ePrev) && sameTile(eOcc, prev.player));
    if (!hit) continue;
    if (isActive(state, 'shield')) {
      delete state.active.shield;
      addScore(state, SCORE_SHIELD_BLOCK);
      player.invuln = SHIELD_INVULN_TICKS;
      state.stats.shieldBlocks += 1;
      state.events.push({ type: 'shieldBlock', enemy: enemy.id });
      sendHome(state, enemy);
      return;
    }
    state.phase = 'dying';
    state.phaseTimer = DYING_TICKS;
    state.lives -= 1;
    state.lastKiller = enemy.id;
    state.events.push({ type: 'death', enemy: enemy.id });
    state.active = {};
    state.clone = null;
    state.pickup = null;
    return;
  }
}
