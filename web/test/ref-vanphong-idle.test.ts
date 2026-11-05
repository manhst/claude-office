import { describe, expect, it } from 'vitest';
import type { AgentUI, MessageUI } from '../src/reducer';
import { idleLine, idlePlans, vpGoal, vpObstacles, vpPlan, CHAT_SPOTS, COFFEE_SPOTS, FIGHT_SPOTS, IDLE_AFTER_MS, IDLE_SLOT_MS, MASSAGE_SPOTS, PAIR_GAP, POOL_SPOTS, ROOM, VP_BOUNDS, type IdlePlan } from '../src/ref-vanphong/adapter';
import { clearLine, findPath, type Rect } from '../src/walk';
import { DOOR, allDesks } from '../src/layout';

const ag = (id: string, p: Partial<AgentUI> = {}): AgentUI => ({ id, role: 'coder', name: id, state: 'idle', desk: { x: 0, y: 0 }, tools: [], ...p });
const pairPts = (cs: [number, number, number][], d: number) => cs.flatMap((c) => [[c[0] - d, 0, c[2]], [c[0] + d, 0, c[2]]] as [number, number, number][]);
const allSpots = (): [number, number, number][] => [...COFFEE_SPOTS.map((s) => s.to), ...POOL_SPOTS.map((s) => s.to), ...MASSAGE_SPOTS.map((s) => s.to), ...pairPts(CHAT_SPOTS, PAIR_GAP.chat), ...pairPts(FIGHT_SPOTS, PAIR_GAP.fight)];

describe('idle behaviour gaps', () => {
  it('idle spots keep their distance so two people never overlap', () => {
    const pts = allSpots(); let min = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2]));
    expect(min).toBeGreaterThanOrEqual(0.7);
  });
  it('an agent visiting a colleague (ask without reply) gets no idle plan', () => {
    const order = ['a', 'b', 'c', 'd']; const agents = Object.fromEntries(order.map((id) => [id, ag(id)]));
    const ask: MessageUI[] = [{ from: 'a', to: 'b', text: 'q', kind: 'ask', ts: 1 }];
    for (let slot = 0; slot < 60; slot++) expect(idlePlans(agents, order, ask, slot * IDLE_SLOT_MS)['a']).toBeUndefined();
    for (let slot = 0; slot < 60; slot++) for (const p of Object.values(idlePlans(agents, order, ask, slot * IDLE_SLOT_MS))) expect(p.partner).not.toBe('a');
    expect(vpGoal(agents.a, agents, ask, { kind: 'coffee', key: 'k', ...COFFEE_SPOTS[0] }).key).toBe('visit:b');
  });
  it('a single free agent never chats or fights and nothing throws', () => {
    const agents = { a: ag('a') }; const kinds = new Set<string>();
    for (let slot = 0; slot < 200; slot++) { const plans = idlePlans(agents, ['a'], [], slot * IDLE_SLOT_MS + 1); for (const p of Object.values(plans)) { kinds.add(p.kind); expect(p.partner).toBeUndefined(); } }
    expect(kinds.has('chat')).toBe(false); expect(kinds.has('fight')).toBe(false);
    expect(idlePlans({}, [], [], 0)).toEqual({});
    expect(idlePlans(agents, ['ghost'], [], 0)).toEqual({});
  });
  it('freeSince: eligibility is fixed at the slot start (free since slotStart - IDLE_AFTER_MS); later never counts this slot; missing entry counts as just free', () => {
    const order = allDesks().map((_, i) => `a${i}`); const agents = Object.fromEntries(order.map((id) => [id, ag(id)]));
    const all = (t: number) => Object.fromEntries(order.map((i) => [i, t]));
    const start = Array.from({ length: 40 }, (_, i) => (i + 1) * IDLE_SLOT_MS).find((t) => Object.keys(idlePlans(agents, order, [], t)).length > 0)!, cut = start - IDLE_AFTER_MS;
    for (const now of [start, start + IDLE_AFTER_MS, start + IDLE_SLOT_MS - 1]) {
      for (const id of order) expect(idlePlans(agents, order, [], now, { ...all(cut), [id]: cut + 1 })[id], `${id} @${now}`).toBeUndefined();
      expect(idlePlans(agents, order, [], now, all(cut))).toEqual(idlePlans(agents, order, [], now));
      expect(idlePlans(agents, order, [], now, {})).toEqual({});
    }
    const late = { ...all(cut), a0: start + 1 }; // a0 crosses IDLE_AFTER_MS mid-slot: nobody's plan changes until the next slot
    expect(idlePlans(agents, order, [], start + IDLE_SLOT_MS - 1, late)).toEqual(idlePlans(agents, order, [], start + 1, late));
  });
  it('someone leaving mid-slot never moves another agent to a new spot under the same key', () => {
    const order = allDesks().map((_, i) => `a${i}`); const agents = Object.fromEntries(order.map((id, i) => [id, ag(id, { desk: allDesks()[i] })]));
    let checked = 0;
    for (let slot = 0; slot < 80; slot++) {
      const now = slot * IDLE_SLOT_MS + 7000, before = idlePlans(agents, order, [], now);
      for (const gone of order) {
        const after = idlePlans({ ...agents, [gone]: ag(gone, { desk: agents[gone].desk, state: 'working' }) }, order, [], now);
        expect(after[gone]).toBeUndefined();
        for (const id of Object.keys(before)) if (after[id] && after[id].key === before[id].key) { expect(after[id].to, `${slot} ${gone} ${id}`).toEqual(before[id].to); expect(after[id].face).toBe(before[id].face); checked++; }
      }
      const keys = Object.values(before).map((p) => `${p.key}|${p.to.join()}`), spots = new Set(Object.values(before).map((p) => p.to.join()));
      expect(spots.size).toBe(keys.length);
    }
    expect(checked).toBeGreaterThan(50);
  });
  it('nobody wanders off while a colleague is visiting their desk', () => {
    const order = ['a', 'b', 'c', 'd', 'e']; const agents = Object.fromEntries(order.map((id, i) => [id, ag(id, { desk: allDesks()[i] })]));
    const ask: MessageUI[] = [{ from: 'a', to: 'b', text: 'q', kind: 'ask', ts: 1 }];
    let others = 0;
    for (let slot = 0; slot < 80; slot++) {
      const plans = idlePlans(agents, order, ask, slot * IDLE_SLOT_MS + 1);
      expect(plans.b).toBeUndefined(); for (const p of Object.values(plans)) expect(p.partner).not.toBe('b');
      others += Object.keys(plans).length;
    }
    expect(others).toBeGreaterThan(0);
    expect(vpGoal(agents.b, agents, ask).key).toBe('home');
    expect(idlePlans(agents, order, [...ask, { from: 'b', to: 'a', text: 'r', kind: 'reply', ts: 2 }], 0)).toEqual(idlePlans(agents, order, [], 0)); // replied: free again
  });
  it('no idle spot sits on the entrance corridor outside the door', () => {
    for (const p of allSpots()) if (p[2] < ROOM.z0) expect(Math.abs(p[0]), String(p)).toBeGreaterThan(ROOM.door);
  });
  it('findPath with custom bounds keeps every waypoint inside them', () => {
    const b: Rect = { x0: -3, x1: 3, z0: -2, z1: 2 }, obs: Rect[] = [{ x0: -0.5, x1: 0.5, z0: -1.5, z1: 1 }];
    const p = findPath([-2.5, 0, 0], [2.5, 0, 0], obs, 0.25, b);
    expect(p.length).toBeGreaterThan(2);
    for (const [x, , z] of p) { expect(x).toBeGreaterThanOrEqual(b.x0); expect(x).toBeLessThanOrEqual(b.x1); expect(z).toBeGreaterThanOrEqual(b.z0); expect(z).toBeLessThanOrEqual(b.z1); }
    for (let i = 1; i < p.length; i++) expect(clearLine(p[i - 1], p[i], obs)).toBe(true);
  });
  it('vpPlan from the door to every idle spot crosses no wall or furniture', () => {
    const obs = vpObstacles();
    for (const to of allSpots()) {
      const p = vpPlan(DOOR, to);
      expect(p.at(-1), String(to)).toEqual(to);
      for (const [x, , z] of p.slice(1)) expect(x >= VP_BOUNDS.x0 && x <= VP_BOUNDS.x1 && z >= VP_BOUNDS.z0 && z <= VP_BOUNDS.z1, `${to} bounds`).toBe(true);
      for (let i = 1; i < p.length; i++) expect(clearLine(p[i - 1], p[i], obs), `${DOOR} -> ${to} seg ${i}: ${p[i - 1]} -> ${p[i]}`).toBe(true);
    }
  });
  it('idleLine is deterministic for the same inputs', () => {
    const plans: IdlePlan[] = (['chat', 'fight', 'coffee', 'pool', 'massage'] as const).map((kind) => ({ kind, key: `${kind}:3:x`, to: [0, 0, 0], face: 0, partner: 'y', first: true }));
    for (const p of plans) for (let t = 0; t < 120_000; t += 700) expect(idleLine('x', { ...p }, t)).toBe(idleLine('x', p, t));
  });
});
