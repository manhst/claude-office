// Adapter (our code): maps OUR reducer state onto the display states used by the Vanphong visuals. Pure, unit-tested.
import { LINES, PAIRS } from '../town/dialogue';
import { ATM_SPOTS, BBQ_SEATS, BIA_SEATS, GATE_SPOTS, GYM_SPOTS, MASSAGE_BEDS, POD_SPOTS, PRINT_SPOTS, ROMANCE_SPOTS, SMOKE_SPOTS, toWorld } from '../town/map';
import type { AgentUI, MessageUI, OfficeState } from '../reducer';
import { BUBBLE_MS, DESK_COLS, add, allDesks, DOOR, type Vec3 } from '../layout';
import { BODY_R, BOUNDS, DESK_HALF, findPath, visiting, type Goal, type Rect } from '../walk';
import { MAU_SAN, type NgoaiHinh } from './characters';
import { currentLook } from '../town/looks';
import { MAU_SAN as PRESETS } from './nhanVat';

/** Reference status keys (CSS classes tt-*): ranh idle, dang-nghi thinking, dang-lam working, dang-nghe talking, xong done, loi error. */
export type VpStatus = 'ranh' | 'dang-nghi' | 'dang-lam' | 'dang-nghe' | 'xong' | 'loi';
const STATUS: Record<AgentUI['state'], VpStatus> = { idle: 'ranh', thinking: 'dang-nghi', working: 'dang-lam', talking: 'dang-nghe', done: 'xong', error: 'loi' };
export const vpStatus = (s: AgentUI['state']): VpStatus => STATUS[s] ?? 'ranh';
export const STATUS_LABEL: Record<VpStatus, string> = { ranh: 'idle', 'dang-nghi': 'thinking', 'dang-lam': 'working', 'dang-nghe': 'talking', xong: 'done', loi: 'error' };

/** Role → one of the reference's presets; unknown roles get a stable pick by name hash. */
const ROLE_LOOK: Record<string, string> = { researcher: 'nu_01', coder: 'nam_01', reviewer: 'nu_05', writer: 'nu_03', planner: 'nam_02', tester: 'nu_04' };
const POOL = ['nam_04', 'nu_03', 'nam_07', 'nu_04', 'nam_02', 'nu_01'];
export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function lookFor(a: Pick<AgentUI, 'role' | 'id'> & { name?: string }): NgoaiHinh { const c = a.name ? currentLook(`agent:${a.name}`) : undefined; const p = c ? (PRESETS as { id: string; ngoai_hinh: NgoaiHinh }[]).find((x) => x.id === c) : undefined; if (p) return p.ngoai_hinh; return MAU_SAN[ROLE_LOOK[a.role.toLowerCase()] ?? POOL[hash(a.id) % POOL.length]]; }
/** Room tint per desk row, from the reference's room palette default. */
export const ROOM_COLOR = '#7b6cf6';

export interface BubbleView { text: string; show: boolean; dots: boolean }
/** What the speech bubble says. Done → result, error → error, otherwise the latest text while fresh (or while talking).
 *  thinking/working with nothing to say yet → an empty bubble with the reference's animated dots. Plain text only (rendered via textContent). */
export function bubbleFor(a: AgentUI, now: number): BubbleView {
  if (a.state === 'done') return { text: a.result ?? 'Done', show: true, dots: false };
  if (a.state === 'error') return { text: a.error ?? 'Error', show: true, dots: false };
  const fresh = !!a.text && !!a.textTs && (now - a.textTs < BUBBLE_MS || a.state === 'talking');
  if (fresh) return { text: a.text!, show: true, dots: a.state === 'thinking' };
  if (a.state === 'thinking' || a.state === 'working') return { text: a.tool ? a.tool.summary : '', show: true, dots: true };
  return { text: '', show: false, dots: false };
}
/** Short status under the name (no role / tool — labels stay small). Idle & done stay blank. */
export function subtitleFor(a: AgentUI): string {
  if (a.state === 'idle' || a.state === 'done') return '';
  return STATUS_LABEL[vpStatus(a.state)];
}

// ---- Layout: the reference seats people facing +z (toward the camera) behind their desk; desks stay on our grid. ----
/** Vanphong spaces the desk grid wider than our 3D view (layout.ts DESK_SPACING) so the work room breathes. */
export const VP_SPACING = { x: 4.7, z: 4.6 };
export const vpDesk = (d: { x: number; y: number }): Vec3 => [(d.x - (DESK_COLS - 1) / 2) * VP_SPACING.x, 0, (d.y - 0.5) * VP_SPACING.z];
export const CHAIR_BACK = 0.62; // their choNgoi: chair at origin, desk centre at +0.62 z
/** Seated position (chair) for a desk; the person faces +z. */
export const vpChair = (desk: { x: number; y: number }): Vec3 => add(vpDesk(desk), [0, 0, -CHAIR_BACK]);
/** Where a walker stops at home: just behind the chair, outside the desk obstacle. */
export const vpHome = (desk: { x: number; y: number }): Vec3 => add(vpDesk(desk), [0, 0, -1.05]);
/** Visitor spot: behind and to the right of the host's chair, looking over the shoulder (reference's help-desk "diem"). */
export const vpVisit = (desk: { x: number; y: number }): Vec3 => add(vpDesk(desk), [0.7, 0, -1.2]);

/** Glass room around the desks with a door gap in the back wall (towards our DOOR). */
export const ROOM = { x0: -7, x1: 7, z0: -4.9, z1: 4.1, door: 1.6 };
export function roomWalls(): Rect[] {
  const t = 0.05 + BODY_R, { x0, x1, z0, z1, door } = ROOM;
  return [
    { x0: x0 - t, x1: -door / 2 + t, z0: z0 - t, z1: z0 + t }, { x0: door / 2 - t, x1: x1 + t, z0: z0 - t, z1: z0 + t },
    { x0: x0 - t, x1: x0 + t, z0: z0 - t, z1: z1 + t }, { x0: x1 - t, x1: x1 + t, z0: z0 - t, z1: z1 + t },
    { x0: x0 - t, x1: x1 + t, z0: z1 - t, z1: z1 + t },
  ];
}
/** Desk footprints at the Vanphong spacing, inflated like walk.ts obstacles(). */
export const vpDeskRects = (): Rect[] => allDesks().map(vpDesk).map(([x, , z]) =>
  ({ x0: x - DESK_HALF.x - BODY_R, x1: x + DESK_HALF.x + BODY_R, z0: z - DESK_HALF.z - BODY_R, z1: z + DESK_HALF.z + BODY_R }));

// ---- Our additions: a pantry (left) and a game room (right) around the work room, and what free agents do there. ----
/** Building floor drawn by the scene; walkers plan inside VP_BOUNDS (grid-aligned so x = 0, the door gap, is a cell). */
export const BIEN = { x0: -12.8, x1: 12.8, z0: -8.4, z1: 7.6 };
/** Walk grid covers the office floor, north strip (Xuka / garden / Xém Nướng), and south yard amenities (gym / pod / gate / ATM); print is inside at the back wall. */
export const VP_BOUNDS: Rect = { x0: -20.5, x1: 21.5, z0: -18.5, z1: 13.5 };
export const PANTRY_X1 = -8, GAME_X0 = 8;
/** Furniture footprints (centre + half extents, x/z). The scene builds each piece here; walkers path around them. */
export interface Item { x: number; z: number; hx: number; hz: number }
export const FURNITURE = {
  fridge: { x: -12.2, z: -7.95, hx: 0.4, hz: 0.35 }, counter: { x: -9.9, z: -8.07, hx: 1.7, hz: 0.33 }, cooler: { x: -12.35, z: -4.4, hx: 0.22, hz: 0.22 },
  table1: { x: -10.3, z: -4.6, hx: 1, hz: 1 }, table2: { x: -10.3, z: -0.4, hx: 1, hz: 1 }, shelf: { x: -12.5, z: 3.6, hx: 0.25, hz: 0.9 },
  pool: { x: 10.4, z: -2.2, hx: 0.85, hz: 1.45 }, sofa: { x: 10.4, z: 4.4, hx: 1.25, hz: 0.45 }, coffeeTable: { x: 10.4, z: 3, hx: 0.6, hz: 0.3 },
  arcade: { x: 12.15, z: -7.85, hx: 0.35, hz: 0.3 },
  printer: { x: 4.6, z: -7.95, hx: 1.1, hz: 0.38 },
} satisfies Record<string, Item>;
export const COFFEE_MACHINE: Vec3 = [-8.7, 0, -8.1];
const furnitureRects = (): Rect[] => Object.values(FURNITURE).map((f) => ({ x0: f.x - f.hx - BODY_R, x1: f.x + f.hx + BODY_R, z0: f.z - f.hz - BODY_R, z1: f.z + f.hz + BODY_R }));
/** Outer walls of the office floor (door gap at DOOR on the back; glass entrance gap on the road-facing front). */
export function outerWalls(): Rect[] {
  const t = 0.12 + BODY_R, { x0, x1, z0, z1 } = BIEN, door = 1.8, dx = DOOR[0], frontDoor = 2.4, cx = (x0 + x1) / 2;
  return [
    { x0: x0 - t, x1: dx - door / 2, z0: z0 - t, z1: z0 + t },
    { x0: dx + door / 2, x1: x1 + t, z0: z0 - t, z1: z0 + t },
    { x0: x0 - t, x1: x0 + t, z0: z0 - t, z1: z1 + t },
    { x0: x1 - t, x1: x1 + t, z0: z0 - t, z1: z1 + t },
    { x0: x0 - t, x1: cx - frontDoor / 2, z0: z1 - t, z1: z1 + t },
    { x0: cx + frontDoor / 2, x1: x1 + t, z0: z1 - t, z1: z1 + t },
  ];
}
export const vpObstacles = (): Rect[] => [...vpDeskRects(), ...roomWalls(), ...furnitureRects(), ...outerWalls()];
let OBS: Rect[] | undefined;
export const vpPlan = (a: Vec3, b: Vec3) => findPath(a, b, (OBS ??= vpObstacles()), 0.25, VP_BOUNDS);
export { BOUNDS, DOOR };

/** Heading (walker convention: atan2(dx, dz)) from `p` towards `q`. */
export const faceTo = (p: Vec3, q: Vec3) => Math.atan2(q[0] - p[0], q[2] - p[2]);
interface Spot { to: Vec3; face: number }
const spot = (x: number, z: number, look: Vec3): Spot => ({ to: [x, 0, z], face: faceTo([x, 0, z], look) });
const POOL_TABLE: Vec3 = [FURNITURE.pool.x, 0, FURNITURE.pool.z];
export const COFFEE_SPOTS: Spot[] = [spot(-8.7, -7.1, COFFEE_MACHINE), spot(-9.65, -6.85, COFFEE_MACHINE), spot(-7.75, -6.85, COFFEE_MACHINE)];
export const POOL_SPOTS: Spot[] = [spot(9.05, -2.6, POOL_TABLE), spot(11.75, -1.8, POOL_TABLE), spot(10.4, -4.15, POOL_TABLE), spot(10.4, -0.25, POOL_TABLE)];
/** Where a pair meets: they stand either side of the point, facing each other. */
export const CHAT_SPOTS: Vec3[] = [[-10.3, 0, 1.7], [-4.4, 0, -6.5], [10.4, 0, 1.3], [-10.3, 0, -2.5]];
export const FIGHT_SPOTS: Vec3[] = [[10.4, 0, -5.6], [-10.3, 0, 2.9], [4.4, 0, -6.5]];
/** Half the gap between a pair (they stand at centre ± this on x). */
export const PAIR_GAP = { chat: 0.5, fight: 0.38, romance: 0.28 };
/** Xuka Mát xa beds (plan → world); agents lie here facing the street. */
export const MASSAGE_SPOTS: Spot[] = MASSAGE_BEDS.map((p) => { const [x, z] = toWorld(p); return { to: [x, 0, z] as Vec3, face: 0 }; });
/** Xém Nướng seats (plan → world); agents sit/eat BBQ and croc hotpot. */
export const BBQ_SPOTS: Spot[] = BBQ_SEATS.map((p) => { const [x, z] = toWorld(p); return { to: [x, 0, z] as Vec3, face: Math.PI }; });
export const BIA_AGENT_SPOTS: Spot[] = BIA_SEATS.map((p) => { const [x, z] = toWorld(p); return { to: [x, 0, z] as Vec3, face: Math.PI }; });
/** Garden affair meet points (plan → world). */
export const ROMANCE_CENTERS: Vec3[] = ROMANCE_SPOTS.map((p) => { const [x, z] = toWorld(p); return [x, 0, z] as Vec3; });
const amenitySpot = (p: { x: number; y: number }): Spot => { const [x, z] = toWorld(p); return { to: [x, 0, z] as Vec3, face: Math.PI }; };
export const SMOKE_AGENT_SPOTS: Spot[] = SMOKE_SPOTS.map(amenitySpot);
export const GYM_AGENT_SPOTS: Spot[] = GYM_SPOTS.map(amenitySpot);
export const ATM_AGENT_SPOTS: Spot[] = ATM_SPOTS.map(amenitySpot);
export const GATE_AGENT_SPOTS: Spot[] = GATE_SPOTS.map(amenitySpot);
export const POD_AGENT_SPOTS: Spot[] = POD_SPOTS.map(amenitySpot);
export const PRINT_AGENT_SPOTS: Spot[] = PRINT_SPOTS.map((p) => { const [x, z] = toWorld(p); return { to: [x, 0, z] as Vec3, face: faceTo([x, 0, z], [FURNITURE.printer.x, 0, z]) }; });
/** Outdoor amenity meet centers for gossip / drama pairs. */
export const DRAMA_CENTERS: Vec3[] = [...SMOKE_SPOTS, ...POD_SPOTS].map((p) => { const [x, z] = toWorld(p); return [x, 0, z] as Vec3; });

export type IdleKind = 'coffee' | 'pool' | 'chat' | 'fight' | 'massage' | 'bbq' | 'romance' | 'smoke' | 'gym' | 'atm' | 'gate' | 'pod' | 'print' | 'bia';
export interface IdlePlan { kind: IdleKind; key: string; to: Vec3; face: number; partner?: string; first?: boolean }
/** Free agents pick a new activity every slot. Longer slots = fewer chatter bursts. */
export const IDLE_SLOT_MS = 36_000;
/** Only agents free this long leave their desk, so a session flipping between thinking and tools doesn't send people pacing. */
export const IDLE_AFTER_MS = 12_000;
export const isFree = (a: AgentUI) => a.state === 'idle' || a.state === 'done';
/** What each free agent does this slot: stay at the desk (no entry), coffee, billiards, Xuka Mát xa, or meet a free colleague to chat / fight.
 *  freeSince[id] = when the agent last became free (the scene tracks it); without it every free agent counts. Eligibility is fixed at the
 *  slot start (free since slotStart - IDLE_AFTER_MS), so only agents leaving reshuffle a slot; every key names its spot, so a reshuffle replans. */
export function idlePlans(agents: Record<string, AgentUI>, order: string[], messages: MessageUI[], now: number, freeSince?: Record<string, number>): Record<string, IdlePlan> {
  const slot = Math.floor(now / IDLE_SLOT_MS), cut = slot * IDLE_SLOT_MS - IDLE_AFTER_MS, out: Record<string, IdlePlan> = {};
  const hosts = new Set(order.map((x) => agents[x] && visiting(agents[x], agents, messages)).filter(Boolean)); // someone is at their desk
  const ids = order.filter((id) => agents[id] && isFree(agents[id]) && !visiting(agents[id], agents, messages) && !hosts.has(id) && (!freeSince || (freeSince[id] ?? Infinity) <= cut))
    .sort((x, y) => hash(`${x}:${slot}`) - hash(`${y}:${slot}`));
  const taken = new Set<string>(); let coffee = 0, pool = 0, massage = 0, bbq = 0, bia = 0, smoke = 0, gym = 0, atm = 0, gate = 0, pod = 0, print = 0, pairs = 0;
  for (const id of ids) {
    if (taken.has(id)) continue; taken.add(id);
    const r = hash(`${slot}:${id}`) % 100;
    if (r < 22) continue; // stays at the desk (more quiet time)
    if (r < 32) { if (coffee < COFFEE_SPOTS.length) out[id] = { kind: 'coffee', key: `coffee:${slot}:${coffee}`, ...COFFEE_SPOTS[coffee++] }; continue; }
    if (r < 40) { if (pool < POOL_SPOTS.length) out[id] = { kind: 'pool', key: `pool:${slot}:${pool}`, ...POOL_SPOTS[pool++] }; continue; }
    if (r < 48) { if (massage < MASSAGE_SPOTS.length) out[id] = { kind: 'massage', key: `massage:${slot}:${massage}`, ...MASSAGE_SPOTS[massage++] }; continue; }
    if (r < 55) { if (bbq < BBQ_SPOTS.length) out[id] = { kind: 'bbq', key: `bbq:${slot}:${bbq}`, ...BBQ_SPOTS[bbq++] }; continue; }
    if (r < 61) { if (bia < BIA_AGENT_SPOTS.length) out[id] = { kind: 'bia', key: `bia:${slot}:${bia}`, ...BIA_AGENT_SPOTS[bia++] }; continue; }
    if (r < 65) { if (smoke < SMOKE_AGENT_SPOTS.length) out[id] = { kind: 'smoke', key: `smoke:${slot}:${smoke}`, ...SMOKE_AGENT_SPOTS[smoke++] }; continue; }
    if (r < 68) { if (gym < GYM_AGENT_SPOTS.length) out[id] = { kind: 'gym', key: `gym:${slot}:${gym}`, ...GYM_AGENT_SPOTS[gym++] }; continue; }
    if (r < 72) { if (atm < ATM_AGENT_SPOTS.length) out[id] = { kind: 'atm', key: `atm:${slot}:${atm}`, ...ATM_AGENT_SPOTS[atm++] }; continue; }
    if (r < 75) { if (gate < GATE_AGENT_SPOTS.length) out[id] = { kind: 'gate', key: `gate:${slot}:${gate}`, ...GATE_AGENT_SPOTS[gate++] }; continue; }
    if (r < 78) { if (pod < POD_AGENT_SPOTS.length) out[id] = { kind: 'pod', key: `pod:${slot}:${pod}`, ...POD_AGENT_SPOTS[pod++] }; continue; }
    if (r < 81) { if (print < PRINT_AGENT_SPOTS.length) out[id] = { kind: 'print', key: `print:${slot}:${print}`, ...PRINT_AGENT_SPOTS[print++] }; continue; }
    const partner = ids.find((x) => !taken.has(x)); if (!partner) continue;
    taken.add(partner);
    const kind: IdleKind = r >= 95 ? 'romance' : r >= 90 ? 'fight' : r >= 85 ? 'chat' : 'chat';
    // 81-100: pairs — occasionally gossip at smoke/pod (drama chat) via DRAMA_CENTERS when r in 81..84 range already handled; use smoke-ish for mid
    const useDrama = r >= 81 && r < 85;
    const spots = kind === 'fight' ? FIGHT_SPOTS : kind === 'romance' ? ROMANCE_CENTERS : useDrama ? DRAMA_CENTERS : CHAT_SPOTS;
    const gap = kind === 'fight' ? PAIR_GAP.fight : kind === 'romance' ? PAIR_GAP.romance : PAIR_GAP.chat;
    const si = (pairs++ + slot) % spots.length, c = spots[si], key = `${kind}:${slot}:${si}:${id}:${partner}`;
    out[id] = { kind, key, to: [c[0] - gap, 0, c[2]], face: Math.PI / 2, partner, first: true };
    out[partner] = { kind, key, to: [c[0] + gap, 0, c[2]], face: -Math.PI / 2, partner: id, first: false };
  }
  return out;
}
export const CHAT_LINES = LINES.agentChat;
/** Fights are two-sided: the first speaker says pair[0], the partner answers pair[1]. */
export const FIGHT_PAIRS = PAIRS.workArgue;
const COFFEE_LINES = LINES.agentCoffee, POOL_LINES = LINES.agentPool;
/** Line shown in the bubble right now, or '' (silent). Pairs take turns; solo activities only speak now and then. */
export function idleLine(id: string, p: IdlePlan, now: number): string {
  const beat = p.kind === 'fight' ? 3500 : p.kind === 'romance' ? 6000 : 5500, turn = Math.floor(now / beat), h = hash(`${p.key}:${turn}`);
  if (p.kind === 'chat' || p.kind === 'fight' || p.kind === 'romance') {
    if ((turn % 2 === 0) !== !!p.first) return '';
    if (p.kind === 'fight') { const pair = FIGHT_PAIRS[hash(`${p.key}:${Math.floor(turn / 2)}`) % FIGHT_PAIRS.length]; return pair[turn % 2]; }
    if (p.kind === 'romance') return LINES.romance[h % LINES.romance.length];
    // chat at drama centers (key contains smoke/pod coords via DRAMA) sometimes gossip
    if (p.key.includes('chat') && (h % 3 === 0)) {
      const pack = [LINES.gossipBoss, LINES.trollPR, LINES.ghostWork, LINES.gossipColleague, LINES.remoteWar][h % 5];
      return pack[hash(`${id}:${turn}`) % pack.length];
    }
    return CHAT_LINES[h % CHAT_LINES.length];
  }
  if (h % 5 !== 0) return ''; // speak less often while sipping / playing / eating
  const solo: Partial<Record<IdleKind, readonly string[]>> = {
    coffee: COFFEE_LINES, pool: POOL_LINES, massage: LINES.massageTalk, bbq: LINES.bbqTalk, bia: LINES.biaTalk,
    smoke: LINES.smokeTalk, gym: LINES.gymTalk, atm: LINES.atmTalk, gate: LINES.gateTalk, pod: LINES.podTalk, print: LINES.printTalk,
  };
  const lines = solo[p.kind] ?? POOL_LINES;
  // spice: occasionally gossip / drama at smoke & pod
  if ((p.kind === 'smoke' || p.kind === 'pod') && h % 4 === 0) return LINES.gossipBoss[hash(`${id}:${turn}`) % LINES.gossipBoss.length];
  if (p.kind === 'gym' && h % 6 === 0) { const pair = PAIRS.gymArgue[hash(`${id}:${turn}`) % PAIRS.gymArgue.length]; return pair[0]; }
  if (p.kind === 'bia' && h % 5 === 0) { const pair = PAIRS.whoPays[hash(`${id}:${turn}`) % PAIRS.whoPays.length]; return pair[turn % 2]; }
  return lines[hash(`${id}:${turn}`) % lines.length];
}

/** Vanphong only: a state quip fills an otherwise empty / generic bubble (thinking or working with no text, done / error with no detail). */
export function stateQuip(a: AgentUI, now: number): string {
  const lines = a.state === 'thinking' ? LINES.thinking : a.state === 'working' ? LINES.working : a.state === 'done' ? LINES.done : a.state === 'error' ? LINES.error : undefined;
  return lines ? lines[hash(`${a.id}:${Math.floor(now / 10000)}`) % lines.length] : '';
}
function withQuip(a: AgentUI, b: BubbleView, now: number): BubbleView {
  const generic = (b.show && !b.text) || (a.state === 'done' && !a.result) || (a.state === 'error' && !a.error);
  return generic ? { ...b, text: stateQuip(a, now) || b.text } : b;
}
/** Bubble in the Vanphong view: once arrived at an idle activity only its small talk (or nothing; a done result stays in the panel), else bubbleFor. */
export function vpBubble(a: AgentUI, idle: IdlePlan | undefined, arrived: boolean, now: number): BubbleView {
  if (!idle || !arrived) return withQuip(a, bubbleFor(a, now), now);
  const line = idleLine(a.id, idle, now); return line ? { text: line, show: true, dots: false } : { text: '', show: false, dots: false };
}

/** Walk goal in the Vanphong layout (same visiting rule as our 3D view; different seats). A free agent's idle plan comes next. */
export function vpGoal(a: AgentUI, agents: Record<string, AgentUI>, messages: MessageUI[], idle?: IdlePlan): Goal {
  const host = visiting(a, agents, messages);
  if (host) {
    const to = vpVisit(agents[host].desk), look = vpDesk(agents[host].desk); // look over the shoulder at the laptop
    return { key: `visit:${host}`, to, home: false, face: Math.atan2(look[0] - to[0], look[2] - to[2]) };
  }
  if (idle && isFree(a)) return { key: idle.key, to: idle.to, home: false, face: idle.face };
  return { key: 'home', to: vpHome(a.desk), home: true, face: 0 };
}

/** Messages newer than `since` between known agents: each becomes a flying paper from sender to receiver. */
export function newFlights(s: Pick<OfficeState, 'messages' | 'agents'>, since: number): MessageUI[] {
  return s.messages.filter((m) => m.ts > since && s.agents[m.from] && s.agents[m.to] && m.from !== m.to);
}
export const deskCount = () => allDesks().length;
