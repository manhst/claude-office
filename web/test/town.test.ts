import { describe, it, expect } from 'vitest';
import { LINES } from '../src/town/dialogue';
import { agentPartnerId, BOSS_ID, BOSS_LOOK, BOSS_NAME, forceBoss, forceLayoff, GRASP_LIFT, GRASP_PLAN_DX, graspPlan, graspWorldFromCarrier, initialWorld, menuEnt, step, throwIntoPond, problemKey, problemText, walkerHeldByLayoff, type AgentPrey, type World } from '../src/town/sim';
import { ITOPS_SPOT, inPond, pondCenter, CAFE, TRADA, BUILDING, ATM, ATM_SPOTS, GATE, PRINT, ROADS, crossesBuilding, waypoint, toWorld, fromWorld, PX, type Box } from '../src/town/map';
import { BIEN } from '../src/ref-vanphong/adapter';
import { loadLooks, setIdent, agentKey, setCurrentLooks, currentName, currentLook } from '../src/town/looks';
import { chibiSvg, PRESETS } from '../src/town/Avatar';
import { lookFor } from '../src/ref-vanphong/adapter';
const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const run = (w: World, from: number, ms: number, r: () => number, it?: any, prey: AgentPrey[] = []) => { for (let t = from; t <= from + ms; t += 200) w = step(w, t, r, it, prey); return w; };
const ent = (w: World, id: string) => w.ents.find((e) => e.id === id)!;
const goneNpcs = (w: World): World => ({ ...w, ents: w.ents.map((e) => e.kind === 'npc' ? { ...e, act: 'gone' as const, until: 1e12 } : e) });
const huntAgent = (w: World, prey: AgentPrey, until = 500): World => ({
  ...w, ents: w.ents.map((e) => e.id === 'layoff'
    ? { ...e, act: 'hunt' as const, partner: `agent:${prey.id}`, x: prey.x + 8, y: prey.y, tx: prey.x, ty: prey.y, until, speed: 180 }
    : e),
});
describe('town sim', () => {
  it('has the cast: IT Ops indoors, NPCs, dog Chos An, cat Meow, Layoff — no Architect', () => {
    const w = initialWorld(0);
    expect(w.ents.map((e) => e.name)).toEqual(expect.arrayContaining(['IT Ops', 'Chos An', 'Meow']));
    expect(w.ents.find((e) => e.name === 'Architect')).toBeUndefined();
    expect(w.ents.every((e) => e.kind !== 'itops' || e.id === 'itops')).toBe(true);
    expect(w.ents.filter((e) => e.kind === 'npc').length).toBeGreaterThanOrEqual(3);
    expect(ent(w, 'layoff').name).toBe('Layoff');
    expect(ent(w, 'layoff').kind).toBe('trex');
    const it = ent(w, 'itops');
    expect(Math.hypot(it.x - ITOPS_SPOT.x, it.y - ITOPS_SPOT.y)).toBeLessThan(2);
  });
  it('IT Ops stays put when unconfigured or ok; reports the alert at his indoor desk (no Architect walk)', () => {
    let w = run(initialWorld(0), 0, 5000, seq([0.95]), { mode: 'unconfigured', state: 'unconfigured', alerts: [] });
    expect(ent(w, 'itops').act).not.toBe('report');
    const alert = { mode: 'prometheus', state: 'alert', alerts: [{ name: 'DiskFull', detail: 'db1' }] } as any;
    w = run(w, 5200, 500, seq([0.95]), alert);
    const it = ent(w, 'itops');
    expect(it.act).toBe('report');
    expect(it.say).toMatch(/DiskFull/);
    expect(Math.hypot(it.x - ITOPS_SPOT.x, it.y - ITOPS_SPOT.y)).toBeLessThan(2);
    expect(w.reportedKey).toBe('DiskFull');
    expect(problemText(alert)).toContain('DiskFull');
    expect(problemKey({ mode: 'unconfigured', state: 'unconfigured', alerts: [] })).toBeUndefined();
    expect(problemKey({ mode: 'prometheus', state: 'error', error: 'HTTP 500', alerts: [] })).toBe('error:HTTP 500');
  });
  it('throwing a character: falls into the pond, eaten, gone, respawns later', () => {
    let w = throwIntoPond(initialWorld(0), 'npc-1', 0);
    w = run(w, 0, 3000, seq([0.95]));
    expect(['eaten', 'gone']).toContain(ent(w, 'npc-1').act);
    expect(inPond(ent(w, 'npc-1'))).toBe(true);
    w = run(w, 3200, 20000, seq([0.95]));
    expect(ent(w, 'npc-1').act).not.toBe('gone');
  });
  it('dog barks, cat picks fights with the dog, NPCs go to the cafe / trà đá', () => {
    const w0 = initialWorld(0);
    const w = step({ ...w0, t: 0 }, 2000, seq([0.1]));
    expect(ent(w, 'dog').act).toBe('bark'); expect(LINES.dogBark).toContain(ent(w, 'dog').say);
    expect(ent(w, 'cat').next).toBe('fight');
    const npc = ent(w, 'npc-1'); expect(npc.next).toBe('drink');
    expect(npc.tx).toBeGreaterThan(CAFE.x); expect(npc.ty).toBeLessThan(CAFE.y + CAFE.h);
    const w2 = step({ ...w0, t: 0 }, 2000, seq([0.3]));
    expect(ent(w2, 'npc-1').next).toBe('beer'); expect(ent(w2, 'npc-1').tx).toBeGreaterThan(TRADA.x - 20);
    let f = w, fought = false; for (let t = 2200; t < 10000; t += 200) { f = step(f, t, seq([0.99])); fought ||= ent(f, 'dog').act === 'fight' && ent(f, 'cat').act === 'fight'; }
    expect(fought).toBe(true);
    expect(inPond(pondCenter())).toBe(true); expect(toWorld(BUILDING)).toEqual([BIEN.x0, BIEN.z0]); expect(toWorld({ x: BUILDING.x + BUILDING.w, y: BUILDING.y + BUILDING.h })).toEqual([BIEN.x1, BIEN.z1]);
    const p = fromWorld(3, -2); expect(toWorld(p)[0]).toBeCloseTo(3); expect(toWorld(p)[1]).toBeCloseTo(-2);
  });
});

describe('Layoff the T-Rex', () => {
  it('force eat: Layoff chomps an idle NPC on the spot (comedic eaten → gone → respawn)', () => {
    let w = initialWorld(0);
    // Make NPCs idle/useless so forceLayoff has a clear target.
    w = { ...w, ents: w.ents.map((e) => e.kind === 'npc' ? { ...e, act: 'idle' as const, until: 0 } : e) };
    w = forceLayoff(w, 1000, 'eat', () => 0.2);
    const L = ent(w, 'layoff');
    expect(L.act).toBe('chomp');
    expect(LINES.layoffEat).toContain(L.say);
    const victim = w.ents.find((e) => e.kind === 'npc' && e.act === 'eaten')!;
    expect(victim).toBeTruthy();
    expect(LINES.victimPanic).toContain(victim.say);
    w = run(w, 1000, 5000, () => 0.5);
    expect(['gone', 'idle', 'walk']).toContain(ent(w, victim.id).act);
  });
  it('force pond: Layoff carries NPC to the crocodile pond and drops them in', () => {
    let w = initialWorld(0);
    w = { ...w, ents: w.ents.map((e) => e.kind === 'npc' ? { ...e, act: 'bbq' as const, until: 0 } : e) };
    w = forceLayoff(w, 1000, 'pond', () => 0.2);
    expect(ent(w, 'layoff').act).toBe('carry');
    expect(LINES.layoffThrow).toContain(ent(w, 'layoff').say);
    const carried = w.ents.find((e) => e.act === 'carried')!;
    expect(carried).toBeTruthy();
    w = run(w, 1000, 6000, () => 0.5);
    const v = ent(w, carried.id);
    expect(['fall', 'eaten', 'gone']).toContain(v.act);
    expect(['fall', 'eaten', 'gone'].includes(v.act) || inPond(v)).toBe(true);
  });
  it('NPC pond carry: victim stays in grasp during a long transit, then falls from the pond-side release, not the capture spot', () => {
    const capture = { x: 1470, y: 330 };
    let w = initialWorld(0);
    w = { ...w, ents: w.ents.map((e) => e.kind === 'npc' ? { ...e, act: 'idle' as const, until: 0 } : e) };
    w = forceLayoff(w, 1000, 'pond', () => 0.2);
    const vid = w.ents.find((e) => e.act === 'carried')!.id;
    w = { ...w, t: 1000, ents: w.ents.map((e) => {
      if (e.id === 'layoff') return { ...e, x: capture.x + 20, y: capture.y, tx: pondCenter().x, ty: pondCenter().y, act: 'carry' as const, partner: vid, speed: 160, until: 20_000 };
      if (e.id === vid) return { ...e, x: capture.x, y: capture.y, act: 'carried' as const, partner: 'layoff', until: 20_000 };
      return e;
    }) };
    w = run(w, 1000, 1600, () => 0.5);
    const L = ent(w, 'layoff'), V = ent(w, vid);
    expect(L.act).toBe('carry');
    expect(V.act).toBe('carried');
    expect(w.layoffEvent).toBeUndefined();
    const held = graspPlan(L);
    expect(Math.hypot(V.x - held.x, V.y - held.y)).toBeLessThan(3);
    expect(Math.hypot(V.x - capture.x, V.y - capture.y)).toBeGreaterThan(80);
    expect(Math.hypot(L.x - capture.x, L.y - capture.y)).toBeGreaterThan(80);
    w = run(w, 2600, 20_000, () => 0.5);
    const v2 = ent(w, vid);
    expect(['fall', 'eaten', 'gone']).toContain(v2.act);
    expect(Math.hypot(v2.x - capture.x, v2.y - capture.y)).toBeGreaterThan(400);
    if (v2.act === 'fall') expect(Math.hypot(v2.x - pondCenter().x, v2.y - pondCenter().y)).toBeLessThan(90);
    expect(ent(w, 'layoff').act).toBe('idle');
  });
  it('carried NPC does not resume wandering even after until expires', () => {
    let w = initialWorld(0);
    w = { ...w, ents: w.ents.map((e) => e.kind === 'npc' ? { ...e, act: 'idle' as const, until: 0 } : e) };
    w = forceLayoff(w, 1000, 'pond', () => 0.2);
    const vid = w.ents.find((e) => e.act === 'carried')!.id;
    w = { ...w, ents: w.ents.map((e) => e.id === vid || e.id === 'layoff' ? { ...e, until: 0 } : e) };
    w = step(w, 1200, () => 0.5);
    expect(ent(w, vid).act).toBe('carried');
    expect(ent(w, 'layoff').act).toBe('carry');
  });
  it('hunting an agent prey emits eat immediately (no carry)', () => {
    const prey = [{ id: 'agent-1', x: 420, y: 400 }];
    let w = goneNpcs(huntAgent({ ...initialWorld(0), t: 0 }, prey[0], 0));
    w = step(w, 200, () => 0.9, undefined, prey);
    expect(w.layoffEvent).toEqual({ type: 'eat', agentId: 'agent-1' });
    expect(ent(w, 'layoff').act).toBe('idle');
    expect(walkerHeldByLayoff('agent-1', ent(w, 'layoff'))).toBe(false);
  });
  it('agent pond: capture has no event, transit keeps carry + walkerHeld, release throws from grasp near the pond', () => {
    const prey = [{ id: 'agent-1', x: 1470, y: 330 }];
    let w = goneNpcs(huntAgent({ ...initialWorld(0), t: 0 }, prey[0], 0));
    w = step(w, 200, () => 0.2, undefined, prey);
    expect(ent(w, 'layoff').act).toBe('carry');
    expect(ent(w, 'layoff').partner).toBe('agent:agent-1');
    expect(w.layoffEvent).toBeUndefined();
    expect(walkerHeldByLayoff('agent-1', ent(w, 'layoff'))).toBe(true);
    expect(walkerHeldByLayoff('agent-2', ent(w, 'layoff'))).toBe(false);
    const start = { x: ent(w, 'layoff').x, y: ent(w, 'layoff').y };
    w = run(w, 200, 1600, () => 0.5, undefined, prey);
    expect(ent(w, 'layoff').act).toBe('carry');
    expect(w.layoffEvent).toBeUndefined();
    expect(walkerHeldByLayoff('agent-1', ent(w, 'layoff'))).toBe(true);
    expect(Math.hypot(ent(w, 'layoff').x - start.x, ent(w, 'layoff').y - start.y)).toBeGreaterThan(80);
    w = run(w, 1800, 20_000, () => 0.5, undefined, prey);
    expect(w.layoffEvent?.type).toBe('pond');
    expect(w.layoffEvent?.agentId).toBe('agent-1');
    expect(w.layoffEvent?.from).toEqual(graspPlan(ent(w, 'layoff')));
    expect(Math.hypot(w.layoffEvent!.from!.x - pondCenter().x, w.layoffEvent!.from!.y - pondCenter().y)).toBeLessThan(50);
    expect(ent(w, 'layoff').act).toBe('idle');
    expect(ent(w, 'layoff').partner).toBeUndefined();
    expect(walkerHeldByLayoff('agent-1', ent(w, 'layoff'))).toBe(false);
  });
  it('grasp helpers: plan offset, world lift, agent partner id', () => {
    expect(agentPartnerId('agent:coder')).toBe('coder');
    expect(agentPartnerId('npc-1')).toBeUndefined();
    expect(graspPlan({ x: 100, y: 40 })).toEqual({ x: 100 - GRASP_PLAN_DX, y: 40 });
    const g = graspWorldFromCarrier(10, 5);
    expect(g.x).toBeCloseTo(10 - GRASP_PLAN_DX / PX);
    expect(g.y).toBe(GRASP_LIFT);
    expect(g.z).toBe(5);
  });
  it('manual throwIntoPond still launches from the current position (not the pond-side carry release)', () => {
    let w = initialWorld(0);
    w = { ...w, ents: w.ents.map((e) => e.id === 'npc-1' ? { ...e, x: 1470, y: 330, act: 'idle' as const } : e) };
    w = throwIntoPond(w, 'npc-1', 0);
    expect(ent(w, 'npc-1').act).toBe('fall');
    expect(ent(w, 'npc-1').x).toBe(1470);
    expect(ent(w, 'npc-1').tx).toBe(pondCenter().x);
  });
});
describe('side characters walk around the building', () => {
  it('a straight line through the office is replaced by a corner waypoint; the full route never crosses it', () => {
    const a = { x: 100, y: 420 }, b = { x: 1450, y: 420 };
    expect(crossesBuilding(a, b)).toBe(true);
    let p = a, hops = 0; const pts = [a];
    while ((p.x !== b.x || p.y !== b.y) && hops++ < 6) { p = waypoint(p, b); pts.push(p); }
    expect(p).toEqual(b); expect(pts.slice(1).every((q, i) => !crossesBuilding(pts[i], q))).toBe(true);
    expect(waypoint({ x: 1400, y: 300 }, { x: 1500, y: 600 })).toEqual({ x: 1500, y: 600 });
  });
});
describe('visiting Sếp', () => {
  it('menuEnt includes the visiting boss even though initialWorld has no sếp', () => {
    expect(initialWorld(0).ents.find((e) => e.kind === 'boss' || e.id === BOSS_ID)).toBeUndefined();
    expect(menuEnt(BOSS_ID)).toEqual({ name: BOSS_NAME, look: BOSS_LOOK });
    expect(menuEnt('npc-1')?.name).toBe('Tèo');
    expect(menuEnt('no-such')).toBeUndefined();
  });
  it('visit ends on schedule without a pond throw; no leftover bossUntil', () => {
    let w = forceBoss(initialWorld(0), 1000);
    expect(ent(w, BOSS_ID).kind).toBe('boss');
    expect(w.bossUntil).toBe(17_000);
    w = run(w, 1000, 20_000, () => 0.5);
    expect(w.ents.find((e) => e.kind === 'boss')).toBeUndefined();
    expect(w.bossUntil).toBeUndefined();
  });
  it('throwing Sếp uses the pond fall, then leaves with no ghost, duplicate, or stuck visit', () => {
    let w = forceBoss(initialWorld(0), 1000);
    w = throwIntoPond(w, BOSS_ID, 1000);
    expect(ent(w, BOSS_ID).act).toBe('fall');
    expect(ent(w, BOSS_ID).tx).toBe(pondCenter().x);
    w = step(w, 1200, () => 0.001); // would spawn a visit if the falling sếp were ignored
    expect(w.ents.filter((e) => e.kind === 'boss')).toHaveLength(1);
    expect(ent(w, BOSS_ID).act).toBe('fall');
    w = run(w, 1200, 10_000, () => 0.5);
    expect(w.ents.find((e) => e.kind === 'boss')).toBeUndefined();
    expect(w.bossUntil).toBeUndefined();
  });
  it('an expired visit does not yank Sếp out of the pond animation or spawn a second sếp', () => {
    let w = forceBoss(initialWorld(0), 1000);
    w = throwIntoPond(w, BOSS_ID, 1000);
    w = { ...w, bossUntil: 1000 };
    w = step(w, 1400, () => 0.001);
    expect(w.ents.filter((e) => e.kind === 'boss')).toHaveLength(1);
    expect(['fall', 'eaten']).toContain(ent(w, BOSS_ID).act);
    w = run(w, 1400, 10_000, () => 0.5);
    expect(w.ents.filter((e) => e.kind === 'boss')).toHaveLength(0);
    expect(w.bossUntil).toBeUndefined();
  });
});
describe('names and avatars (Phúc presets)', () => {
  it('stores name + preset id, rejects junk', () => {
    const store = { getItem: () => JSON.stringify({ 'agent:coder': { name: ' Hùng ', look: 'nam_03' }, x: { look: '<svg onload=1>' }, y: 5 }) };
    expect(loadLooks(store)).toEqual({ 'agent:coder': { name: 'Hùng', look: 'nam_03' } });
    expect(setIdent({}, 'k', { name: '', look: 'bad' })).toEqual({});
    expect(agentKey({ name: 'coder' })).toBe('agent:coder');
    const k = `npc:${BOSS_ID}`;
    const saved = setIdent({}, k, { name: ' Sếp Lớn ', look: 'nam_07' });
    expect(saved[k]).toEqual({ name: 'Sếp Lớn', look: 'nam_07' });
    setCurrentLooks(saved);
    expect(currentName(k)).toBe('Sếp Lớn');
    expect(currentLook(k)).toBe('nam_07');
    setCurrentLooks({});
  });
  it('renders 20 presets as cropped SVG; Vanphong 3D picks the chosen preset', () => {
    expect(PRESETS).toHaveLength(20);
    const svg = chibiSvg('nu_04')!; expect(svg).toMatch(/^<svg class="svg-nv" viewBox="30 8 100 100"/); expect(svg).not.toContain('class="ban"');
    setCurrentLooks({ 'agent:coder': { look: 'nu_10' } });
    expect(lookFor({ role: 'coder', id: 'x', name: 'coder' }).toc).toBe('#d6455d');
    setCurrentLooks({});
  });
});

const aabb = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
describe('ATM · snack pad vs road', () => {
  it('concrete pad stays on the sidewalk (no overlap with any road lane)', () => {
    expect(ATM.y + ATM.h).toBeLessThanOrEqual(ROADS[1].y); // south edge at/before front street
    for (const r of ROADS) expect(aabb(ATM, r), `ATM vs road ${r.x},${r.y}`).toBe(false);
    expect(ATM.h).toBe(GATE.h); // same sidewalk strip as the SW gate pad
    expect(ATM.w).toBeGreaterThanOrEqual(120);
    for (const p of ATM_SPOTS) {
      expect(p.x).toBeGreaterThan(ATM.x); expect(p.x).toBeLessThan(ATM.x + ATM.w);
      expect(p.y).toBeGreaterThan(ATM.y); expect(p.y).toBeLessThan(ATM.y + ATM.h);
    }
    expect(PRINT.y + PRINT.h).toBeLessThan(BUILDING.y + 40); // indoor printer untouched
  });
});
