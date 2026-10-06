/**
 * Credit arithmetic (coin-credit-system design "APIs", overview §6). The only code that computes credits:
 * the cabinet reducer calls these and never does arithmetic on credits itself, so 0..99 is owned here.
 */

export const MAX_CREDITS = 99;

/** One coin: +1 credit capped at 99. A coin at 99 is rejected and leaves credits unchanged. */
export function insertCoin(credits: number): { credits: number; accepted: boolean } {
  if (credits >= MAX_CREDITS) return { credits: MAX_CREDITS, accepted: false };
  return { credits: credits + 1, accepted: true };
}

/** A start costs exactly one credit; with 0 credits nothing happens. */
export function tryStart(credits: number): { credits: number; started: boolean } {
  if (credits >= 1) return { credits: credits - 1, started: true };
  return { credits, started: false };
}
