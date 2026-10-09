import { describe, expect, it } from 'vitest';
import { largestRemainder } from '../server/allocation';

describe('largest-remainder allocation', () => {
  it('gives leftover piastres to the largest fractional parts, ties by position', () => {
    expect(largestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(1001, [1, 1])).toEqual([501, 500]);
    expect(largestRemainder(23751, [8000, 2000])).toEqual([19001, 4750]);
  });

  it('never allocates to zero-weight parts and handles zero totals', () => {
    expect(largestRemainder(100, [0, 0, 5])).toEqual([0, 0, 100]);
    expect(largestRemainder(0, [3, 7])).toEqual([0, 0]);
  });

  it('stays exact beyond 2^53 intermediate products', () => {
    expect(largestRemainder(1_000_000_000, [1_000_000_000, 1_000_000_000])).toEqual([
      500_000_000, 500_000_000,
    ]);
  });

  it('rejects impossible inputs', () => {
    expect(() => largestRemainder(-1, [1])).toThrow();
    expect(() => largestRemainder(10, [1.5])).toThrow();
    expect(() => largestRemainder(10, [0, 0])).toThrow();
    expect(() => largestRemainder(10, [-1, 2])).toThrow();
  });

  it('always adds back to the total and keeps every share within one piastre of its quota', () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 2000; round++) {
      const total = Math.floor(next() * 1_000_000_000);
      const weights = Array.from({ length: 1 + Math.floor(next() * 8) }, () =>
        Math.floor(next() * 10_000),
      );
      if (weights.reduce((sum, w) => sum + w, 0) === 0) weights[0] = 1;
      const parts = largestRemainder(total, weights);
      const sum = weights.reduce((s, w) => s + w, 0);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
      parts.forEach((part, index) => {
        expect(Math.abs(part - (total * weights[index]) / sum)).toBeLessThan(1);
      });
    }
  });
});
