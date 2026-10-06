/**
 * Runtime config (LB-7.1, LB-7.2a, overview §7.2). `main.ts` awaits `loadConfig()` once before
 * `initialCabinet(apiUrl !== null)`, so the online flag is fixed for the session. Any failure means
 * offline mode with a `console.info("offline mode: <reason>")`. Never throws.
 */

export const CONFIG_URL = './config.json';
export const CONFIG_TIMEOUT_MS = 2000;

export interface AppConfig {
  apiUrl: string | null;
}

export interface LoadConfigDeps {
  fetch: typeof fetch;
  /** Abort-signal factory; defaults to `AbortSignal.timeout`. */
  timeoutSignal?: (ms: number) => AbortSignal;
  info?: (m: string) => void;
  url?: string;
  timeoutMs?: number;
}

/** True when `s` parses with `new URL` and uses http or https. */
export function isValidApiUrl(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function loadConfig(deps: LoadConfigDeps): Promise<AppConfig> {
  const info = deps.info ?? ((m: string) => console.info(m));
  const offline = (reason: string): AppConfig => {
    info(`offline mode: ${reason}`);
    return { apiUrl: null };
  };
  let signal: AbortSignal;
  let res: Response;
  try {
    signal = (deps.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms)))(deps.timeoutMs ?? CONFIG_TIMEOUT_MS);
    res = await deps.fetch(deps.url ?? CONFIG_URL, { signal, cache: 'no-store' });
  } catch (e) {
    const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return offline(aborted ? 'config.json timed out' : 'config.json could not be fetched');
  }
  if (!res.ok) return offline(`config.json answered HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return offline(signal.aborted ? 'config.json timed out' : 'config.json is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return offline('config.json is not an object');
  const apiUrl = (body as Record<string, unknown>).apiUrl;
  if (!isValidApiUrl(apiUrl)) return offline('config.json has no valid http(s) apiUrl');
  return { apiUrl };
}
