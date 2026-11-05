// Side characters around the office: IT Ops, Architect, mindless NPCs, the dog Chos An, the cat Meow. Pure step function, rnd injected.
import type { ItOpsStatus } from '../types';
import { ARCHITECT_SPOT, CAFE_SEATS, NOC, POND_EDGE, STREET, TRADA_STOOLS, YARD, pondCenter, waypoint, type Pt } from './map';
export type Kind = 'itops' | 'architect' | 'npc' | 'dog' | 'cat';
export type Act = 'idle' | 'walk' | 'drink' | 'beer' | 'chat' | 'run' | 'bark' | 'fight' | 'report' | 'fall' | 'eaten' | 'gone';
export interface Ent {
  id: string; kind: Kind; name: string; look?: string; x: number; y: number; tx: number; ty: number; speed: number;
  act: Act; next?: Act; until: number; say?: string; sayUntil?: number; reported?: string;
}
export interface World { ents: Ent[]; reportedKey?: string; t: number }
const NONSENSE = ['Hôm nay trời đẹp ghê', 'Ông thấy con cá sấu nhìn tôi không?', 'Deadline là gì, ăn được không?', 'Tối nay đá bóng không?', 'Giá vàng lại lên rồi', 'Tôi vừa mơ thấy một con bug',
  'Mạng lag quá trời', 'Có ai thấy con chó Chos An đâu không?', 'Cuối tuần đi Vũng Tàu nhé', 'Nghe nói sếp sắp tăng lương', 'Code chạy được thì đừng động vào', 'Trà đá 3 nghìn một cốc thôi'];
export const pick = <T,>(a: readonly T[], r: () => number): T => a[Math.floor(r() * a.length) % a.length];
const jitter = (p: Pt, r: () => number, d = 14): Pt => ({ x: p.x + (r() - 0.5) * d, y: p.y + (r() - 0.5) * d });
export function initialWorld(now: number): World {
  const e = (id: string, kind: Kind, name: string, p: Pt, look?: string, speed = 90): Ent => ({ id, kind, name, look, x: p.x, y: p.y, tx: p.x, ty: p.y, speed, act: 'idle', until: now + 1500 });
  return { t: now, ents: [
    e('itops', 'itops', 'IT Ops', NOC, 'nam_01', 150), e('architect', 'architect', 'Architect', ARCHITECT_SPOT, 'nam_03', 80),
    e('npc-1', 'npc', 'Tèo', YARD[0], 'nam_04'), e('npc-2', 'npc', 'Tý', CAFE_SEATS[0], 'nu_04'), e('npc-3', 'npc', 'Bờm', TRADA_STOOLS[1], 'nam_06'), e('npc-4', 'npc', 'Mít', STREET[1], 'nu_07'),
    e('dog', 'dog', 'Chos An', YARD[1], undefined, 170), e('cat', 'cat', 'Meow', YARD[2], undefined, 130),
  ] };
}
const arrived = (e: Ent) => Math.hypot(e.tx - e.x, e.ty - e.y) < 2;
const go = (e: Ent, p: Pt, next: Act, speed?: number): Ent => ({ ...e, tx: p.x, ty: p.y, act: 'walk', next, speed: speed ?? e.speed });
const say = (e: Ent, text: string, now: number, ms = 3500): Ent => ({ ...e, say: text, sayUntil: now + ms });
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
  return `Sếp ơi! ${a.name}${a.detail ? ` · ${a.detail}` : ''}${more}`;
}
/** Starts the throw: any entity flies into the pond and gets eaten. */
export function throwIntoPond(w: World, id: string, now: number): World {
  return { ...w, ents: w.ents.map((e) => (e.id === id && e.act !== 'eaten' && e.act !== 'gone' ? say({ ...e, tx: pondCenter().x, ty: pondCenter().y, act: 'fall', speed: 420, until: now + 4000 }, 'Áaaaa!', now, 1500) : e)) };
}
function decide(e: Ent, w: World, now: number, r: () => number): Ent {
  switch (e.kind) {
    case 'npc': {
      const x = r();
      if (x < 0.22) return say(go(e, jitter(pick(CAFE_SEATS, r), r), 'drink'), 'Đi Crossian Cafe làm ly bạc xỉu', now);
      if (x < 0.42) return say(go(e, jitter(pick(TRADA_STOOLS, r), r), 'beer'), pick(['Làm cốc trà đá', 'Làm vài lon bia không?', 'Dô dô!'], r), now);
      if (x < 0.58) return go(e, pick(STREET, r), 'idle', 190); // run outside
      if (x < 0.78) { const o = pick(w.ents.filter((z) => z.kind === 'npc' && z.id !== e.id && z.act !== 'gone'), r); return o ? go(e, jitter({ x: o.x + 28, y: o.y }, r, 6), 'chat') : e; }
      if (x < 0.9) return go(e, pick(POND_EDGE, r), r() < 0.35 ? 'fall' : 'idle'); // sometimes slips into the pond
      return go(e, pick(YARD, r), 'idle');
    }
    case 'dog': {
      if (r() < 0.25) return say({ ...e, act: 'bark', until: now + 2600 }, 'GÂU GÂU GÂU GÂU!!!', now, 2600);
      return go(e, jitter(pick([...YARD, ...STREET], r), r, 40), 'idle');
    }
    case 'cat': {
      const dog = w.ents.find((z) => z.kind === 'dog');
      if (dog && dog.act !== 'gone' && dog.act !== 'eaten' && dog.act !== 'fall' && r() < 0.2) return say(go(e, { x: dog.x + 18, y: dog.y }, 'fight', 200), 'Meoooo! Xì!', now);
      return go(e, jitter(pick([...YARD, ...CAFE_SEATS, ...TRADA_STOOLS], r), r, 30), 'idle');
    }
    default: return { ...e, until: now + 4000 };
  }
}
function arrive(e: Ent, now: number, r: () => number): Ent {
  const n = e.next ?? 'idle';
  switch (n) {
    case 'drink': return say({ ...e, act: 'drink', until: now + 6000 + r() * 4000 }, 'Cà phê Crossian ngon thật', now);
    case 'beer': return say({ ...e, act: 'beer', until: now + 6000 + r() * 4000 }, pick(['Một hai ba dô!', 'Trà đá vỉa hè là chân ái', 'Thêm lon nữa'], r), now);
    case 'chat': return say({ ...e, act: 'chat', until: now + 4500 }, pick(NONSENSE, r), now, 4500);
    case 'fall': return say({ ...e, tx: pondCenter().x, ty: pondCenter().y, act: 'fall', speed: 300, until: now + 4000 }, 'Ơ ơ ơ trượt chân!', now, 1500);
    case 'fight': return { ...e, act: 'fight', until: now + 3200 };
    default: return { ...e, act: 'idle', until: now + 1500 + r() * 3500 };
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
    if (e.kind === 'cat' && e.act === 'walk' && e.next === 'fight' && dog0) e = { ...e, tx: dog0.x + 18, ty: dog0.y }; // chase the dog
    if (e.sayUntil && now > e.sayUntil) e = { ...e, say: undefined, sayUntil: undefined };
    if (e.act === 'walk' || e.act === 'fall' || e.act === 'report') { // move toward target
      const goal = e.act === 'fall' ? { x: e.tx, y: e.ty } : waypoint(e, { x: e.tx, y: e.ty }); // thrown/slipping flies straight; walkers go round the building
      const dx = goal.x - e.x, dy = goal.y - e.y, d = Math.hypot(dx, dy), s = e.speed * dt;
      e = d <= s ? { ...e, x: goal.x, y: goal.y } : { ...e, x: e.x + (dx / d) * s, y: e.y + (dy / d) * s };
    }
    if (e.act === 'fall' && arrived(e)) return say({ ...e, act: 'eaten', until: now + 2200 }, 'Cứu với!!!', now, 2200);
    if (e.act === 'eaten' && now > e.until) return { ...e, act: 'gone', say: undefined, until: now + 15000 } as Ent;
    if (e.act === 'gone') { if (now <= e.until) return e; const p = pick(STREET, r); return say({ ...e, x: p.x, y: p.y, tx: p.x, ty: p.y, act: 'idle', until: now + 2000 }, 'Tôi đã trở lại!', now); }
    if (e.act === 'walk' && arrived(e)) return arrive(e, now, r);
    if (e.kind === 'itops') {
      if (key && key !== reportedKey && e.act !== 'report' && itops) { reportedKey = key; return say({ ...e, tx: ARCHITECT_SPOT.x + 80, ty: ARCHITECT_SPOT.y, act: 'report', speed: 220, reported: problemText(itops), until: now + 20000 }, 'Có biến! Phải báo Architect', now, 2000); }
      if (e.act === 'report' && arrived(e)) return say({ ...e, act: 'chat', until: now + 7000 }, e.reported ?? 'Có sự cố', now, 7000);
      if (e.act === 'chat' && now > e.until) return go(e, NOC, 'idle', 120);
      if (e.act === 'idle' && Math.hypot(e.x - NOC.x, e.y - NOC.y) > 2) return go(e, NOC, 'idle', 120);
      return e;
    }
    if (e.kind === 'architect') return e;
    if (e.act !== 'walk' && now > e.until) return decide(e, w, now, r);
    return e;
  });
  // Architect answers when IT Ops arrives; the dog fights back when the cat starts it.
  const it = ents.find((e) => e.kind === 'itops');
  if (it?.act === 'chat' && it.reported && it.sayUntil && it.sayUntil - now > 6500) ents = ents.map((e) => (e.kind === 'architect' ? say(e, 'Ok, để anh xem. Gọi on-call ngay!', now, 6000) : e));
  const cat = ents.find((e) => e.kind === 'cat');
  if (cat?.act === 'fight') ents = ents.map((e) => (e.kind === 'dog' && e.act !== 'fight' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' ? say({ ...e, act: 'fight', tx: e.x, ty: e.y, until: cat.until }, 'GÂU! GRRRR!', now, 3000) : e));
  return { ents, reportedKey, t: now };
}
