import { describe, it, expect } from 'vitest';
import { findPath, obstacles, clearLine, segmentHits, pathLength, seatOf, visitSpot, visiting, goalFor, newWalker, stepWalker, clipFor, resolveOverlaps, turnToward, blocked } from '../src/walk';
import { DOOR, allDesks, type Vec3 } from '../src/layout';
import type { AgentUI } from '../src/reducer';
const ag = (id: string, x: number, y = 0, state: AgentUI['state'] = 'thinking'): AgentUI => ({ id, role: id, name: id, state, desk: { x, y }, tools: [] });
const obs = obstacles();
const noDeskCrossing = (p: Vec3[]) => p.slice(1).every((q, i) => clearLine(p[i], q, obs));
describe('pathing', () => {
  it('segmentHits detects crossing but not edge-grazing', () => {
    const r = { x0: 0, x1: 1, z0: 0, z1: 1 };
    expect(segmentHits([-1, 0, 0.5], [2, 0, 0.5], r)).toBe(true);
    expect(segmentHits([-1, 0, 1], [2, 0, 1], r)).toBe(false);
    expect(segmentHits([-1, 0, 2], [2, 0, 2], r)).toBe(false);
  });
  it('every seat-to-seat and door-to-seat path avoids every desk', () => {
    const seats = allDesks().map((d) => seatOf({ desk: d })), ends = [...seats, DOOR as Vec3];
    for (const a of ends) for (const b of seats) {
      const p = findPath(a, b);
      expect(p[0]).toEqual(a); expect(p[p.length - 1]).toEqual(b);
      expect(noDeskCrossing(p)).toBe(true);
      expect(p.length).toBeLessThan(10); // string-pulled, not a cell staircase
    }
  });
  it('front row to back row goes around, not through the desk between them', () => {
    const a = seatOf({ desk: { x: 1, y: 1 } }), b = seatOf({ desk: { x: 1, y: 0 } });
    const p = findPath(a, b);
    expect(p.length).toBeGreaterThan(2);
    expect(pathLength(p)).toBeGreaterThan(Math.hypot(a[0] - b[0], a[2] - b[2]));
  });
  it('direct line when nothing is in the way', () => { const p = findPath([0, 0, 5], [3, 0, 5]); expect(p).toEqual([[0, 0, 5], [3, 0, 5]]); });
  it('visit spot is walkable', () => { for (const d of allDesks()) { const v = visitSpot({ desk: d }); expect(blocked(v[0], v[2], obs)).toBe(false); } });
});
describe('walk state', () => {
  const agents = { a: ag('a', 0), b: ag('b', 2) };
  const ask = { from: 'a', to: 'b', text: 'q', kind: 'ask' as const, ts: 1 }, reply = { from: 'b', to: 'a', text: 'r', kind: 'reply' as const, ts: 2 };
  it('visiting: in flight until the reply arrives, regardless of elapsed time', () => {
    expect(visiting(agents.a, agents, [])).toBeNull();
    expect(visiting(agents.a, agents, [ask])).toBe('b');
    expect(visiting(agents.b, agents, [ask])).toBeNull();
    expect(visiting(agents.a, agents, [ask, reply])).toBeNull();
    expect(visiting({ ...agents.a, state: 'done' }, agents, [ask])).toBeNull();
    expect(visiting(agents.a, { a: agents.a }, [ask])).toBeNull(); // unknown target
  });
  const run = (w: ReturnType<typeof newWalker>, msgs: any[], secs: number, a = agents.a) => { for (let t = 0; t < secs; t += 1 / 30) w = stepWalker(w, goalFor(a, agents, msgs), 1 / 30); return w; };
  it('walks in from the door and sits; walks to the colleague, waits, walks back on reply', () => {
    let w = run(newWalker(), [], 0.2); expect(w.phase).toBe('walking'); expect(w.goalKey).toBe('home');
    w = run(w, [], 20); expect(w.phase).toBe('seated'); expect(w.pos).toEqual(seatOf(agents.a));
    expect(turnToward(w.heading, Math.PI, 0)).toBeCloseTo(Math.PI);
    w = run(w, [ask], 0.3); expect(w.phase).toBe('walking'); expect(w.goalKey).toBe('visit:b');
    expect(noDeskCrossing(w.path)).toBe(true);
    w = run(w, [ask], 20); expect(w.phase).toBe('waiting'); expect(w.pos).toEqual(visitSpot(agents.b));
    w = run(w, [ask], 5); expect(w.phase).toBe('waiting'); // keeps waiting while in flight
    w = run(w, [ask, reply], 0.3); expect(w.phase).toBe('walking'); expect(w.goalKey).toBe('home');
    w = run(w, [ask, reply], 20); expect(w.phase).toBe('seated'); expect(w.pos).toEqual(seatOf(agents.a));
  });
  it('constant speed, frame-rate independent', () => {
    const goal = goalFor(agents.a, agents, [ask]); let w1 = newWalker(seatOf(agents.a)), w2 = newWalker(seatOf(agents.a));
    w1 = stepWalker(w1, goal, 0.5); for (let i = 0; i < 10; i++) w2 = stepWalker(w2, goal, 0.05);
    w1.pos.forEach((v, i) => expect(v).toBeCloseTo(w2.pos[i], 5));
  });
  it('clips', () => {
    expect(clipFor('walking', 'working')).toBe('Walk_Loop');
    expect(clipFor('waiting', 'talking')).toBe('Idle_Talking_Loop');
    expect(clipFor('seated', 'working')).toBe('Sitting_Talking_Loop');
    expect(clipFor('seated', 'done')).toBe('Sitting_Idle_Loop');
  });
});
describe('label layout', () => {
  it('fixed names stay, overlapping cards are pushed above them and each other', () => {
    const dy = resolveOverlaps([
      { id: 'name', x: 0, y: 100, w: 100, h: 20, fixed: true },
      { id: 'card1', x: 20, y: 105, w: 100, h: 30, fixed: false },
      { id: 'card2', x: 40, y: 100, w: 100, h: 30, fixed: false },
      { id: 'far', x: 500, y: 100, w: 50, h: 20, fixed: false },
    ]);
    expect(dy.name).toBe(0); expect(dy.far).toBe(0);
    expect(105 + dy.card1 + 30).toBeLessThanOrEqual(100); expect(100 + dy.card2 + 30).toBeLessThanOrEqual(105 + dy.card1);
  });
  it('two names at the same spot (visitor beside host) are stacked, not overlapped', () => {
    const dy = resolveOverlaps([{ id: 'host', x: 0, y: 100, w: 80, h: 20, fixed: true }, { id: 'visitor', x: 30, y: 98, w: 80, h: 20, fixed: true }]);
    expect(dy.host).toBe(0); expect(98 + dy.visitor + 20).toBeLessThanOrEqual(100);
  });
});
import { modelUrl } from '../src/Character';
describe('model url', () => {
  it('defaults to the bundled CC0 model; test hook only accepts a bare file name', () => {
    expect(modelUrl('')).toBe('/models/office-character.glb');
    expect(modelUrl('?model=missing.glb')).toBe('/models/missing.glb');
    expect(modelUrl('?model=../../etc/passwd')).toBe('/models/office-character.glb');
    expect(modelUrl('?model=..%2Fx.glb')).toBe('/models/office-character.glb');
  });
});
