import { describe, expect, it } from 'vitest';
import { CATALOG_ORDER } from '../engine/constants';
import rawFacts from './aws-facts.json';
import { FACTS, pickFact, validateFacts } from './facts';
import type { Fact } from './facts';
import { FONT_GLYPHS, usesOnlyFontGlyphs } from './glyphs';

const valid: Fact = {
  id: 'x-1',
  service: 'lambda',
  text: 'Text.',
  sourceUrl: 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html',
};

/** A minimal valid file: two facts for every power-up kind and for dynamodb. */
function minimalFile(): Fact[] {
  return [...CATALOG_ORDER, 'dynamodb' as const].flatMap((service) => [
    { ...valid, id: `${service}-a`, service },
    { ...valid, id: `${service}-b`, service },
  ]);
}

function withFirst(patch: Record<string, unknown>): unknown[] {
  const [first, ...rest] = minimalFile();
  return [{ ...first, ...patch }, ...rest];
}

describe('aws-facts.json', () => {
  it('every shipped fact passes load-time validation', () => {
    expect(() => validateFacts(rawFacts)).not.toThrow();
    expect(FACTS).toHaveLength(rawFacts.length);
  });

  it('every shipped fact is uppercase-renderable with the pixel font, <= 120 chars, with an allowed source', () => {
    for (const f of FACTS) {
      expect(f.text.length).toBeGreaterThan(0);
      expect(f.text.length).toBeLessThanOrEqual(120);
      for (const ch of f.text.toUpperCase()) expect(FONT_GLYPHS).toContain(ch);
      const url = new URL(f.sourceUrl);
      expect(url.protocol).toBe('https:');
      expect(['docs.aws.amazon.com', 'aws.amazon.com']).toContain(url.hostname);
    }
  });

  it('has at least two facts per power-up kind and for dynamodb, with unique ids', () => {
    for (const s of [...CATALOG_ORDER, 'dynamodb']) {
      expect(FACTS.filter((f) => f.service === s).length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(FACTS.map((f) => f.id)).size).toBe(FACTS.length);
  });
});

describe('validateFacts rejects', () => {
  it('a minimal valid file passes', () => {
    expect(validateFacts(minimalFile())).toHaveLength(12);
  });

  it.each<[string, unknown]>([
    ['a non-array', { facts: [] }],
    ['a non-object entry', [...minimalFile(), 'fact']],
    ['a duplicate id', [...minimalFile(), { ...valid, id: 'lambda-a' }]],
    ['an id with uppercase', withFirst({ id: 'Lambda-a' })],
    ['an id with a space', withFirst({ id: 'lambda a' })],
    ['an unknown service', withFirst({ service: 's3' })],
    ['empty text', withFirst({ text: '' })],
    ['text over 120 chars', withFirst({ text: 'A'.repeat(121) })],
    ['text with a glyph the font lacks', withFirst({ text: 'Lambda costs $0.' })],
    ['text with a non-ASCII char', withFirst({ text: 'Lambda é' })],
    ['an http URL', withFirst({ sourceUrl: 'http://docs.aws.amazon.com/x' })],
    ['a foreign host', withFirst({ sourceUrl: 'https://example.com/x' })],
    ['a lookalike host', withFirst({ sourceUrl: 'https://docs.aws.amazon.com.example.com/x' })],
    ['an unparseable URL', withFirst({ sourceUrl: 'not a url' })],
    ['a missing field', withFirst({ sourceUrl: undefined })],
    ['fewer than two facts for a kind', minimalFile().filter((f) => f.id !== 'cloudwatch-b')],
    ['fewer than two dynamodb facts', minimalFile().filter((f) => f.id !== 'dynamodb-a')],
  ])('%s', (_name, raw) => {
    expect(() => validateFacts(raw)).toThrow(/^aws-facts\.json invalid: /);
  });

  it('accepts aws.amazon.com and text at exactly 120 chars', () => {
    expect(() => validateFacts(withFirst({ sourceUrl: 'https://aws.amazon.com/lambda/' }))).not.toThrow();
    expect(() => validateFacts(withFirst({ text: 'a'.repeat(120) }))).not.toThrow();
  });
});

describe('pickFact', () => {
  const none = { lambda: 0, shield: 0, autoscaling: 0, cloudfront: 0, cloudwatch: 0 };

  it('falls back to DynamoDB facts when no service was used', () => {
    const dynamo = FACTS.filter((f) => f.service === 'dynamodb');
    for (let seed = 0; seed < 10; seed++) {
      expect(pickFact(none, seed)).toBe(dynamo[seed % dynamo.length]);
    }
    expect(pickFact({}, 7).service).toBe('dynamodb');
  });

  it('picks among used services in catalog order then file order, index seed % n', () => {
    const used = { ...none, cloudwatch: 1, lambda: 3 };
    const candidates = [
      ...FACTS.filter((f) => f.service === 'lambda'),
      ...FACTS.filter((f) => f.service === 'cloudwatch'),
    ];
    for (let seed = 0; seed < 20; seed++) expect(pickFact(used, seed)).toBe(candidates[seed % candidates.length]);
    expect(pickFact(used, 0xffffffff)).toBe(candidates[0xffffffff % candidates.length]);
  });

  it('is deterministic', () => {
    const used = { ...none, shield: 2 };
    expect(pickFact(used, 12345)).toBe(pickFact(used, 12345));
  });
});

describe('FONT_GLYPHS', () => {
  it('covers A-Z, 0-9 and space and every root-cause and status string the cabinet prints', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ') expect(FONT_GLYPHS).toContain(ch);
    for (const s of ['SHIFT ENDED (30:00)', 'MANUAL FAILOVER', 'COLD START CAUGHT KIRO', 'LOG TOO LONG', 'KIRO-MAN']) {
      expect(usesOnlyFontGlyphs(s)).toBe(true);
    }
  });

  it('has no lowercase letters and no duplicates', () => {
    expect(FONT_GLYPHS.every((g) => g === g.toUpperCase() && g.length === 1)).toBe(true);
    expect(new Set(FONT_GLYPHS).size).toBe(FONT_GLYPHS.length);
  });
});
