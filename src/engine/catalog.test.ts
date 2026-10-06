import { describe, expect, it } from 'vitest';
import services from '../content/services.json';
import { CATALOG_ORDER } from './constants';
import { CATALOG, durationOf, validateCatalog } from './powerups';

const valid = (): Record<string, unknown>[] => structuredClone(services) as Record<string, unknown>[];

describe('services.json catalog', () => {
  it('loads in CATALOG_ORDER with the binding durations and labels', () => {
    expect(CATALOG.map((s) => s.kind)).toEqual([...CATALOG_ORDER]);
    expect(CATALOG.map((s) => s.label)).toEqual(['LMB', 'SHD', 'ASG', 'CDN', 'CWT']);
    expect(CATALOG_ORDER.map(durationOf)).toEqual([360, 600, 300, 480, 480]);
    expect(CATALOG[0]).toEqual({
      kind: 'lambda',
      label: 'LMB',
      name: 'AWS Lambda',
      durationTicks: 360,
      color: 9,
      effect: 'Player speed 48',
    });
  });

  it('rejects a non-array or a wrong length', () => {
    expect(() => validateCatalog({})).toThrow(/services\.json invalid/);
    expect(() => validateCatalog(valid().slice(0, 4))).toThrow(/services\.json invalid/);
  });

  it('rejects entries out of CATALOG_ORDER', () => {
    const v = valid();
    [v[0], v[1]] = [v[1] as Record<string, unknown>, v[0] as Record<string, unknown>];
    expect(() => validateCatalog(v)).toThrow(/kind must be "lambda"/);
  });

  it.each([
    ['label', 'lmb'],
    ['label', 'LMBD'],
    ['durationTicks', 0],
    ['durationTicks', 3601],
    ['durationTicks', 1.5],
    ['color', 16],
    ['color', -1],
    ['name', ''],
    ['effect', 7],
  ])('rejects %s = %j', (field, value) => {
    const v = valid();
    (v[2] as Record<string, unknown>)[field] = value;
    expect(() => validateCatalog(v)).toThrow(/services\.json invalid/);
  });
});
