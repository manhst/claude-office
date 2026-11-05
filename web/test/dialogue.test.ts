import { describe, expect, it } from 'vitest';
import { LINES, PAIRS } from '../src/town/dialogue';

describe('town dialogue data', () => {
  for (const [cat, lines] of Object.entries(LINES)) {
    it(`${cat} has >= 30 unique lines`, () => {
      expect(new Set(lines).size).toBeGreaterThanOrEqual(30);
      for (const l of lines) expect(l.trim().length).toBeGreaterThan(0);
    });
  }
  for (const [cat, pairs] of Object.entries(PAIRS)) {
    it(`${cat} has >= 30 unique two-sided exchanges`, () => {
      expect(new Set(pairs.map((p) => p.join('|'))).size).toBeGreaterThanOrEqual(30);
      for (const [a, b] of pairs) { expect(a.length).toBeGreaterThan(0); expect(b.length).toBeGreaterThan(0); expect(a).not.toBe(b); }
    });
  }
});
