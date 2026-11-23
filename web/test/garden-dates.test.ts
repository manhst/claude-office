import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentUI } from '../src/reducer';
import { idlePlans, officeGoal, officeHome, officePlan, PAIR_GAP, ROMANCE_CENTERS, FIGHT_SPOTS } from '../src/office3d/adapter';
import { newWalker, stepWalker, type Walker } from '../src/walk';
import { walkerSpeedFor } from '../src/officeRunSpeed';
import { allDesks } from '../src/layout';
import { initialWorld, step, type Ent } from '../src/town/sim';
import { ROMANCE_SPOTS } from '../src/town/map';
import { migrateStorage } from '../src/storageMigrate';
import { loadLooks, setCurrentLooks } from '../src/town/looks';
import { loadLabels } from '../src/officeLabels';

// Regression for "nobody dates in the garden / hardly anyone fights" (fb03191 cut the pair odds, e65b728 halved the trip speed so a garden
// date lost half its 36 s slot to walking, and the NPC pair triggers never saw a free NPC). Same scenario at bf9edf7 (4 free agents):
// 15.8 dates/h, 15 s together per date, 220 s/h of fighting; NPCs 0 dates and 0 arguing pairs per hour.
const mulberry = (a: number) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ag = (i: number): AgentUI => ({ id: `s1:a${i}`, role: 'coder', name: `a${i}`, state: 'idle', desk: allDesks()[i], tools: [] });
/** Free agents left alone for `hours`: plans every 100 ms, walkers stepped like the scene does. */
function office(n: number, hours: number) {
  const list = Array.from({ length: n }, (_, i) => ag(i)), agents = Object.fromEntries(list.map((a) => [a.id, a])), order = list.map((a) => a.id);
  const walkers: Record<string, Walker> = Object.fromEntries(list.map((a) => [a.id, newWalker(officeHome(a.desk))]));
  const freeSince = Object.fromEntries(order.map((id) => [id, 0])), dt = 0.1, t0 = 1_000 * 36_000_000;
  const out = { romance: { met: new Set<string>(), secs: 0 }, fight: { met: new Set<string>(), secs: 0 }, kissGap: [] as number[], inGarden: true };
  for (let t = 0; t < hours * 3600; t += dt) {
    const now = t0 + t * 1000, plans = idlePlans(agents, order, [], now, freeSince);
    for (const id of order) { const g = officeGoal(agents[id], agents, [], plans[id]); walkers[id] = stepWalker(walkers[id], g, dt, officePlan, walkerSpeedFor(g, 'idle')); }
    for (const id of order) {
      const p = plans[id]; if (!p?.first || (p.kind !== 'romance' && p.kind !== 'fight')) continue;
      const a = walkers[id], b = walkers[p.partner!], s = out[p.kind];
      if (a.phase !== 'waiting' || b.phase !== 'waiting' || a.goalKey !== p.key || b.goalKey !== p.key) continue;
      if (!s.met.has(p.key) && p.kind === 'romance') {
        out.kissGap.push(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]));
        const mid = [(a.pos[0] + b.pos[0]) / 2, (a.pos[2] + b.pos[2]) / 2];
        out.inGarden &&= ROMANCE_CENTERS.some((c) => Math.hypot(c[0] - mid[0], c[2] - mid[1]) < 0.05);
      }
      s.met.add(p.key); s.secs += dt;
    }
  }
  return { dates: out.romance.met.size / hours, dateSecs: out.romance.secs / hours, fights: out.fight.met.size / hours, fightSecs: out.fight.secs / hours, kissGap: out.kissGap, inGarden: out.inGarden };
}
/** Town NPCs over `hours` with a seeded rng: completed garden dates (both partners kissing at a spot) and two-sided arguing pairs. */
function town(seed: number, hours: number) {
  const r = mulberry(seed); let w = initialWorld(0), wasTogether = false, dates = 0, inGarden = true; const pairs = new Set<string>();
  const partnerOf = (e: Ent) => w.ents.find((z) => z.id === e.partner);
  for (let t = 200; t <= hours * 3_600_000; t += 200) {
    w = step(w, t, r);
    const kiss = w.ents.filter((e) => e.kind === 'npc' && e.act === 'romance' && partnerOf(e)?.act === 'romance' && partnerOf(e)?.partner === e.id);
    if (kiss.length && !wasTogether) { dates++; inGarden &&= kiss.every((e) => ROMANCE_SPOTS.some((s) => Math.hypot(s.x - e.x, s.y - e.y) < 20)); }
    wasTogether = kiss.length > 0;
    for (const e of w.ents) if (e.kind === 'npc' && e.topic && e.partner) pairs.add(`${[e.id, e.partner].sort().join('+')}:${e.topic}:${Math.floor(e.until / 1000)}`);
  }
  return { dates, inGarden, argues: new Set([...pairs].map((p) => p.replace(/:\d+$/, '') + Math.floor(Number(p.split(':').pop()) / 30))).size };
}
const store = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: () => null, clear: () => m.clear(), get length() { return m.size; } }; };

describe('garden dates and fights', () => {
  let local = store();
  beforeEach(() => { local = store(); Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true }); });
  afterEach(() => { setCurrentLooks({}); });

  it('free office agents walk to the garden, meet face to face at kiss distance, and stay a while; fights are back to the 7498bcb level', () => {
    const o = office(4, 2);
    expect(o.dates).toBeGreaterThanOrEqual(15); // bf9edf7: 15.8/h
    expect(o.dateSecs / o.dates).toBeGreaterThanOrEqual(20); // bf9edf7: 15 s together, most of the slot went to walking
    expect(o.inGarden).toBe(true);
    for (const g of o.kissGap) expect(g).toBeCloseTo(PAIR_GAP.romance * 2, 1);
    expect(o.fights).toBeGreaterThanOrEqual(15);
    expect(o.fightSecs).toBeGreaterThanOrEqual(400); // bf9edf7: 220 s/h, 7498bcb: 549 s/h
    expect(FIGHT_SPOTS.length).toBeGreaterThan(0);
  });
  it('two free agents still date and fight', () => {
    const o = office(2, 2);
    expect(o.dates).toBeGreaterThanOrEqual(5); expect(o.fights).toBeGreaterThanOrEqual(4);
  });
  it('town NPCs sneak off to the garden and kiss, and argue in pairs at the amenities', () => {
    let dates = 0, argues = 0;
    for (const seed of [1, 2, 3]) { const t = town(seed, 1); expect(t.inGarden).toBe(true); dates += t.dates; argues += t.argues; }
    expect(dates).toBeGreaterThanOrEqual(3); // bf9edf7: 0 (the pair triggers only looked at NPCs decide() had already sent off)
    expect(argues).toBeGreaterThanOrEqual(15); // bf9edf7: 0
  });
  it('a user migrated from the pre-rename storage (looks nam_/nu_, vp-labels, a very slow vp-run-speed) gets the same dates and fights', () => {
    local = store({ 'office.looks': JSON.stringify({ 'agent:a0': { name: 'Hùng', look: 'nam_03' }, 'agent:a1': { look: 'nu_10' }, 'npc:npc-2': { name: 'Tý xinh', look: 'nu_04' } }),
      'vp-labels': JSON.stringify({ trada: false, bia: true, garden: true }), 'vp-run-speed': '0.1' });
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
    migrateStorage(local, store());
    expect(local.m.has('vp-run-speed')).toBe(false); expect(local.m.get('deck.runSpeed')).toBe('0.1');
    const looks = loadLooks(local); setCurrentLooks(looks);
    expect(looks['agent:a1'].look).toBe('female_10'); expect(loadLabels().garden).toBe(true); expect(loadLabels()['iced-tea']).toBe(false);
    const fresh = (() => { Object.defineProperty(globalThis, 'localStorage', { value: store(), configurable: true }); const o = office(4, 1); Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true }); return o; })();
    const moved = office(4, 1);
    expect(moved.dates).toBe(fresh.dates); expect(moved.fights).toBe(fresh.fights); // pairs hurry at >= walking pace whatever the slider says
    expect(moved.dates).toBeGreaterThanOrEqual(15); expect(moved.dateSecs / moved.dates).toBeGreaterThanOrEqual(20);
    // town NPCs crawl at the migrated 0.1 run speed: sum a few seeds instead of trusting one
    const ts = [1, 2, 3].map((seed) => town(seed, 1)); expect(ts.reduce((n, t) => n + t.dates, 0)).toBeGreaterThanOrEqual(1); expect(ts.reduce((n, t) => n + t.argues, 0)).toBeGreaterThanOrEqual(1);
  });
});
