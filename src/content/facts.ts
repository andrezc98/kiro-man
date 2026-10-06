/**
 * Incident Report facts (CC-6, overview §7.5). `aws-facts.json` is validated at module load; an invalid
 * file is a content error and throws `Error("aws-facts.json invalid: ...")`.
 */
import { CATALOG_ORDER } from '../engine/constants';
import type { PowerKind } from '../engine/types';
import rawFacts from './aws-facts.json';
import { usesOnlyFontGlyphs } from './glyphs';

export type FactService = PowerKind | 'dynamodb';

export interface Fact {
  id: string;
  service: FactService;
  text: string;
  sourceUrl: string;
}

const ID_RE = /^[a-z0-9-]+$/;
const ALLOWED_HOSTS: readonly string[] = ['docs.aws.amazon.com', 'aws.amazon.com'];
const MAX_TEXT = 120;
const MIN_PER_SERVICE = 2;
const SERVICES: readonly FactService[] = [...CATALOG_ORDER, 'dynamodb'];

function fail(msg: string): never {
  throw new Error(`aws-facts.json invalid: ${msg}`);
}

function isAllowedUrl(s: string): boolean {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname);
}

/** The load-time rules of CC-6.3. Returns the facts in file order or throws. */
export function validateFacts(raw: unknown): Fact[] {
  if (!Array.isArray(raw)) fail('not an array');
  const seen = new Set<string>();
  const facts = raw.map((item: unknown, i): Fact => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) fail(`entry ${i} is not an object`);
    const o = item as Record<string, unknown>;
    const { id, service, text, sourceUrl } = o;
    if (typeof id !== 'string' || !ID_RE.test(id)) fail(`entry ${i} id must match ^[a-z0-9-]+$`);
    if (seen.has(id)) fail(`duplicate id "${id}"`);
    seen.add(id);
    if (typeof service !== 'string' || !SERVICES.includes(service as FactService)) {
      fail(`fact "${id}" service must be one of ${SERVICES.join(', ')}`);
    }
    if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT) {
      fail(`fact "${id}" text must be 1..${MAX_TEXT} characters`);
    }
    if (!usesOnlyFontGlyphs(text.toUpperCase())) fail(`fact "${id}" text uses a character the pixel font lacks`);
    if (typeof sourceUrl !== 'string' || !isAllowedUrl(sourceUrl)) {
      fail(`fact "${id}" sourceUrl must be https on ${ALLOWED_HOSTS.join(' or ')}`);
    }
    return { id, service: service as FactService, text, sourceUrl };
  });
  for (const s of SERVICES) {
    const n = facts.filter((f) => f.service === s).length;
    if (n < MIN_PER_SERVICE) fail(`service "${s}" needs at least ${MIN_PER_SERVICE} facts, found ${n}`);
  }
  return facts;
}

/** The validated facts in file order. */
export const FACTS: readonly Fact[] = Object.freeze(validateFacts(rawFacts));

/**
 * Deterministic pick (CC-6.1): candidates are the facts of every service used at least once, in
 * CATALOG_ORDER then file order; with none used, the DynamoDB facts. Index `seed % n`.
 */
export function pickFact(servicesUsed: Partial<Record<PowerKind, number>>, seed: number): Fact {
  let candidates: Fact[] = [];
  for (const kind of CATALOG_ORDER) {
    if ((servicesUsed[kind] ?? 0) > 0) candidates.push(...FACTS.filter((f) => f.service === kind));
  }
  if (candidates.length === 0) candidates = FACTS.filter((f) => f.service === 'dynamodb');
  const n = candidates.length;
  return candidates[((seed % n) + n) % n] as Fact;
}
