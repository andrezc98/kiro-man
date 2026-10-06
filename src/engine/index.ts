/** Public engine API shared by the browser app, the Lambda and the MCP server. */
export * from './types';
export * from './constants';
export { createRng, nextInt, nextU32, pick } from './rng';
export type { Rng } from './rng';
export { createRecorder, DIR_ORDER, DIR_VEC, isDir, reverse } from './input';
export type { InputLog, Recorder } from './input';
export {
  bfsNearest,
  bfsNextStep,
  InvalidMazeError,
  isPassable,
  loadMaze,
  parseMaze,
  reachableFrom,
  validateMaze,
} from './maze';
export { LEVELS, levelFor } from './levels';
export type { LevelDef } from './levels';
export { advanceMover, occupiedTile } from './movement';
export { CATALOG, applyPowerUp, durationOf, isActive, serviceDef, tickPowerUps } from './powerups';
export type { ServiceDef } from './powerups';
export { cloneState, createGame, forceGameOver, isDark, step } from './game';
