// Side characters around the office: IT Ops (indoors), mindless NPCs, the dog Chos An, the cat Meow,
// and Layoff the T-Rex (occasional headcount "optimization"). Pure step function, rnd injected.
import type { ItOpsStatus } from '../types';
import { LINES, PAIRS } from './dialogue';
import { ATM_SPOTS, BBQ_SEATS, CAFE_SEATS, GATE_SPOTS, GYM_SPOTS, ITOPS_SPOT, MASSAGE_BEDS, POD_SPOTS, POND_EDGE, PRINT_SPOTS, ROMANCE_SPOTS, SMOKE_SPOTS, STREET, TRADA_STOOLS, YARD, pondCenter, waypoint, type Pt } from './map';
import { townRunSpeed } from '../vpRunSpeed';
export type Kind = 'itops' | 'npc' | 'dog' | 'cat' | 'trex';
export type Act = 'idle' | 'walk' | 'drink' | 'beer' | 'chat' | 'run' | 'bark' | 'fight' | 'report' | 'fall' | 'eaten' | 'gone' | 'massage' | 'knocked' | 'bbq' | 'romance' | 'smoke' | 'gym' | 'atm' | 'gate' | 'pod' | 'print' | 'drama' | 'hunt' | 'chomp' | 'carry' | 'carried';
export interface Ent {
  id: string; kind: Kind; name: string; look?: string; x: number; y: number; tx: number; ty: number; speed: number;
  act: Act; next?: Act; until: number; say?: string; sayUntil?: number; reported?: string; partner?: string;
  /** Pair dialogue topic while arguing / gossiping. */
  topic?: 'bossGossip' | 'trollReview' | 'ghostSlack' | 'deskWar' | 'gymArgue' | 'atmArgue' | 'printArgue' | 'workArgue';
}
/** Free office agents Layoff may hunt (plan px). Scene feeds these each tick. */
export interface AgentPrey { id: string; x: number; y: number }
/** Scene consumes this to hide/throw a Claude-session agent. */
export type LayoffEvent = { type: 'eat' | 'pond'; agentId: string }
export interface World { ents: Ent[]; reportedKey?: string; t: number; layoffEvent?: LayoffEvent }
export const pick = <T,>(a: readonly T[], r: () => number): T => a[Math.floor(r() * a.length) % a.length];
const jitter = (p: Pt, r: () => number, d = 14): Pt => ({ x: p.x + (r() - 0.5) * d, y: p.y + (r() - 0.5) * d });
/** Bubble display defaults — paced so a human can finish reading before the next line. */
export const SAY_MS = 6000;
/** NPC acts that count as idle/useless (not working a Claude session task). */
export const USELESS_ACTS: ReadonlySet<Act> = new Set(['idle', 'drink', 'beer', 'chat', 'run', 'massage', 'bbq', 'romance', 'smoke', 'gym', 'atm', 'gate', 'pod', 'print', 'drama']);
export function initialWorld(now: number): World {
  const e = (id: string, kind: Kind, name: string, p: Pt, look?: string, speed = 90): Ent => ({ id, kind, name, look, x: p.x, y: p.y, tx: p.x, ty: p.y, speed, act: 'idle', until: now + 1500 });
  return { t: now, ents: [
    e('itops', 'itops', 'IT Ops', ITOPS_SPOT, 'nam_01', 90),
    e('npc-1', 'npc', 'Tèo', YARD[0], 'nam_04'), e('npc-2', 'npc', 'Tý', CAFE_SEATS[0], 'nu_04'), e('npc-3', 'npc', 'Bờm', TRADA_STOOLS[1], 'nam_06'), e('npc-4', 'npc', 'Mít', STREET[1], 'nu_07'),
    e('dog', 'dog', 'Chos An', YARD[1], undefined, 170), e('cat', 'cat', 'Meow', YARD[2], undefined, 130),
    // Layoff starts off-map (gone) and appears occasionally to hunt.
    { ...e('layoff', 'trex', 'Layoff', STREET[0], undefined, 140), act: 'gone', until: now + 18_000 },
  ] };
}
const arrived = (e: Ent) => Math.hypot(e.tx - e.x, e.ty - e.y) < 2;
const near = (a: Pt, b: Pt, d = 28) => Math.hypot(a.x - b.x, a.y - b.y) < d;
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
  const free = w.ents.filter((e) => e.kind === 'npc' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' && e.act !== 'romance' && e.act !== 'carried' && e.act !== 'chomp');
  if (free.length < 2) return w;
  const a = free[0], b = free[1], c = pick(ROMANCE_SPOTS, r), gap = 14;
  return { ...w, ents: w.ents.map((e) => {
    if (e.id === a.id) return say(go({ ...e, partner: b.id }, { x: c.x - gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
    if (e.id === b.id) return say(go({ ...e, partner: a.id }, { x: c.x + gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
    return e;
  }) };
}
/** Force a two-sided office-drama exchange at a spot (screenshots / vp-debug). */
export function forceDrama(w: World, now: number, kind: 'smoke' | 'gym' | 'atm' | 'print' | 'pod' | 'gate' = 'smoke', r: () => number = Math.random): World {
  const free = w.ents.filter((e) => e.kind === 'npc' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' && e.act !== 'carried' && e.act !== 'chomp');
  if (free.length < 2) return w;
  const a = free[0], b = free[1];
  const spots = kind === 'gym' ? GYM_SPOTS : kind === 'atm' ? ATM_SPOTS : kind === 'print' ? PRINT_SPOTS : kind === 'pod' ? POD_SPOTS : kind === 'gate' ? GATE_SPOTS : SMOKE_SPOTS;
  const topic: NonNullable<Ent['topic']> = kind === 'gym' ? 'gymArgue' : kind === 'atm' ? 'atmArgue' : kind === 'print' ? 'printArgue' : kind === 'pod' ? 'bossGossip' : kind === 'gate' ? 'deskWar' : 'bossGossip';
  const pair = pick(PAIRS[topic], r), c = pick(spots, r), gap = 16;
  return { ...w, ents: w.ents.map((e) => {
    if (e.id === a.id) return say(go({ ...e, partner: b.id, topic }, { x: c.x - gap, y: c.y }, kind, 110), pair[0], now, 7000);
    if (e.id === b.id) return say(go({ ...e, partner: a.id, topic }, { x: c.x + gap, y: c.y }, kind, 110), pair[1], now, 7000);
    return e;
  }) };
}
export function isUselessNpc(e: Ent): boolean {
  return e.kind === 'npc' && USELESS_ACTS.has(e.act);
}
function agentPartnerId(partner?: string): string | undefined {
  return partner?.startsWith('agent:') ? partner.slice(6) : undefined;
}
/** Force Layoff to hunt a useless NPC (or first NPC) and resolve eat-on-spot or pond drop. For screenshots / vp-debug. */
export function forceLayoff(w: World, now: number, outcome: 'eat' | 'pond' | 'hunt', r: () => number = Math.random): World {
  const layoff0 = w.ents.find((e) => e.kind === 'trex');
  const victims = w.ents.filter((e) => e.kind === 'npc' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' && e.act !== 'carried');
  const victim = victims.find(isUselessNpc) ?? victims[0];
  if (!layoff0 || !victim) return w;
  // Park the pair in a clear outdoor spot (yard south / pond edge) so screenshots can find them.
  const spot = outcome === 'pond' ? POND_EDGE[0] : YARD[0];
  const vx = spot.x, vy = spot.y, lx = vx + 26, ly = vy;
  let ents = w.ents.map((e) => {
    if (e.id === layoff0.id) {
      return say({ ...e, x: lx, y: ly, tx: vx, ty: vy, act: 'hunt', next: undefined, partner: victim.id, speed: 200, until: now + 8000 }, pick(LINES.layoffHunt, r), now, 5000);
    }
    if (e.id === victim.id) {
      return say({ ...e, x: vx, y: vy, tx: vx, ty: vy, act: 'idle', partner: layoff0.id, until: now + 8000, speed: 90 }, pick(LINES.victimPanic, r), now, 5000);
    }
    if (e.kind === 'npc' && e.id !== victim.id && !e.say && e.act !== 'gone' && e.act !== 'eaten') {
      return say(e, pick(LINES.layoffWitness, r), now, 5000);
    }
    return e;
  });
  if (outcome === 'hunt') return { ...w, ents, t: now };
  // Immediately resolve outcome next to the victim for reliable screenshots.
  return resolveLayoffCatch({ ...w, ents, t: now }, now, r, outcome);
}
function resolveLayoffCatch(w: World, now: number, r: () => number, forced?: 'eat' | 'pond'): World {
  const layoff = w.ents.find((e) => e.kind === 'trex' && (e.act === 'hunt' || e.act === 'walk'));
  if (!layoff?.partner) return w;
  const agentId = agentPartnerId(layoff.partner);
  const pond = forced === 'pond' || (forced !== 'eat' && r() < 0.5);
  if (agentId) {
    const nextLayoff = say({ ...layoff, act: pond ? 'carry' : 'chomp', tx: pond ? pondCenter().x : layoff.x, ty: pond ? pondCenter().y : layoff.y, until: now + (pond ? 9000 : 3200), partner: layoff.partner, speed: pond ? 160 : layoff.speed },
      pick(pond ? LINES.layoffThrow : LINES.layoffEat, r), now, pond ? 5000 : 3500);
    const ents = w.ents.map((e) => (e.id === layoff.id ? nextLayoff : e));
    if (!pond) {
      // Instant agent eat: emit event, Layoff cools down.
      return { ...w, ents: ents.map((e) => e.id === layoff.id ? { ...nextLayoff, act: 'idle' as const, partner: undefined, until: now + 25_000 + r() * 20_000 } : e), layoffEvent: { type: 'eat', agentId }, t: now };
    }
    return { ...w, ents, t: now };
  }
  const victim = w.ents.find((e) => e.id === layoff.partner);
  if (!victim || victim.act === 'eaten' || victim.act === 'gone' || victim.act === 'fall') return w;
  if (pond) {
    const L = say({ ...layoff, act: 'carry', tx: pondCenter().x, ty: pondCenter().y, until: now + 12_000, partner: victim.id, speed: 160 }, pick(LINES.layoffThrow, r), now, 5000);
    const V = say({ ...victim, act: 'carried', tx: layoff.x, ty: layoff.y, partner: layoff.id, until: now + 12_000, speed: 160 }, pick(LINES.victimPanic, r), now, 4500);
    return { ...w, ents: w.ents.map((e) => (e.id === L.id ? L : e.id === V.id ? V : e)), t: now };
  }
  const L = say({ ...layoff, act: 'chomp', tx: victim.x, ty: victim.y, until: now + 3200, partner: victim.id }, pick(LINES.layoffEat, r), now, 3500);
  const V = say({ ...victim, act: 'eaten', tx: victim.x, ty: victim.y, until: now + 2800, partner: undefined }, pick(LINES.victimPanic, r), now, 2800);
  return { ...w, ents: w.ents.map((e) => (e.id === L.id ? L : e.id === V.id ? V : e)), t: now };
}
function startHunt(layoff: Ent, target: { id: string; x: number; y: number; agent?: boolean }, now: number, r: () => number): Ent {
  const partner = target.agent ? `agent:${target.id}` : target.id;
  return say({ ...layoff, act: 'hunt', tx: target.x, ty: target.y, partner, speed: 180, until: now + 14_000 }, pick(LINES.layoffHunt, r), now, 5500);
}
function decide(e: Ent, w: World, now: number, r: () => number, prey: AgentPrey[]): Ent {
  switch (e.kind) {
    case 'npc': {
      if (e.act === 'carried') return e;
      const x = r();
      // Keep cafe <0.18 / beer <0.34 / massage <0.46 / bbq <0.58 so existing tests (0.3 beer, 0.45 massage, 0.50 bbq) still hit.
      if (x < 0.18) return say(go(e, jitter(pick(CAFE_SEATS, r), r), 'drink'), pick(LINES.coffee, r), now);
      if (x < 0.34) return say(go(e, jitter(pick(TRADA_STOOLS, r), r), 'beer'), pick(LINES.beer, r), now);
      if (x < 0.46) return say(go(e, jitter(pick(MASSAGE_BEDS, r), r, 6), 'massage'), pick(r() < 0.18 ? LINES.fakeSick : LINES.massageGo, r), now);
      if (x < 0.58) return say(go(e, jitter(pick(BBQ_SEATS, r), r, 8), 'bbq'), pick(r() < 0.18 ? LINES.fakeSick : LINES.bbqGo, r), now);
      if (x < 0.64) return say(go(e, jitter(pick(SMOKE_SPOTS, r), r, 8), 'smoke'), pick(LINES.smokeGo, r), now);
      if (x < 0.70) return say(go(e, jitter(pick(GYM_SPOTS, r), r, 8), 'gym'), pick(LINES.gymGo, r), now);
      if (x < 0.75) return say(go(e, jitter(pick(ATM_SPOTS, r), r, 6), 'atm'), pick(LINES.atmGo, r), now);
      if (x < 0.79) return say(go(e, jitter(pick(GATE_SPOTS, r), r, 6), 'gate'), pick(LINES.gateGo, r), now);
      if (x < 0.83) return say(go(e, jitter(pick(POD_SPOTS, r), r, 6), 'pod'), pick(LINES.podGo, r), now);
      if (x < 0.87) return say(go(e, jitter(pick(PRINT_SPOTS, r), r, 6), 'print'), pick(LINES.printGo, r), now);
      if (x < 0.92) return say(go(e, pick(STREET, r), 'idle', townRunSpeed()), pick(LINES.run, r), now);
      if (x < 0.96) { const o = pick(w.ents.filter((z) => z.kind === 'npc' && z.id !== e.id && z.act !== 'gone' && z.act !== 'carried'), r); return o ? go(e, jitter({ x: o.x + 28, y: o.y }, r, 6), 'chat') : e; }
      if (x < 0.98) return go(e, pick(POND_EDGE, r), r() < 0.35 ? 'fall' : 'idle');
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
    case 'trex': {
      if (e.act === 'gone') return e;
      const npcs = w.ents.filter(isUselessNpc);
      const agents = prey.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!npcs.length && !agents.length) return go(e, pick(STREET, r), 'idle', 120);
      // Prefer NPCs; occasionally an idle office agent.
      if (agents.length && (npcs.length === 0 || r() < 0.35)) {
        const a = pick(agents, r);
        return startHunt(e, { id: a.id, x: a.x, y: a.y, agent: true }, now, r);
      }
      const v = pick(npcs, r);
      return startHunt(e, { id: v.id, x: v.x, y: v.y }, now, r);
    }
    default: return { ...e, until: now + 6000 };
  }
}
function arrive(e: Ent, now: number, r: () => number): Ent {
  const n = e.next ?? 'idle';
  switch (n) {
    case 'drink': return say({ ...e, act: 'drink', until: now + 8000 + r() * 5000 }, pick(LINES.coffee, r), now);
    case 'beer': return say({ ...e, act: 'beer', until: now + 8000 + r() * 5000 }, pick(LINES.beer, r), now);
    case 'chat': return say({ ...e, act: 'chat', until: now + 7500 }, pick(r() < 0.15 ? LINES.gossipBoss : r() < 0.28 ? LINES.trollPR : r() < 0.4 ? LINES.ghostWork : r() < 0.5 ? LINES.remoteWar : LINES.chat, r), now, 7500);
    case 'massage': return say({ ...e, act: 'massage', until: now + 10000 + r() * 6000 }, pick(e.say && /ốm|nghỉ|sốt|cúm|leave/i.test(e.say) ? LINES.sickCaught : LINES.massageTalk, r), now, 6500);
    case 'bbq': return say({ ...e, act: 'bbq', until: now + 10000 + r() * 6000 }, pick(e.say && /ốm|nghỉ|sốt|cúm|leave/i.test(e.say) ? LINES.sickCaught : LINES.bbqTalk, r), now, 6500);
    case 'romance': return say({ ...e, act: 'romance', until: now + 14000 + r() * 6000 }, pick(LINES.romance, r), now, 7000);
    case 'smoke': return say({ ...e, act: 'smoke', until: now + 9000 + r() * 5000 }, pick(r() < 0.45 ? LINES.gossipBoss : LINES.smokeTalk, r), now, 6500);
    case 'gym': return say({ ...e, act: 'gym', until: now + 9000 + r() * 5000 }, pick(LINES.gymTalk, r), now, 6500);
    case 'atm': return say({ ...e, act: 'atm', until: now + 8000 + r() * 4000 }, pick(LINES.atmTalk, r), now, 6000);
    case 'gate': return say({ ...e, act: 'gate', until: now + 8000 + r() * 4000 }, pick(LINES.gateTalk, r), now, 6000);
    case 'pod': return say({ ...e, act: 'pod', until: now + 11000 + r() * 6000 }, pick(r() < 0.35 ? LINES.gossipBoss : LINES.podTalk, r), now, 6500);
    case 'print': return say({ ...e, act: 'print', until: now + 8000 + r() * 4000 }, pick(LINES.printTalk, r), now, 6000);
    case 'drama': return say({ ...e, act: 'drama', until: now + 10000 + r() * 5000 }, pick(LINES.gossipColleague, r), now, 6500);
    case 'fall': return say({ ...e, tx: pondCenter().x, ty: pondCenter().y, act: 'fall', speed: 300, until: now + 4000 }, pick(LINES.slipPond, r), now, 2800);
    case 'fight': return { ...e, act: 'fight', until: now + 5500 };
    default: return { ...e, act: 'idle', until: now + 3000 + r() * 5000, partner: undefined };
  }
}
/** Advance the world. itops: latest monitor status (undefined until the server sent one). prey: free office agents in plan px. */
export function step(w: World, now: number, r: () => number, itops?: ItOpsStatus, prey: AgentPrey[] = []): World {
  const dt = Math.min(1, Math.max(0, (now - w.t) / 1000));
  let reportedKey = w.reportedKey; const key = problemKey(itops);
  if (!key) reportedKey = undefined;
  let layoffEvent = w.layoffEvent;
  const dog0 = w.ents.find((z) => z.kind === 'dog');
  const layoff0 = w.ents.find((z) => z.kind === 'trex');
  // Chase: keep hunt / carry targets updated before movement.
  let ents = w.ents.map((e0) => {
    let e = e0;
    if (e.kind === 'cat' && e.act === 'walk' && e.next === 'fight' && dog0) e = { ...e, tx: dog0.x + 18, ty: dog0.y };
    if (e.kind === 'trex' && e.act === 'hunt' && e.partner) {
      const aid = agentPartnerId(e.partner);
      if (aid) {
        const p = prey.find((x) => x.id === aid);
        if (p) e = { ...e, tx: p.x, ty: p.y };
      } else {
        const v = w.ents.find((z) => z.id === e.partner);
        if (v && v.act !== 'gone' && v.act !== 'eaten' && v.act !== 'fall') e = { ...e, tx: v.x, ty: v.y };
      }
    }
    if (e.sayUntil && now > e.sayUntil) e = { ...e, say: undefined, sayUntil: undefined };
    if (e.act === 'walk' || e.act === 'fall' || e.act === 'report' || e.act === 'hunt' || e.act === 'carry') {
      const goal = (e.act === 'fall' || e.act === 'hunt' || e.act === 'carry') ? { x: e.tx, y: e.ty } : waypoint(e, { x: e.tx, y: e.ty });
      const dx = goal.x - e.x, dy = goal.y - e.y, d = Math.hypot(dx, dy), s = e.speed * dt;
      e = d <= s ? { ...e, x: goal.x, y: goal.y } : { ...e, x: e.x + (dx / d) * s, y: e.y + (dy / d) * s };
    }
    if (e.act === 'fall' && arrived(e)) return say({ ...e, act: 'eaten', until: now + 2800 }, pick(LINES.eaten, r), now, 2800);
    if (e.act === 'eaten' && now > e.until) return { ...e, act: 'gone', say: undefined, until: now + 15000, partner: undefined } as Ent;
    if (e.act === 'gone') {
      if (now <= e.until) return e;
      if (e.kind === 'trex') {
        const p = pick(STREET, r);
        return say({ ...e, x: p.x, y: p.y, tx: p.x, ty: p.y, act: 'idle', until: now + 2000 + r() * 3000, partner: undefined }, pick(LINES.layoffHunt, r), now, 5000);
      }
      const p = pick(STREET, r);
      return say({ ...e, x: p.x, y: p.y, tx: p.x, ty: p.y, act: 'idle', until: now + 3000 }, pick(LINES.back, r), now);
    }
    if (e.act === 'knocked') { if (now <= e.until) return e; return say({ ...e, act: 'idle', until: now + 1500 }, pick(LINES.back, r), now, 4000); }
    if (e.act === 'chomp') {
      if (now <= e.until) return e;
      return { ...e, act: 'idle' as const, partner: undefined, until: now + 25_000 + r() * 25_000, say: undefined };
    }
    if (e.act === 'massage' && now <= e.until && !e.say && r() < 0.025) return say(e, pick(LINES.massageTalk, r), now, 5500);
    if (e.act === 'bbq' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(LINES.bbqTalk, r), now, 5500);
    if (e.act === 'romance' && now <= e.until && !e.say && r() < 0.04) return say(e, pick(LINES.romance, r), now, 6500);
    if (e.act === 'smoke' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(r() < 0.5 ? LINES.gossipBoss : LINES.smokeTalk, r), now, 6000);
    if (e.act === 'gym' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(LINES.gymTalk, r), now, 5500);
    if (e.act === 'atm' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(LINES.atmTalk, r), now, 5500);
    if (e.act === 'gate' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(LINES.gateTalk, r), now, 5500);
    if (e.act === 'pod' && now <= e.until && !e.say && r() < 0.035) return say(e, pick(r() < 0.4 ? LINES.gossipBoss : LINES.podTalk, r), now, 6000);
    if (e.act === 'print' && now <= e.until && !e.say && r() < 0.03) return say(e, pick(LINES.printTalk, r), now, 5500);
    if (e.act === 'drama' && now <= e.until && !e.say && r() < 0.04) return say(e, pick(r() < 0.5 ? LINES.gossipCaught : LINES.gossipColleague, r), now, 6000);
    const lingerActs: Act[] = ['massage', 'bbq', 'romance', 'smoke', 'gym', 'atm', 'gate', 'pod', 'print', 'drama'];
    if (lingerActs.includes(e.act) && now > e.until) return { ...e, act: 'idle' as const, until: now + 3000, partner: undefined, topic: undefined, say: undefined };
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
    if (e.act !== 'walk' && e.act !== 'hunt' && e.act !== 'carry' && e.act !== 'carried' && now > e.until) return decide(e, w, now, r, prey);
    return e;
  });

  // Sync carried victims to Layoff's position; finish carry at the pond.
  const carrier = ents.find((e) => e.kind === 'trex' && e.act === 'carry');
  if (carrier) {
    const aid = agentPartnerId(carrier.partner);
    if (aid) {
      if (near(carrier, pondCenter(), 36)) {
        ents = ents.map((e) => (e.id === carrier.id ? { ...carrier, act: 'idle' as const, partner: undefined, until: now + 25_000 + r() * 20_000, say: undefined } : e));
        layoffEvent = { type: 'pond', agentId: aid };
      }
    } else if (carrier.partner) {
      ents = ents.map((e) => {
        if (e.id === carrier.partner && e.act === 'carried') {
          return { ...e, x: carrier.x - 18, y: carrier.y, tx: carrier.x - 18, ty: carrier.y };
        }
        return e;
      });
      if (near(carrier, pondCenter(), 36)) {
        const vid = carrier.partner;
        ents = ents.map((e) => {
          if (e.id === carrier.id) return say({ ...carrier, act: 'idle', partner: undefined, until: now + 25_000 + r() * 20_000 }, pick(LINES.layoffThrow, r), now, 4000);
          if (e.id === vid) return say({ ...e, act: 'fall', tx: pondCenter().x, ty: pondCenter().y, speed: 380, until: now + 4000, partner: undefined }, pick(LINES.thrown, r), now, 2800);
          return e;
        });
      }
    }
  }

  // Layoff catches up to prey while hunting.
  const hunter = ents.find((e) => e.kind === 'trex' && e.act === 'hunt' && e.partner);
  if (hunter) {
    const aid = agentPartnerId(hunter.partner);
    const atPrey = aid
      ? (() => { const p = prey.find((x) => x.id === aid); return p && near(hunter, p, 32); })()
      : (() => { const v = ents.find((z) => z.id === hunter.partner); return v && near(hunter, v, 32); })();
    if (atPrey || (now > hunter.until)) {
      const caught = resolveLayoffCatch({ ...w, ents, t: now }, now, r);
      ents = caught.ents;
      if (caught.layoffEvent) layoffEvent = caught.layoffEvent;
    } else {
      // Victim panic while being chased.
      ents = ents.map((e) => {
        if (e.id === hunter.partner && !e.say && e.act !== 'gone' && e.act !== 'eaten') return say(e, pick(LINES.victimPanic, r), now, 4000);
        return e;
      });
    }
  }

  // Rare secret garden affair: two free idle NPCs sneak off together.
  let free = ents.filter((e) => e.kind === 'npc' && e.act === 'idle' && !e.partner && now > e.until - 50);
  if (free.length >= 2 && r() < 0.01) {
    const a = free[0], b = free[1], c = pick(ROMANCE_SPOTS, r), gap = 14;
    ents = ents.map((e) => {
      if (e.id === a.id) return say(go({ ...e, partner: b.id }, { x: c.x - gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
      if (e.id === b.id) return say(go({ ...e, partner: a.id }, { x: c.x + gap, y: c.y }, 'romance', 110), pick(LINES.romance, r), now, 7000);
      return e;
    });
  }
  // Occasional office-drama pair walk to an amenity and argue / gossip (paced bubbles).
  free = ents.filter((e) => e.kind === 'npc' && e.act === 'idle' && !e.partner && now > e.until - 50);
  if (free.length >= 2 && r() < 0.012) {
    const kinds = ['smoke', 'gym', 'atm', 'print', 'pod', 'gate'] as const;
    const kind = pick(kinds, r);
    const topic: NonNullable<Ent['topic']> = kind === 'gym' ? 'gymArgue' : kind === 'atm' ? 'atmArgue' : kind === 'print' ? 'printArgue' : kind === 'gate' ? 'deskWar' : r() < 0.5 ? 'bossGossip' : 'trollReview';
    const spots = kind === 'gym' ? GYM_SPOTS : kind === 'atm' ? ATM_SPOTS : kind === 'print' ? PRINT_SPOTS : kind === 'pod' ? POD_SPOTS : kind === 'gate' ? GATE_SPOTS : SMOKE_SPOTS;
    const a = free[0], b = free[1], c = pick(spots, r), gap = 16, pair = pick(PAIRS[topic], r);
    ents = ents.map((e) => {
      if (e.id === a.id) return say(go({ ...e, partner: b.id, topic }, { x: c.x - gap, y: c.y }, kind, 110), pair[0], now, 7000);
      if (e.id === b.id) return say(go({ ...e, partner: a.id, topic }, { x: c.x + gap, y: c.y }, kind, 110), pair[1], now, 7000);
      return e;
    });
  }
  // Pair at smoke/trada/garden sometimes continues gossip / gets caught.
  ents = ents.map((e) => {
    if ((e.act === 'smoke' || e.act === 'beer' || e.act === 'pod') && e.partner && !e.say && r() < 0.02) {
      return say(e, pick(r() < 0.35 ? LINES.gossipCaught : r() < 0.6 ? LINES.gossipBoss : LINES.gossipColleague, r), now, 6500);
    }
    if (e.act === 'gym' && e.partner && !e.say && r() < 0.025) {
      const pair = pick(PAIRS.gymArgue, r); return say(e, e.partner < e.id ? pair[1] : pair[0], now, 6000);
    }
    return e;
  });
  const cat = ents.find((e) => e.kind === 'cat');
  if (cat?.act === 'fight') ents = ents.map((e) => (e.kind === 'dog' && e.act !== 'fight' && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'fall' ? say({ ...e, act: 'fight', tx: e.x, ty: e.y, until: cat.until }, pick(LINES.dogFight, r), now, 5000) : e));
  const dog = ents.find((e) => e.kind === 'dog');
  if (dog?.act === 'bark' && dog.sayUntil && dog.sayUntil - now > 3500) { const n = ents.find((e) => e.kind === 'npc' && !e.say && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'romance' && e.act !== 'carried'); if (n) ents = ents.map((e) => (e === n ? say(e, pick(LINES.dogReact, r), now, 5000) : e)); }

  // Occasional bystander line when Layoff is actively hunting/carrying/chomping.
  if (layoff0 && r() < 0.02) {
    const L = ents.find((e) => e.kind === 'trex');
    if (L && (L.act === 'hunt' || L.act === 'carry' || L.act === 'chomp')) {
      const n = ents.find((e) => e.kind === 'npc' && !e.say && e.act !== 'gone' && e.act !== 'eaten' && e.act !== 'carried' && e.id !== L.partner);
      if (n) ents = ents.map((e) => (e.id === n.id ? say(e, pick(r() < 0.45 ? LINES.rumorLayoff : LINES.layoffWitness, r), now, 4500) : e));
    }
  }

  return { ents, reportedKey, t: now, layoffEvent };
}
