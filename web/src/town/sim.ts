// Side characters around the office: IT Ops (indoors), mindless NPCs, the dog Chos An, the cat Meow. Pure step function, rnd injected.
import type { ItOpsStatus } from '../types';
import { LINES } from './dialogue';
import { BBQ_SEATS, CAFE_SEATS, ITOPS_SPOT, MASSAGE_BEDS, POND_EDGE, ROMANCE_SPOTS, STREET, TRADA_STOOLS, YARD, pondCenter, waypoint, type Pt } from './map';
export type Kind = 'itops' | 'npc' | 'dog' | 'cat';
export type Act = 'idle' | 'walk' | 'drink' | 'beer' | 'chat' | 'run' | 'bark' | 'fight' | 'report' | 'fall' | 'eaten' | 'gone' | 'massage' | 'knocked' | 'bbq' | 'romance';
export interface Ent {
  id: string; kind: Kind; name: string; look?: string; x: number; y: number; tx: number; ty: number; speed: number;
  act: Act; next?: Act; until: number; say?: string; sayUntil?: number; reported?: string; partner?: string;
}
export interface World { ents: Ent[]; reportedKey?: string; t: number }
export const pick = <T,>(a: readonly T[], r: () => number): T => a[Math.floor(r() * a.length) % a.length];
const jitter = (p: Pt, r: () => number, d = 14): Pt => ({ x: p.x + (r() - 0.5) * d, y: p.y + (r() - 0.5) * d });
/** Bubble display defaults — paced so a human can finish reading before the next line. */
export const SAY_MS = 6000;
export function initialWorld(now: number): World {
  const e = (id: string, kind: Kind, name: string, p: Pt, look?: string, speed = 90): Ent => ({ id, kind, name, look, x: p.x, y: p.y, tx: p.x, ty: p.y, speed, act: 'idle', until: now + 1500 });
  return { t: now, ents: [
    e('itops', 'itops', 'IT Ops', ITOPS_SPOT, 'nam_01', 90),
    e('npc-1', 'npc', 'Tèo', YARD[0], 'nam_04'), e('npc-2', 'npc', 'Tý', CAFE_SEATS[0], 'nu_04'), e('npc-3', 'npc', 'Bờm', TRADA_STOOLS[1], 'nam_06'), e('npc-4', 'npc', 'Mít', STREET[1], 'nu_07'),
    e('dog', 'dog', 'Chos An', YARD[1], undefined, 170), e('cat', 'cat', 'Meow', YARD[2], undefined, 130),
  ] };
}
const arrived = (e: Ent) => Math.hypot(e.tx - e.x, e.ty - e.y) < 2;
const go = (e: Ent, p: Pt, next: Act, speed?: number): Ent => ({ ...e, tx: p.x, ty: p.y, act: 'walk', next, speed: speed ?? e.speed });
const say = (e: Ent, text: string, now: number, ms = SAY_MS): Ent => ({ ...e, say: text, sayUntil: now + ms });
/** Alert key: what IT Ops has to report (alert names, or the monitor error). Undefined when nothing is wrong or nothing is configured. */
export function problemKey(s?: ItOpsStatus): string | undefined {
  if (!s || s.mode === 'unconfigured') return undefined;
  if (s.state === 'alert' && s.alerts.length) return s.alerts.map((a) => a.name).join(',');
  if (s.state === 'error') return `error:${s.error ?? ''}`;
  return undefined;
}
export function problemText(s: ItOpsStatus): string {
  if (s.state === 'error') return `Không đọc được metrics: ${s.error ?? 'lỗi'}`;
  const a = s.alerts[0]; const more = s.alerts.length > 1 ? ` (+${s.alerts.length - 1})` : '';
  return `${LINES.itopsReport[0]} ${a.name}${a.detail ? ` · ${a.detail}` : ''}${more}`;
}
/** Starts the throw: any entity flies into the pond and gets eaten. */
export function throwIntoPond(w: World, id: string, now: number): World {
  return { ...w, ents: w.ents.map((e) => (e.id === id && e.act !== 'eaten' && e.act !== 'gone' ? say({ ...e, tx: pondCenter().x, ty: pondCenter().y, act: 'fall', speed: 420, until: now + 4000, partner: undefined }, pick(LINES.thrown, Math.random), now, 2800) : e)) };
}
/** A vehicle knocked someone over: they lie on the road for a few seconds, then get up (comedic, no injuries shown). */
export function knockDown(w: World, id: string, now: number, r: () => number): World {
  return { ...w, ents: w.ents.map((e) => (e.id === id && (e.act === 'walk' || e.act === 'idle' || e.act === 'chat' || e.act === 'bark' || e.act === 'romance') ? say({ ...e, act: 'knocked', tx: e.x, ty: e.y, until: now + 4000, partner: undefined }, pick(e.kind === 'dog' ? LINES.dogFight : e.kind === 'cat' ? LINES.catFight : LINES.hit, r), now, 5500) : e)) };
}
/** Force two free NPCs into a secret garden affair (screenshots / debug). */
export function forceRomance(w: World, now: number, r: () => number = Math.random): World {
  const free = w.ents.filter((e) => e.kind === 'npc' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' && e.act !== 'romance');
  if (free.length < 2) return w;
  const a = free[0], b = free[1], c = pick(ROMANCE_SPOTS, r), gap = 14;
  return { ...w, ents: w.ents.map((e) => {
    if (e.id === a.id) return say(go({ ...e, partner: b.id }, { x: c.x - gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
    if (e.id === b.id) return say(go({ ...e, partner: a.id }, { x: c.x + gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
    return e;
  }) };
}
function decide(e: Ent, w: World, now: number, r: () => number): Ent {
  switch (e.kind) {
    case 'npc': {
      const x = r();
      if (x < 0.18) return say(go(e, jitter(pick(CAFE_SEATS, r), r), 'drink'), pick(LINES.coffee, r), now);
      if (x < 0.34) return say(go(e, jitter(pick(TRADA_STOOLS, r), r), 'beer'), pick(LINES.beer, r), now);
      if (x < 0.46) return say(go(e, jitter(pick(MASSAGE_BEDS, r), r, 6), 'massage'), pick(LINES.massageGo, r), now);
      if (x < 0.58) return say(go(e, jitter(pick(BBQ_SEATS, r), r, 8), 'bbq'), pick(LINES.bbqGo, r), now);
      if (x < 0.68) return say(go(e, pick(STREET, r), 'idle', 190), pick(LINES.run, r), now);
      if (x < 0.8) { const o = pick(w.ents.filter((z) => z.kind === 'npc' && z.id !== e.id && z.act !== 'gone'), r); return o ? go(e, jitter({ x: o.x + 28, y: o.y }, r, 6), 'chat') : e; }
      if (x < 0.9) return go(e, pick(POND_EDGE, r), r() < 0.35 ? 'fall' : 'idle');
      return go({ ...e, partner: undefined }, pick(YARD, r), 'idle');
    }
    case 'dog': {
      if (r() < 0.18) return say({ ...e, act: 'bark', until: now + 4000 }, pick(LINES.dogBark, r), now, 4000);
      return go(e, jitter(pick([...YARD, ...STREET], r), r, 40), 'idle');
    }
    case 'cat': {
      const dog = w.ents.find((z) => z.kind === 'dog');
      if (dog && dog.act !== 'gone' && dog.act !== 'eaten' && dog.act !== 'fall' && r() < 0.14) return say(go(e, { x: dog.x + 18, y: dog.y }, 'fight', 200), pick(LINES.catFight, r), now);
      return go(e, jitter(pick([...YARD, ...CAFE_SEATS, ...TRADA_STOOLS], r), r, 30), 'idle');
    }
    default: return { ...e, until: now + 6000 };
  }
}
function arrive(e: Ent, now: number, r: () => number): Ent {
  const n = e.next ?? 'idle';
  switch (n) {
    case 'drink': return say({ ...e, act: 'drink', until: now + 8000 + r() * 5000 }, pick(LINES.coffee, r), now);
    case 'beer': return say({ ...e, act: 'beer', until: now + 8000 + r() * 5000 }, pick(LINES.beer, r), now);
    case 'chat': return say({ ...e, act: 'chat', until: now + 7500 }, pick(r() < 0.2 ? LINES.massageTalk : r() < 0.4 ? LINES.bbqTalk : LINES.chat, r), now, 7500);
    case 'massage': return say({ ...e, act: 'massage', until: now + 10000 + r() * 6000 }, pick(LINES.massageTalk, r), now, 6500);
    case 'bbq': return say({ ...e, act: 'bbq', until: now + 10000 + r() * 6000 }, pick(LINES.bbqTalk, r), now, 6500);
    case 'romance': return say({ ...e, act: 'romance', until: now + 14000 + r() * 6000 }, pick(LINES.romance, r), now, 7000);
    case 'fall': return say({ ...e, tx: pondCenter().x, ty: pondCenter().y, act: 'fall', speed: 300, until: now + 4000 }, pick(LINES.slipPond, r), now, 2800);
    case 'fight': return { ...e, act: 'fight', until: now + 5500 };
    default: return { ...e, act: 'idle', until: now + 3000 + r() * 5000, partner: undefined };
  }
}
/** Advance the world. itops: latest monitor status (undefined until the server sent one). */
export function step(w: World, now: number, r: () => number, itops?: ItOpsStatus): World {
  const dt = Math.min(1, Math.max(0, (now - w.t) / 1000));
  let reportedKey = w.reportedKey; const key = problemKey(itops);
  if (!key) reportedKey = undefined;
  const dog0 = w.ents.find((z) => z.kind === 'dog');
  let ents = w.ents.map((e0) => {
    let e = e0;
    if (e.kind === 'cat' && e.act === 'walk' && e.next === 'fight' && dog0) e = { ...e, tx: dog0.x + 18, ty: dog0.y };
    if (e.sayUntil && now > e.sayUntil) e = { ...e, say: undefined, sayUntil: undefined };
    if (e.act === 'walk' || e.act === 'fall' || e.act === 'report') {
      const goal = e.act === 'fall' ? { x: e.tx, y: e.ty } : waypoint(e, { x: e.tx, y: e.ty });
      const dx = goal.x - e.x, dy = goal.y - e.y, d = Math.hypot(dx, dy), s = e.speed * dt;
      e = d <= s ? { ...e, x: goal.x, y: goal.y } : { ...e, x: e.x + (dx / d) * s, y: e.y + (dy / d) * s };
    }
    if (e.act === 'fall' && arrived(e)) return say({ ...e, act: 'eaten', until: now + 2800 }, pick(LINES.eaten, r), now, 2800);
    if (e.act === 'eaten' && now > e.until) return { ...e, act: 'gone', say: undefined, until: now + 15000 } as Ent;
    if (e.act === 'gone') { if (now <= e.until) return e; const p = pick(STREET, r); return say({ ...e, x: p.x, y: p.y, tx: p.x, ty: p.y, act: 'idle', until: now + 3000 }, pick(LINES.back, r), now); }
    if (e.act === 'knocked') { if (now <= e.until) return e; return say({ ...e, act: 'idle', until: now + 1500 }, pick(LINES.back, r), now, 4000); }
    if (e.act === 'massage' && now <= e.until && !e.say && r() < 0.025) return say(e, pick(LINES.massageTalk, r), now, 5500);
    if (e.act === 'bbq' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(LINES.bbqTalk, r), now, 5500);
    if (e.act === 'romance' && now <= e.until && !e.say && r() < 0.04) return say(e, pick(LINES.romance, r), now, 6500);
    if ((e.act === 'massage' || e.act === 'bbq' || e.act === 'romance') && now > e.until) return { ...e, act: 'idle' as const, until: now + 3000, partner: undefined, say: undefined };
    if (e.act === 'walk' && arrived(e)) return arrive(e, now, r);
    if (e.kind === 'itops') {
      if (key && key !== reportedKey && e.act !== 'report' && itops) {
        reportedKey = key;
        const text = problemText(itops).replace(LINES.itopsReport[0], pick(LINES.itopsReport, r));
        return say({ ...e, x: ITOPS_SPOT.x, y: ITOPS_SPOT.y, tx: ITOPS_SPOT.x, ty: ITOPS_SPOT.y, act: 'report', reported: text, until: now + 14000 }, text, now, 12000);
      }
      if (e.act === 'report' && now > e.until) return { ...e, act: 'idle' as const, until: now + 6000, say: undefined };
      if (e.act === 'idle' && Math.hypot(e.x - ITOPS_SPOT.x, e.y - ITOPS_SPOT.y) > 2) return go(e, ITOPS_SPOT, 'idle', 100);
      return e;
    }
    if (e.act !== 'walk' && now > e.until) return decide(e, w, now, r);
    return e;
  });
  // Rare secret garden affair: two free idle NPCs sneak off together.
  const free = ents.filter((e) => e.kind === 'npc' && e.act === 'idle' && !e.partner && now > e.until - 50);
  if (free.length >= 2 && r() < 0.01) {
    const a = free[0], b = free[1], c = pick(ROMANCE_SPOTS, r), gap = 14;
    ents = ents.map((e) => {
      if (e.id === a.id) return say(go({ ...e, partner: b.id }, { x: c.x - gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
      if (e.id === b.id) return say(go({ ...e, partner: a.id }, { x: c.x + gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
      return e;
    });
  }
  const cat = ents.find((e) => e.kind === 'cat');
  if (cat?.act === 'fight') ents = ents.map((e) => (e.kind === 'dog' && e.act !== 'fight' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' ? say({ ...e, act: 'fight', tx: e.x, ty: e.y, until: cat.until }, pick(LINES.dogFight, r), now, 5000) : e));
  const dog = ents.find((e) => e.kind === 'dog');
  if (dog?.act === 'bark' && dog.sayUntil && dog.sayUntil - now > 3500) { const n = ents.find((e) => e.kind === 'npc' && !e.say && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'romance'); if (n) ents = ents.map((e) => (e === n ? say(e, pick(LINES.dogReact, r), now, 5000) : e)); }
  return { ents, reportedKey, t: now };
}
