/** Types for scripts/confirm-deploy.mjs (the hook script itself stays plain JavaScript so Kiro runs it with `node`). */
export declare const DEPLOY_RE: RegExp;
export declare const BLOCK_REASON: string;
export declare function decide(
  payload: unknown,
  env: Record<string, string | undefined>,
): { block: boolean; reason: string | null };
