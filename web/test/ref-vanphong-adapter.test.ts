import { describe, expect, it } from 'vitest';
import type { AgentUI, MessageUI } from '../src/reducer';
import { bubbleFor, idleLine, idlePlans, lookFor, vpBubble, newFlights, roomWalls, subtitleFor, vpChair, vpDesk, vpGoal, vpHome, vpObstacles, vpPlan, vpStatus, vpVisit, ROOM,
  BIEN, CHAT_SPOTS, COFFEE_SPOTS, FIGHT_SPOTS, FURNITURE, IDLE_AFTER_MS, IDLE_SLOT_MS, MASSAGE_SPOTS, PAIR_GAP, POOL_SPOTS, VP_BOUNDS } from '../src/ref-vanphong/adapter';
import { chuanHoa, MAU_SAN } from '../src/ref-vanphong/characters';
import { blocked, clearLine } from '../src/walk';
import { BUBBLE_MS, DOOR, allDesks } from '../src/layout';

const ag = (id: string, p: Partial<AgentUI> = {}): AgentUI => ({ id, role: 'coder', name: id, state: 'idle', desk: { x: 0, y: 0 }, tools: [], ...p });

describe('ref-vanphong adapter', () => {
  it('maps every reducer state to a reference status class', () => {
    expect(['idle', 'thinking', 'working', 'talking', 'done', 'error'].map((s) => vpStatus(s as AgentUI['state'])))
      .toEqual(['ranh', 'dang-nghi', 'dang-lam', 'dang-nghe', 'xong', 'loi']);
  });
  it('picks a preset look by role, stable by id for unknown roles', () => {
    expect(lookFor(ag('a', { role: 'Researcher' }))).toBe(MAU_SAN.nu_01);
    expect(lookFor(ag('a', { role: 'coder' }))).toBe(MAU_SAN.nam_01);
    const x = lookFor(ag('zz', { role: 'astronaut' }));
    expect(lookFor(ag('zz', { role: 'astronaut' }))).toBe(x);
    expect(Object.values(MAU_SAN)).toContain(x);
  });
  it('normalises bad appearance data like the reference', () => {
    const n = chuanHoa({ kieu_toc: 'nope', toc: 'red' });
    expect(n.kieu_toc).toBe('ngan'); expect(n.gioi).toBe('nu'); expect(n.toc).toBe('#6b5b95'); expect(n.phu).toBe(n.mat);
    expect(chuanHoa({ kieu_toc: 'nhon' }).gioi).toBe('nam');
  });
  it('bubble: result when done, error when failed, fresh text otherwise, dots while busy', () => {
    const now = 100_000;
    expect(bubbleFor(ag('a', { state: 'done', result: 'R' }), now)).toEqual({ text: 'R', show: true, dots: false });
    expect(bubbleFor(ag('a', { state: 'error', error: 'E' }), now)).toEqual({ text: 'E', show: true, dots: false });
    expect(bubbleFor(ag('a', { state: 'working', text: 'hi', textTs: now - 10 }), now).text).toBe('hi');
    expect(bubbleFor(ag('a', { state: 'idle', text: 'old', textTs: now - BUBBLE_MS - 1 }), now).show).toBe(false);
    expect(bubbleFor(ag('a', { state: 'talking', text: 'old', textTs: now - BUBBLE_MS - 1 }), now).show).toBe(true);
    expect(bubbleFor(ag('a', { state: 'thinking' }), now)).toEqual({ text: '', show: true, dots: true });
  });
  it('subtitle is a short status only (no role / tool); idle and done stay blank', () => {
    expect(subtitleFor(ag('a', { state: 'working', tool: { callId: 'c', name: 'grep', summary: '', ts: 0 } }))).toBe('working');
    expect(subtitleFor(ag('a', { state: 'thinking' }))).toBe('thinking');
    expect(subtitleFor(ag('a', { state: 'done' }))).toBe('');
    expect(subtitleFor(ag('a', { state: 'idle' }))).toBe('');
  });
  it('seats face +z behind the desk; home and visit spots are walkable', () => {
    const d = { x: 2, y: 1 }, [dx, , dz] = vpDesk(d);
    expect(vpChair(d)).toEqual([dx, 0, dz - 0.62]);
    const obs = vpObstacles();
    for (const desk of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }]) {
      expect(blocked(vpHome(desk)[0], vpHome(desk)[2], obs)).toBe(false);
      expect(blocked(vpVisit(desk)[0], vpVisit(desk)[2], obs)).toBe(false);
    }
  });
  it('agents enter through the room door gap, never through glass', () => {
    const walls = roomWalls();
    const p = vpPlan(DOOR, vpHome({ x: 2, y: 1 }));
    for (let i = 1; i < p.length; i++) expect(clearLine(p[i - 1], p[i], walls)).toBe(true);
    expect(p.some(([x, , z]) => Math.abs(x) < ROOM.door / 2 && Math.abs(z - ROOM.z0) < 0.6)).toBe(true);
  });
  it('goal: home facing +z, or the colleague asked until they reply', () => {
    const agents = { a: ag('a'), b: ag('b', { desk: { x: 1, y: 1 } }) };
    expect(vpGoal(agents.a, agents, [])).toMatchObject({ key: 'home', home: true, face: 0 });
    const ask: MessageUI = { from: 'a', to: 'b', text: 'q', kind: 'ask', ts: 1 };
    const g = vpGoal(agents.a, agents, [ask]);
    expect(g).toMatchObject({ key: 'visit:b', home: false }); expect(g.to).toEqual(vpVisit(agents.b.desk));
    expect(vpGoal(agents.a, agents, [ask, { from: 'b', to: 'a', text: 'r', kind: 'reply', ts: 2 }]).key).toBe('home');
  });
  it('flights: only new messages between known, distinct agents', () => {
    const agents = { a: ag('a'), b: ag('b') };
    const messages: MessageUI[] = [{ from: 'a', to: 'b', text: '', kind: 'ask', ts: 5 }, { from: 'a', to: 'x', text: '', kind: 'ask', ts: 6 }, { from: 'b', to: 'a', text: '', kind: 'reply', ts: 7 }];
    expect(newFlights({ agents, messages }, 0).map((m) => m.ts)).toEqual([5, 7]);
    expect(newFlights({ agents, messages }, 5).map((m) => m.ts)).toEqual([7]);
  });
  it('pantry and game room: furniture on the floor, every idle spot walkable and reachable without crossing glass or furniture', () => {
    for (const f of Object.values(FURNITURE)) { expect(f.x - f.hx).toBeGreaterThanOrEqual(BIEN.x0); expect(f.x + f.hx).toBeLessThanOrEqual(BIEN.x1); expect(f.z - f.hz).toBeGreaterThanOrEqual(BIEN.z0); }
    const obs = vpObstacles(), walls = roomWalls();
    const pts = [...COFFEE_SPOTS.map((s) => s.to), ...POOL_SPOTS.map((s) => s.to), ...MASSAGE_SPOTS.map((s) => s.to),
      ...([[CHAT_SPOTS, PAIR_GAP.chat], [FIGHT_SPOTS, PAIR_GAP.fight]] as const).flatMap(([cs, d]) => cs.flatMap((c) => [[c[0] - d, 0, c[2]], [c[0] + d, 0, c[2]]] as [number, number, number][]))];
    for (const p of pts) {
      expect(blocked(p[0], p[2], obs), String(p)).toBe(false);
      expect(p[0] > VP_BOUNDS.x0 && p[0] < VP_BOUNDS.x1 && p[2] > VP_BOUNDS.z0 && p[2] < VP_BOUNDS.z1, String(p)).toBe(true);
      for (const from of [vpHome({ x: 0, y: 0 }), vpHome({ x: 2, y: 1 })]) {
        const path = vpPlan(from, p);
        expect(path.at(-1)).toEqual(p);
        for (let i = 1; i < path.length; i++) expect(clearLine(path[i - 1], path[i], walls), `${from} -> ${p}`).toBe(true);
      }
    }
  });
  it('idle plans: only free agents wander; pairs meet face to face; deterministic per slot; busy agents go home', () => {
    const order = allDesks().map((_, i) => `a${i}`);
    const agents = Object.fromEntries(order.map((id, i) => [id, ag(id, { desk: allDesks()[i] })]));
    const kinds = new Set<string>();
    for (let slot = 0; slot < 40; slot++) {
      const now = slot * IDLE_SLOT_MS + 1000, plans = idlePlans(agents, order, [], now);
      expect(idlePlans(agents, order, [], now + 5000)).toEqual(plans);
      for (const [id, p] of Object.entries(plans)) {
        kinds.add(p.kind);
        if (p.partner) { const q = plans[p.partner]; expect(q.partner).toBe(id); expect(q.kind).toBe(p.kind); expect(q.face).toBeCloseTo(-p.face); expect(q.first).toBe(!p.first); }
      }
      const spots = Object.values(plans).map((p) => p.to.join()); expect(new Set(spots).size).toBe(spots.length); // nobody shares a spot
    }
    expect([...kinds].sort()).toEqual(['chat', 'coffee', 'fight', 'massage', 'pool']);
    const busy = { ...agents, a0: ag('a0', { state: 'working' }) };
    for (let slot = 0; slot < 20; slot++) expect(idlePlans(busy, order, [], slot * IDLE_SLOT_MS)['a0']).toBeUndefined();
    const all = (t: number) => Object.fromEntries(order.map((id) => [id, t]));
    const wandering = (now: number, f: Record<string, number>) => Object.keys(idlePlans(agents, order, [], now, f)).length;
    const now = Array.from({ length: 20 }, (_, i) => (i + 1) * IDLE_SLOT_MS + 1000).find((t) => wandering(t, all(0)) > 0)!; // a slot where someone wanders
    const cut = Math.floor(now / IDLE_SLOT_MS) * IDLE_SLOT_MS - IDLE_AFTER_MS; // eligibility is fixed at the slot start
    expect(wandering(now, all(cut))).toBe(wandering(now, all(0)));
    expect(wandering(now, all(cut + 1))).toBe(0); // free after the cutoff: stays put for the rest of the slot
    expect(wandering(now + IDLE_SLOT_MS - 2000, all(cut + 1))).toBe(0);
    const plan = { kind: 'coffee' as const, key: 'coffee:1', ...COFFEE_SPOTS[0] };
    expect(vpGoal(busy.a0, busy, [], plan).key).toBe('home');
    expect(vpGoal(agents.a0, agents, [], plan)).toMatchObject({ key: 'coffee:1', home: false, to: COFFEE_SPOTS[0].to });
  });
  it('vpBubble: arrived at an idle activity shows only small talk (never the done result); otherwise bubbleFor', () => {
    const order = allDesks().map((_, i) => `a${i}`), now0 = 5 * IDLE_SLOT_MS;
    const agents = Object.fromEntries(order.map((id, i) => [id, ag(id, { desk: allDesks()[i], state: 'done', result: 'RESULT' })]));
    const plans = idlePlans(agents, order, [], now0); expect(Object.keys(plans).length).toBeGreaterThan(0);
    for (const [id, p] of Object.entries(plans)) for (let t = now0; t < now0 + IDLE_SLOT_MS; t += 400) {
      const b = vpBubble(agents[id], p, true, t), line = idleLine(id, p, t);
      expect(b).toEqual(line ? { text: line, show: true, dots: false } : { text: '', show: false, dots: false });
      expect(vpBubble(agents[id], p, false, t)).toEqual(bubbleFor(agents[id], t)); // at the desk or walking: the result
    }
    expect(vpBubble(agents.a0, undefined, true, now0).text).toBe('RESULT');
  });
  it('idle lines: a pair takes turns, solo activities speak only sometimes', () => {
    const a = { kind: 'chat' as const, key: 'chat:1:x', to: [0, 0, 0] as [number, number, number], face: 0, partner: 'y', first: true }, b = { ...a, partner: 'x', first: false };
    for (let t = 0; t < 60_000; t += 1000) expect(!!idleLine('x', a, t) && !!idleLine('y', b, t)).toBe(false);
    expect(Array.from({ length: 30 }, (_, i) => idleLine('x', a, i * 3200)).filter(Boolean).length).toBeGreaterThan(5);
  });
});
