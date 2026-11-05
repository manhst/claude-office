// Main-road traffic (front street): vehicles drive by, sometimes knock a pedestrian over, rear-end each other (drivers get out
// and argue), or catch fire and explode; fire trucks and police come to incidents, wrecks are cleared after a while.
// Pure step function over plan px, rnd injected; comedic only.
import { LINES, PAIRS } from './dialogue';
import { LANES, TOWN, type Pt } from './map';
import { pick } from './sim';

export type VType =
  | 'xe-may' | 'xe-dap' | 'xe-om' | 'oto-con' | 'taxi' | 'ban-tai' | 'xe-buyt' | 'oto-tai' | 'container' | 'tron-be-tong' | 'xe-rac'
  | 'xe-cau' | 'xe-lu' | 'may-xuc' | 'may-ui' | 'xe-tang' | 'ba-gac' | 'cuu-thuong' | 'cuu-hoa' | 'canh-sat' | 'kiem-tra' | 'xe-kem';
export const VEHICLES: Record<VType, { name: string; len: number; speed: number }> = {
  'xe-may': { name: 'Xe máy', len: 34, speed: 230 }, 'xe-dap': { name: 'Xe đạp', len: 30, speed: 95 }, 'xe-om': { name: 'Xe ôm Grab', len: 34, speed: 210 },
  'oto-con': { name: 'Ô tô con', len: 70, speed: 240 }, taxi: { name: 'Taxi', len: 70, speed: 250 }, 'ban-tai': { name: 'Xe bán tải', len: 80, speed: 220 },
  'xe-buyt': { name: 'Xe buýt', len: 150, speed: 150 }, 'oto-tai': { name: 'Ô tô tải', len: 120, speed: 160 }, container: { name: 'Xe container', len: 180, speed: 140 },
  'tron-be-tong': { name: 'Xe trộn bê tông', len: 120, speed: 120 }, 'xe-rac': { name: 'Xe rác', len: 110, speed: 110 }, 'xe-cau': { name: 'Xe cẩu', len: 140, speed: 110 },
  'xe-lu': { name: 'Xe lu', len: 80, speed: 45 }, 'may-xuc': { name: 'Máy xúc', len: 100, speed: 60 }, 'may-ui': { name: 'Máy ủi', len: 90, speed: 60 },
  'xe-tang': { name: 'Xe tăng', len: 120, speed: 90 }, 'ba-gac': { name: 'Xe ba gác', len: 60, speed: 100 }, 'cuu-thuong': { name: 'Xe cứu thương', len: 90, speed: 280 },
  'cuu-hoa': { name: 'Xe cứu hỏa', len: 130, speed: 260 }, 'canh-sat': { name: 'Xe cảnh sát', len: 75, speed: 270 }, 'kiem-tra': { name: 'Xe kiểm tra đường', len: 75, speed: 130 },
  'xe-kem': { name: 'Xe bán kem', len: 70, speed: 90 },
};
/** Random traffic mix (service vehicles mostly arrive on call, but drive by now and then too). */
const MIX: VType[] = ['xe-may', 'xe-may', 'xe-may', 'xe-om', 'xe-om', 'xe-dap', 'oto-con', 'oto-con', 'taxi', 'ban-tai', 'xe-buyt', 'oto-tai', 'container', 'tron-be-tong', 'xe-rac', 'xe-cau', 'xe-lu', 'may-xuc', 'may-ui', 'xe-tang', 'ba-gac', 'ba-gac', 'cuu-thuong', 'canh-sat', 'kiem-tra', 'xe-kem'];
export type VState = 'drive' | 'argue' | 'fire' | 'boom' | 'wreck' | 'parked';
export interface Vehicle {
  id: number; type: VType; lane: 0 | 1; x: number; y: number; speed: number; state: VState; until: number;
  say?: string; sayUntil?: number; /** crash partner (both drivers argue in turns) */ other?: number; turn?: number; /** responding to this incident x */ target?: number; hitCd?: number;
}
export interface Traffic { vs: Vehicle[]; nextId: number; nextSpawn: number; t: number }
/** Max vehicles on the road at once (responders get +2 headroom). */
export const CAP = 5;
export const ARGUE_MS = 2200;
export const P = { hit: 0.5, crash: 0.35, fireAfterCrash: 0.4, randomFire: 0.0006, fireMs: 7000, boomMs: 1400, wreckMs: 9000, argueMs: 11000 };

export const initialTraffic = (now: number): Traffic => ({ vs: [], nextId: 1, nextSpawn: now + 1500, t: now });
const front = (v: Vehicle) => v.x + (LANES[v.lane].dir * VEHICLES[v.type].len) / 2;
const say = (v: Vehicle, s: string, now: number, ms = 3000): Vehicle => ({ ...v, say: s, sayUntil: now + ms });
function spawn(t: Traffic, type: VType, lane: 0 | 1, now: number, target?: number): Traffic {
  const L = LANES[lane], len = VEHICLES[type].len, x = L.dir > 0 ? -len : TOWN.w + len;
  const v: Vehicle = { id: t.nextId, type, lane, x, y: L.y, speed: VEHICLES[type].speed, state: 'drive', until: 0, target };
  return { ...t, vs: [...t.vs, v], nextId: t.nextId + 1 };
}
/** Manually trigger incidents (screenshots / tests). */
export function forceCrash(t: Traffic, now: number, x = 700, types: [VType, VType] = ['oto-con', 'xe-tang']): Traffic {
  const a: Vehicle = { id: t.nextId, type: types[0], lane: 0, x, y: LANES[0].y, speed: 0, state: 'argue', until: now + P.argueMs, other: t.nextId + 1, turn: 0 };
  const b: Vehicle = { ...a, id: t.nextId + 1, type: types[1], x: x - (VEHICLES[types[0]].len + VEHICLES[types[1]].len) / 2 - 4, other: t.nextId, turn: 0 };
  return { ...t, vs: [...t.vs, a, b], nextId: t.nextId + 2 };
}
export function forceFire(t: Traffic, now: number, x = 1000, type: VType = 'oto-tai'): Traffic {
  const v: Vehicle = { id: t.nextId, type, lane: 1, x, y: LANES[1].y, speed: 0, state: 'fire', until: now + P.fireMs };
  return { ...t, vs: [...t.vs, say(v, LINES.fire[0], now)], nextId: t.nextId + 1 };
}
export interface StepOut { traffic: Traffic; /** pedestrians knocked over this step */ hits: string[] }
/** Advance traffic. peds: walking entities (plan px) that can be hit while on the road. */
export function stepTraffic(t0: Traffic, now: number, r: () => number, peds: { id: string; x: number; y: number }[] = []): StepOut {
  const dt = Math.min(1, Math.max(0, (now - t0.t) / 1000));
  let t: Traffic = { ...t0, t: now };
  const hits: string[] = [];
  const calls: { type: VType; x: number }[] = [];
  let vs = t.vs.map((v) => (v.sayUntil && now > v.sayUntil ? { ...v, say: undefined, sayUntil: undefined } : v));
  // crashes: arguing pairs alternate lines; incidents burn, explode, become wrecks, get cleared.
  vs = vs.map((v) => {
    if (v.state === 'argue') {
      const turn = Math.floor((P.argueMs - (v.until - now)) / ARGUE_MS);
      if (v.other !== undefined && turn !== v.turn) {
        const pair = PAIRS.crashArgue[(Math.min(v.id, v.other) + Math.floor(turn / 2)) % PAIRS.crashArgue.length];
        const first = v.id < v.other; const speaking = (turn % 2 === 0) === first;
        v = speaking ? say({ ...v, turn }, pair[turn % 2], now, ARGUE_MS) : { ...v, turn };
      }
      if (now > v.until) return { ...v, state: 'drive' as const, speed: VEHICLES[v.type].speed, other: undefined, say: undefined };
    }
    if (v.state === 'fire' && now > v.until) return say({ ...v, state: 'boom' as const, until: now + P.boomMs }, pick(LINES.boom, r), now, 3500);
    if (v.state === 'boom' && now > v.until) return { ...v, state: 'wreck' as const, until: now + P.wreckMs };
    if (v.state === 'parked' && now > v.until) return { ...v, state: 'drive' as const, speed: VEHICLES[v.type].speed, target: undefined };
    return v;
  }).filter((v) => !(v.state === 'wreck' && now > v.until));
  // after a crash: sometimes one car catches fire; spontaneous fires are rare.
  vs = vs.map((v) => {
    if (v.state === 'argue' && v.other !== undefined && v.id < v.other && v.turn === 3 && !v.hitCd && r() < P.fireAfterCrash) { calls.push({ type: 'cuu-hoa', x: v.x }); return say({ ...v, state: 'fire' as const, until: now + P.fireMs, hitCd: 1 }, pick(LINES.fire, r), now); }
    if (v.state === 'drive' && v.x > 300 && v.x < 1300 && r() < P.randomFire * dt * 5) { calls.push({ type: 'cuu-hoa', x: v.x }); return say({ ...v, state: 'fire' as const, speed: 0, until: now + P.fireMs }, pick(LINES.fire, r), now); }
    return v;
  });
  // the partner of a burning car stops arguing
  const burning = new Set(vs.filter((v) => v.state !== 'drive' && v.state !== 'argue' && v.state !== 'parked').map((v) => v.id));
  vs = vs.map((v) => (v.state === 'argue' && v.other !== undefined && burning.has(v.other) ? say({ ...v, until: now + 1500 }, pick(LINES.fire, r), now) : v));
  // driving: keep distance, rear-end sometimes, respond to calls, hit pedestrians sometimes
  vs = vs.map((v) => {
    if (v.state !== 'drive') return v;
    const dir = LANES[v.lane].dir, len = VEHICLES[v.type].len;
    const ahead = vs.filter((o) => o.id !== v.id && o.lane === v.lane && (o.x - v.x) * dir > 0).sort((a, b) => Math.abs(a.x - v.x) - Math.abs(b.x - v.x))[0];
    let nx = v.x + dir * v.speed * dt;
    if (v.target !== undefined && (v.target - nx) * dir < len) { return say({ ...v, x: v.target - dir * len, state: 'parked' as const, until: now + 9000 }, pick(v.type === 'cuu-hoa' ? LINES.fireCrew : LINES.police, r), now, 5000); }
    if (ahead) {
      const gap = (ahead.x - dir * VEHICLES[ahead.type].len / 2 - (nx + dir * len / 2)) * dir;
      if (gap < 6) {
        if (ahead.state === 'drive' && v.speed > ahead.speed && !v.hitCd && r() < P.crash) { // rear-end: both stop and argue
          calls.push({ type: 'canh-sat', x: ahead.x });
          return { ...v, x: ahead.x - dir * (VEHICLES[ahead.type].len + len) / 2 - dir * 2, speed: 0, state: 'argue' as const, until: now + P.argueMs, other: ahead.id, turn: -1, crashWith: ahead.id } as Vehicle;
        }
        nx = ahead.x - dir * (VEHICLES[ahead.type].len + len) / 2 - dir * 8; // queue
        const stuck = ahead.state !== 'drive';
        return stuck && !v.say && r() < 0.05 ? say({ ...v, x: Math.abs(nx - v.x) < v.speed * dt ? nx : v.x }, pick(LINES.honk, r), now, 2000) : { ...v, x: (nx - v.x) * dir > 0 ? nx : v.x, speed: stuck ? v.speed : Math.min(v.speed, ahead.speed), hitCd: 1 };
      }
    }
    return { ...v, x: nx };
  });
  // the car that got rear-ended joins the argument
  const rear = new Map<number, number>(); for (const v of vs) if ((v as Vehicle & { crashWith?: number }).crashWith) rear.set((v as Vehicle & { crashWith?: number }).crashWith!, v.id);
  vs = vs.map((v) => { const o = rear.get(v.id); const { crashWith: _, ...rest } = v as Vehicle & { crashWith?: number }; void _; return o !== undefined && v.state === 'drive' ? { ...rest, speed: 0, state: 'argue' as const, until: now + P.argueMs, other: o, turn: -1 } : rest; });
  // pedestrians on the road get knocked over (once per vehicle)
  for (const v of vs) {
    if (v.state !== 'drive' || v.speed < 40 || v.hitCd === 2) continue;
    const p = peds.find((q) => Math.abs(q.y - v.y) < 18 && Math.abs(q.x - front(v)) < 14 && !hits.includes(q.id));
    if (p && r() < P.hit) { hits.push(p.id); vs = vs.map((o) => (o.id === v.id ? say({ ...o, hitCd: 2 }, pick(LINES.hitDriver, r), now) : o)); }
  }
  vs = vs.filter((v) => v.x > -260 && v.x < TOWN.w + 260);
  t = { ...t, vs };
  for (const c of calls) {
    if (t.vs.filter((v) => v.type === c.type && v.target !== undefined).length) continue;
    const lane: 0 | 1 = c.x < TOWN.w / 2 ? 1 : 0; t = spawn(t, c.type, lane, now, c.x);
  }
  if (now >= t.nextSpawn) {
    const lane: 0 | 1 = r() < 0.5 ? 0 : 1, L = LANES[lane];
    const entryFree = !t.vs.some((v) => v.lane === lane && Math.abs(v.x - (L.dir > 0 ? 0 : TOWN.w)) < 220);
    if (t.vs.length < CAP && entryFree) t = spawn(t, pick(MIX, r), lane, now);
    t = { ...t, nextSpawn: now + 2200 + r() * 4500 };
  }
  return { traffic: t, hits };
}
export const onRoad = (p: Pt) => p.y > 760 && p.y < 830;
