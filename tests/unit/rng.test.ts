import { describe, expect, it } from 'vitest';
import { createRngFromUrl, hashSeed, mulberry32, parseSeedFromSearch } from '../../src/utils/rng';

describe('mulberry32', () => {
  it('produces the exact same sequence for the same seed', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);

    const seqA = Array.from({ length: 10 }, () => rngA());
    const seqB = Array.from({ length: 10 }, () => rngB());

    expect(seqA).toEqual(seqB);
  });

  it('produces values strictly within [0, 1)', () => {
    const rng = mulberry32(123456);
    for (let i = 0; i < 200; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('produces different sequences for different seeds', () => {
    const rngA = mulberry32(7);
    const rngB = mulberry32(10);

    expect([rngA(), rngA(), rngA()]).not.toEqual([rngB(), rngB(), rngB()]);
  });
});

describe('parseSeedFromSearch & createRngFromUrl', () => {
  it('parses numeric ?seed= query parameter', () => {
    expect(parseSeedFromSearch('?seed=7')).toBe(7);
    expect(parseSeedFromSearch('?foo=bar&seed=2026')).toBe(2026);
  });

  it('hashes non-numeric string seeds deterministically', () => {
    const first = parseSeedFromSearch('?seed=pawnshop-test');
    const second = parseSeedFromSearch('?seed=pawnshop-test');
    expect(first).toBe(second);
    expect(first).toBe(hashSeed('pawnshop-test'));
  });

  it('falls back to provided timestamp when ?seed= is absent or empty', () => {
    expect(parseSeedFromSearch('', () => 9999)).toBe(9999);
    expect(parseSeedFromSearch('?seed=', () => 8888)).toBe(8888);
  });

  it('creates deterministic RNG from URL search string', () => {
    const first = createRngFromUrl('?seed=7');
    const second = createRngFromUrl('?seed=7');
    expect(first.seed).toBe(7);
    expect(first.rng()).toBe(second.rng());
  });
});
