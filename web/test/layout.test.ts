import { describe, it, expect } from 'vitest';
import { deskWorld, allDesks } from '../src/layout';
describe('3D layout', () => {
  it('6 desks, centred grid, unique positions', () => {
    const ps = allDesks().map(deskWorld);
    expect(ps).toHaveLength(6); expect(new Set(ps.map((p) => p.join())).size).toBe(6);
    expect(ps.reduce((s, p) => s + p[0], 0)).toBeCloseTo(0); expect(ps.reduce((s, p) => s + p[2], 0)).toBeCloseTo(0);
    expect(ps.every((p) => p[1] === 0)).toBe(true);
  });
});
