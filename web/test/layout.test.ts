import { describe, it, expect } from 'vitest';
import { deskWorld, allDesks, avatarTarget, damp, damp3, lerp3, clampTarget, cardPosition, loadView, saveView, SEAT_OFFSET, add, MSG_MS } from '../src/layout';
import type { AgentUI } from '../src/reducer';
const ag = (id: string, x: number, y = 0): AgentUI => ({ id, role: id, name: id, state: 'idle', desk: { x, y }, tools: [] });
describe('3D layout', () => {
  it('6 desks, centred grid, unique positions', () => {
    const ps = allDesks().map(deskWorld);
    expect(ps).toHaveLength(6); expect(new Set(ps.map((p) => p.join())).size).toBe(6);
    expect(ps.reduce((s, p) => s + p[0], 0)).toBeCloseTo(0); expect(ps.reduce((s, p) => s + p[2], 0)).toBeCloseTo(0);
    expect(ps.every((p) => p[1] === 0)).toBe(true);
  });
  it('avatar sits at its seat, leans toward the colleague while asking, then returns', () => {
    const agents = { a: ag('a', 0), b: ag('b', 2) };
    const seatA = add(deskWorld({ x: 0, y: 0 }), SEAT_OFFSET), seatB = add(deskWorld({ x: 2, y: 0 }), SEAT_OFFSET);
    expect(avatarTarget(agents.a, agents, [], 0)).toEqual(seatA);
    const msgs = [{ from: 'a', to: 'b', text: 'q', kind: 'ask' as const, ts: 1000 }];
    const t = avatarTarget(agents.a, agents, msgs, 1500);
    expect(t[0]).toBeGreaterThan(seatA[0]); expect(t[0]).toBeLessThan(seatB[0]);
    expect(avatarTarget(agents.a, agents, msgs, 1000 + MSG_MS + 1)).toEqual(seatA);
    expect(avatarTarget(agents.b, agents, msgs, 1500)).toEqual(seatB); // only the asker moves
    expect(avatarTarget(agents.a, agents, [{ ...msgs[0], kind: 'reply' }], 1500)).toEqual(seatA);
  });
});
describe('lerp / damp', () => {
  it('lerp endpoints', () => { expect(lerp3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]); });
  it('damp is frame-rate independent and converges without overshoot', () => {
    const one = damp(0, 10, 4, 1 / 30); const two = damp(damp(0, 10, 4, 1 / 60), 10, 4, 1 / 60);
    expect(one).toBeCloseTo(two, 10);
    let v: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 300; i++) { v = damp3(v, [5, -5, 1], 4, 1 / 60); expect(v[0]).toBeLessThanOrEqual(5); }
    expect(v[0]).toBeCloseTo(5, 3); expect(damp(3, 3, 4, 0.016)).toBe(3); expect(damp(0, 10, 4, 0)).toBe(0);
  });
});
describe('camera + 2D placement + view persistence', () => {
  it('clampTarget keeps target above floor and inside office', () => {
    expect(clampTarget([0, -5, 0])[1]).toBe(0); expect(clampTarget([50, 1, -50])).toEqual([9, 1, -7]); expect(clampTarget([1, 10, 2])[1]).toBe(3);
  });
  it('message card sits at arrow midpoint in the lane above the desk row, stacked', () => {
    const c0 = cardPosition({ x: 100, y: 300 }, { x: 500, y: 300 }, 94, 0, 220);
    expect(c0.left + 110).toBe(300); expect(c0.top + 40).toBeLessThanOrEqual(94); // card bottom (~40px) above row top
    const c1 = cardPosition({ x: 100, y: 300 }, { x: 500, y: 300 }, 94, 1, 220);
    expect(c1.top).toBeLessThan(c0.top); expect(cardPosition({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 5).top).toBe(4);
  });
  it('view choice persists and defaults to 2d', () => {
    const m = new Map<string, string>(); const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadView(st)).toBe('2d'); saveView(st, '3d'); expect(loadView(st)).toBe('3d');
    expect(loadView({ getItem: () => { throw new Error('denied'); } })).toBe('2d'); expect(loadView(undefined)).toBe('2d');
  });
});
