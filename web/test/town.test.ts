import { describe, it, expect } from 'vitest';
import { initialWorld, step, throwIntoPond, problemKey, problemText, type World } from '../src/town/sim';
import { ARCHITECT_SPOT, inPond, pondCenter, CAFE, TRADA, BUILDING, OFFICE_AT } from '../src/town/map';
import { loadLooks, setIdent, agentKey } from '../src/town/looks';
import { chibiSvg, PRESETS } from '../src/town/Avatar';
import { lookFor } from '../src/ref-vanphong/adapter';
import { setCurrentLooks } from '../src/town/looks';
const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const run = (w: World, from: number, ms: number, r: () => number, it?: any) => { for (let t = from; t <= from + ms; t += 200) w = step(w, t, r, it); return w; };
const ent = (w: World, id: string) => w.ents.find((e) => e.id === id)!;
describe('town sim', () => {
  it('has the cast: IT Ops, Architect, NPCs, dog Chos An, cat Meow', () => {
    const w = initialWorld(0);
    expect(w.ents.map((e) => e.name)).toEqual(expect.arrayContaining(['IT Ops', 'Architect', 'Chos An', 'Meow']));
    expect(w.ents.filter((e) => e.kind === 'npc').length).toBeGreaterThanOrEqual(3);
  });
  it('IT Ops stays put when unconfigured or ok; runs to the Architect on an alert and reports it once', () => {
    let w = run(initialWorld(0), 0, 5000, seq([0.95]), { mode: 'unconfigured', state: 'unconfigured', alerts: [] });
    expect(ent(w, 'itops').act).not.toBe('report');
    const alert = { mode: 'prometheus', state: 'alert', alerts: [{ name: 'DiskFull', detail: 'db1' }] } as any;
    w = run(w, 5200, 3500, seq([0.95]), alert);
    const it = ent(w, 'itops');
    expect(Math.hypot(it.x - ARCHITECT_SPOT.x, it.y - ARCHITECT_SPOT.y)).toBeLessThan(100);
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
    expect(ent(w, 'dog').act).toBe('bark'); expect(ent(w, 'dog').say).toMatch(/GÂU/);
    expect(ent(w, 'cat').next).toBe('fight');
    const npc = ent(w, 'npc-1'); expect(npc.next).toBe('drink');
    expect(npc.tx).toBeGreaterThan(CAFE.x); expect(npc.ty).toBeLessThan(CAFE.y + CAFE.h);
    const w2 = step({ ...w0, t: 0 }, 2000, seq([0.3]));
    expect(ent(w2, 'npc-1').next).toBe('beer'); expect(ent(w2, 'npc-1').tx).toBeGreaterThan(TRADA.x - 20);
    let f = w, fought = false; for (let t = 2200; t < 10000; t += 200) { f = step(f, t, seq([0.99])); fought ||= ent(f, 'dog').act === 'fight' && ent(f, 'cat').act === 'fight'; }
    expect(fought).toBe(true);
    expect(inPond(pondCenter())).toBe(true); expect(OFFICE_AT.x).toBeGreaterThan(BUILDING.x);
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
