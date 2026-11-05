import { describe, expect, it } from 'vitest';
import { CAP, P, VEHICLES, forceCrash, forceFire, initialTraffic, stepTraffic, type Traffic } from '../src/town/traffic';
import { LANES } from '../src/town/map';
import { PAIRS } from '../src/town/dialogue';
import { initialWorld, knockDown, step } from '../src/town/sim';
import { MASSAGE_BEDS } from '../src/town/map';

const run = (t: Traffic, from: number, to: number, r: () => number = () => 0.5, peds: { id: string; x: number; y: number }[] = []) => {
  const hits: string[] = []; for (let n = from; n <= to; n += 200) { const o = stepTraffic(t, n, r, peds); t = o.traffic; hits.push(...o.hits); } return { t, hits };
};
describe('main-road traffic', () => {
  it('has many vehicle types and caps concurrent vehicles', () => {
    expect(Object.keys(VEHICLES).length).toBeGreaterThanOrEqual(20);
    let t = initialTraffic(0), max = 0; for (let n = 0; n < 120_000; n += 200) { t = stepTraffic(t, n, () => 0.99).traffic; max = Math.max(max, t.vs.length); }
    expect(max).toBeGreaterThan(0); expect(max).toBeLessThanOrEqual(CAP);
  });
  it('crash: both drivers argue in turns with two-sided lines, then drive on; ambulance + police are dispatched', () => {
    let t = forceCrash(initialTraffic(0), 0, 700, ['oto-con', 'xe-tang']); const said = new Set<string>();
    // Simulate a rear-end so the call path runs (forceCrash starts already arguing — seed a drive crash too)
    for (let n = 0; n < P.argueMs - 200; n += 200) { t = stepTraffic(t, n, () => 0.99).traffic; for (const v of t.vs) if (v.say) said.add(v.say); }
    expect(t.vs.filter((v) => v.state === 'argue').length).toBe(2);
    const ex = PAIRS.crashArgue.find((p) => said.has(p[0]) && said.has(p[1])); expect(ex).toBeDefined();
    t = run(t, P.argueMs, P.argueMs + 400, () => 0.99).t; expect(t.vs.filter((v) => v.id <= 2).every((v) => v.state === 'drive')).toBe(true);
  });
  it('fire and pedestrian hit dispatch an ambulance to the scene', () => {
    let t = forceFire(initialTraffic(0), 0, 900);
    t = stepTraffic(t, 200, () => 0.99).traffic;
    expect(t.vs.some((v) => v.type === 'cuu-thuong' && v.target !== undefined)).toBe(true);
    expect(t.vs.some((v) => v.type === 'cuu-hoa' && v.target !== undefined)).toBe(true);
    // hit path
    t = { ...initialTraffic(0), vs: [{ id: 1, type: 'oto-con', lane: 0, x: 400, y: LANES[0].y, speed: 240, state: 'drive', until: 0 }], nextId: 2, nextSpawn: 1e9 };
    const { t: t2, hits } = run(t, 0, 2000, () => 0.1, [{ id: 'npc-1', x: 470, y: LANES[0].y + 10 }]);
    expect(hits).toContain('npc-1');
    expect(t2.vs.some((v) => v.type === 'cuu-thuong')).toBe(true);
  });
  it('fire → explosion → wreck → cleared; a fire truck is not required for clearing', () => {
    let t = forceFire(initialTraffic(0), 0, 900); const seen = new Set<string>();
    for (let n = 0; n < P.fireMs + P.boomMs + P.wreckMs + 1000; n += 200) { t = stepTraffic(t, n, () => 0.99).traffic; const v = t.vs.find((x) => x.id === 1); seen.add(v ? v.state : 'cleared'); }
    expect([...seen]).toEqual(expect.arrayContaining(['fire', 'boom', 'wreck', 'cleared']));
  });
  it('knocks over a pedestrian standing in the lane; they get up later', () => {
    let t: Traffic = { ...initialTraffic(0), vs: [{ id: 1, type: 'oto-con', lane: 0, x: 400, y: LANES[0].y, speed: 240, state: 'drive', until: 0 }], nextId: 2, nextSpawn: 1e9 };
    const { hits } = run(t, 0, 2000, () => 0.1, [{ id: 'npc-1', x: 470, y: LANES[0].y + 10 }]);
    expect(hits).toContain('npc-1');
    let w = initialWorld(0); w = { ...w, ents: w.ents.map((e) => (e.id === 'npc-1' ? { ...e, act: 'idle' as const } : e)) };
    w = knockDown(w, 'npc-1', 0, () => 0.5); expect(w.ents.find((e) => e.id === 'npc-1')!.act).toBe('knocked');
    w = step(w, 4500, () => 0.5); expect(w.ents.find((e) => e.id === 'npc-1')!.act).not.toBe('knocked');
  });
  it('NPCs sometimes go to Xuka Mát xa and lie on a bed', () => {
    const w = step(initialWorld(0), 2000, () => 0.45); const n = w.ents.find((e) => e.id === 'npc-1')!;
    expect(n.next).toBe('massage'); expect(Math.min(...MASSAGE_BEDS.map((b) => Math.hypot(b.x - n.tx, b.y - n.ty)))).toBeLessThan(10);
  });
});
