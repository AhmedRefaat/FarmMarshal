/**
 * catalogues.test.ts — L1/L5 gates from docs/LOCALIZATION_SPEC.md §7.
 * Guards the two failure modes that would otherwise ship silently:
 *   1. a new screen adds English keys and forgets the Arabic ones;
 *   2. an Arabic plural record omits a category Intl actually selects.
 */

import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ar } from './ar';

const AR_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

describe('L1 — catalogue parity', () => {
  it('exposes an identical key set in both locales', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps plural-shaped keys plural in both locales', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const isPlural = typeof en[key] === 'object';
      expect(
        typeof (ar as Record<string, unknown>)[key] === 'object',
        `${key} must be a plural record in both catalogues`
      ).toBe(isPlural);
    }
  });
});

describe('L5 — Arabic plural completeness', () => {
  it('authors every category Intl.PluralRules("ar") can select', () => {
    for (const [key, value] of Object.entries(ar)) {
      if (typeof value !== 'object') continue;
      for (const category of AR_CATEGORIES) {
        expect(
          (value as Record<string, string>)[category],
          `${key} is missing the "${category}" form`
        ).toBeTypeOf('string');
      }
    }
  });

  it('covers the counts that map to each Arabic category', () => {
    const rules = new Intl.PluralRules('ar-EG-u-ca-gregory-nu-latn');
    expect(rules.select(0)).toBe('zero');
    expect(rules.select(1)).toBe('one');
    expect(rules.select(2)).toBe('two');
    expect(rules.select(3)).toBe('few');
    expect(rules.select(11)).toBe('many');
    expect(rules.select(100)).toBe('other');
  });
});

describe('L5 — locale tags force Gregorian dates and Western digits', () => {
  const tag = 'ar-EG-u-ca-gregory-nu-latn';

  it('does not fall back to the Hijri calendar', () => {
    const resolved = new Intl.DateTimeFormat(tag).resolvedOptions();
    expect(resolved.calendar).toBe('gregory');
    expect(resolved.numberingSystem).toBe('latn');
  });

  it('renders numbers with Western digits', () => {
    expect(new Intl.NumberFormat(tag).format(2026)).toMatch(/^[\d,]+$/);
  });
});
