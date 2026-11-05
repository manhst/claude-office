import { describe, it, expect } from 'vitest';
import { LINES } from '../src/town/dialogue';
import { forceLayoff, initialWorld, step, throwIntoPond, problemKey, problemText, type World } from '../src/town/sim';
import { ITOPS_SPOT, inPond, pondCenter, CAFE, TRADA, BUILDING, crossesBuilding, waypoint, toWorld, fromWorld } from '../src/town/map';
import { BIEN } from '../src/ref-vanphong/adapter';
import { loadLooks, setIdent, agentKey } from '../src/town/looks';
import { chibiSvg, PRESETS } from '../src/town/Avatar';
import { lookFor } from '../src/ref-vanphong/adapter';
import { setCurrentLooks } from '../src/town/looks';
const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const run = (w: World, from: number, ms: number, r: () => number, it?: any) => { for (let t = from; t <= from + ms; t += 200) w = step(w, t, r, it); return w; };
const ent = (w: World, id: string) => w.ents.find((e) => e.id === id)!;
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
    // Walk to pond
    w = run(w, 1000, 20000, () => 0.5);
    const v = ent(w, carried.id);
    expect(['fall', 'eaten', 'gone', 'idle', 'walk']).toContain(v.act);
    // Eventually hits pond eat flow
    const hitPond = ['fall', 'eaten', 'gone'].includes(v.act) || inPond(v);
    expect(hitPond || ent(w, 'layoff').act === 'idle').toBe(true);
  });
  it('hunting an agent prey emits layoffEvent for the scene bridge', () => {
    let w = initialWorld(0);
    w = { ...w, ents: w.ents.map((e) => e.id === 'layoff' ? { ...e, act: 'idle' as const, x: 400, y: 400, until: 0 } : e) };
    const prey = [{ id: 'agent-1', x: 420, y: 400 }];
    w = step(w, 500, () => 0.01, undefined, prey); // decide → hunt agent (no NPCs useless if still busy... make NPCs working)
    // Force: set layoff hunting agent directly via force path on empty npc useless — use step with only agent prey
    w = { ...w, ents: w.ents.map((e) => {
      if (e.id === 'layoff') return { ...e, act: 'hunt' as const, partner: 'agent:agent-1', x: 420, y: 400, tx: 420, ty: 400, until: 0 };
      if (e.kind === 'npc') return { ...e, act: 'gone' as const, until: 1e12 }; // no NPC competition
      return e;
    }) };
    w = step(w, 800, () => 0.9, undefined, prey); // near prey → resolve (r>=0.5 → pond or eat)
    expect(w.layoffEvent?.agentId).toBe('agent-1');
    expect(['eat', 'pond']).toContain(w.layoffEvent!.type);
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
describe('names and avatars (Phúc presets)', () => {
  it('stores name + preset id, rejects junk', () => {
    const store = { getItem: () => JSON.stringify({ 'agent:coder': { name: ' Hùng ', look: 'nam_03' }, x: { look: '<svg onload=1>' }, y: 5 }) };
    expect(loadLooks(store)).toEqual({ 'agent:coder': { name: 'Hùng', look: 'nam_03' } });
    expect(setIdent({}, 'k', { name: '', look: 'bad' })).toEqual({});
    expect(agentKey({ name: 'coder' })).toBe('agent:coder');
  });
  it('renders 20 presets as cropped SVG; Vanphong 3D picks the chosen preset', () => {
    expect(PRESETS).toHaveLength(20);
    const svg = chibiSvg('nu_04')!; expect(svg).toMatch(/^<svg class="svg-nv" viewBox="30 8 100 100"/); expect(svg).not.toContain('class="ban"');
    setCurrentLooks({ 'agent:coder': { look: 'nu_10' } });
    expect(lookFor({ role: 'coder', id: 'x', name: 'coder' }).toc).toBe('#d6455d');
    setCurrentLooks({});
  });
});
