import type { AgentUI, MessageUI } from './reducer';
import { DESK_COUNT, DOOR, SEAT_OFFSET, add, allDesks, deskWorld, type Vec3 } from './layout';

/** Desk footprints (x/z half extents) inflated by a body radius; avatars must never walk through these. */
export const DESK_HALF = { x: 1.3, z: 0.6 }, BODY_R = 0.35;
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export const obstacles = (count = DESK_COUNT): Rect[] => allDesks().slice(0, count).map(deskWorld).map(([x, , z]) =>
  ({ x0: x - DESK_HALF.x - BODY_R, x1: x + DESK_HALF.x + BODY_R, z0: z - DESK_HALF.z - BODY_R, z1: z + DESK_HALF.z + BODY_R }));
export const BOUNDS = { x0: -9.5, x1: 9.5, z0: -7.5, z1: 7.5 };
const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
export const blocked = (x: number, z: number, obs: Rect[]) => obs.some((r) => inside(r, x, z));

/** Segment vs rect (Liang-Barsky clip); touching an edge is allowed, crossing the interior is not. */
export function segmentHits(a: Vec3, b: Vec3, r: Rect): boolean {
  const dx = b[0] - a[0], dz = b[2] - a[2]; let t0 = 0, t1 = 1;
  const clip = (p: number, q: number) => { if (p === 0) return q > 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
  const e = 1e-6;
  if (!clip(-dx, a[0] - (r.x0 + e)) || !clip(dx, (r.x1 - e) - a[0]) || !clip(-dz, a[2] - (r.z0 + e)) || !clip(dz, (r.z1 - e) - a[2])) return false;
  return t1 - t0 > 1e-6;
}
export const clearLine = (a: Vec3, b: Vec3, obs: Rect[]) => !obs.some((r) => segmentHits(a, b, r));

/** Grid A* (4-connected, 0.25 m cells) around the desks, then string-pulled to a few straight waypoints.
 *  Start/goal may sit inside an inflated desk rect (seats are tucked against the desk): they snap to the nearest free cell. */
export function findPath(from: Vec3, to: Vec3, obs: Rect[] = obstacles(), step = 0.25): Vec3[] {
  if (clearLine(from, to, obs)) return [from, to];
  const nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / step) + 1, nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / step) + 1;
  const cx = (i: number) => BOUNDS.x0 + i * step, cz = (j: number) => BOUNDS.z0 + j * step;
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && !blocked(cx(i), cz(j), obs);
  const snap = (p: Vec3): [number, number] => {
    let best: [number, number] = [0, 0], bd = Infinity;
    const i0 = Math.round((p[0] - BOUNDS.x0) / step), j0 = Math.round((p[2] - BOUNDS.z0) / step);
    for (let r = 0; r < 12 && bd === Infinity; r++) for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
      if (!free(i, j)) continue; const d = (cx(i) - p[0]) ** 2 + (cz(j) - p[2]) ** 2; if (d < bd) { bd = d; best = [i, j]; } }
    return best;
  };
  const [si, sj] = snap(from), [gi, gj] = snap(to), key = (i: number, j: number) => j * nx + i;
  const g = new Map<number, number>([[key(si, sj), 0]]), prev = new Map<number, number>(); const open: [number, number, number][] = [[0, si, sj]];
  const h = (i: number, j: number) => Math.abs(i - gi) + Math.abs(j - gj);
  while (open.length) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, i, j] = open.splice(bi, 1)[0]; if (i === gi && j === gj) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj; if (!free(ni, nj)) continue;
      const ng = g.get(key(i, j))! + 1, k = key(ni, nj);
      if (ng < (g.get(k) ?? Infinity)) { g.set(k, ng); prev.set(k, key(i, j)); open.push([ng + h(ni, nj), ni, nj]); }
    }
  }
  const cells: Vec3[] = []; let k: number | undefined = key(gi, gj);
  if (!g.has(k)) return [from, to]; // unreachable: degrade to a straight walk rather than freezing
  while (k !== undefined) { cells.unshift([cx(k % nx), 0, cz(Math.floor(k / nx))]); k = prev.get(k); }
  const pts = [from, ...cells, to], out: Vec3[] = [from];
  for (let a = 0; a < pts.length - 1;) { // string pulling: jump to the farthest point still in line of sight
    let b = pts.length - 1; while (b > a + 1 && !clearLine(pts[a], pts[b], obs)) b--;
    out.push(pts[b]); a = b;
  }
  return out;
}
export const pathLength = (p: Vec3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[2] - p[i][2]), 0);

export const seatOf = (a: Pick<AgentUI, 'desk'>): Vec3 => add(deskWorld(a.desk), SEAT_OFFSET);
/** Where a visitor stands at a colleague's desk: beside their chair, not on top of them. */
export const visitSpot = (host: Pick<AgentUI, 'desk'>): Vec3 => add(seatOf(host), [0.85, 0, 0.35]);

/** Whom `a` is visiting: its latest ask that has no later reply back from the same colleague. Done/error agents stay home. */
export function visiting(a: AgentUI, agents: Record<string, AgentUI>, messages: MessageUI[]): string | null {
  if (a.state === 'done' || a.state === 'error') return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'reply' && m.to === a.id) return null;
    if (m.kind === 'ask' && m.from === a.id && agents[m.to] && m.to !== a.id) return messages.slice(i + 1).some((r) => r.kind === 'reply' && r.from === m.to && r.to === a.id) ? null : m.to;
  }
  return null;
}

export type Phase = 'walking' | 'seated' | 'waiting';
export interface Walker { pos: Vec3; heading: number; path: Vec3[]; seg: number; goalKey: string; phase: Phase }
export interface Goal { key: string; to: Vec3; home: boolean; face: number }
export const WALK_SPEED = 1.6; // m/s
export const newWalker = (at: Vec3 = DOOR): Walker => ({ pos: [...at], heading: 0, path: [], seg: 0, goalKey: '', phase: 'walking' });
export function goalFor(a: AgentUI, agents: Record<string, AgentUI>, messages: MessageUI[]): Goal {
  const host = visiting(a, agents, messages);
  if (host) { const to = visitSpot(agents[host]); const s = seatOf(agents[host]); return { key: `visit:${host}`, to, home: false, face: Math.atan2(s[0] - to[0], s[2] - to[2]) }; }
  return { key: 'home', to: seatOf(a), home: true, face: Math.PI }; // seated facing the monitor (-z)
}
/** Pure walk step: replan when the goal changes, advance along the path at constant speed, settle into seated/waiting on arrival. */
export function stepWalker(w: Walker, goal: Goal, dt: number, plan: (a: Vec3, b: Vec3) => Vec3[] = findPath, speed = WALK_SPEED): Walker {
  let { pos, heading, path, seg, phase } = w;
  if (goal.key !== w.goalKey) { path = plan(pos, goal.to); seg = 1; phase = 'walking'; }
  if (phase === 'walking') {
    let left = speed * dt;
    while (left > 0 && seg < path.length) {
      const t = path[seg], dx = t[0] - pos[0], dz = t[2] - pos[2], d = Math.hypot(dx, dz);
      if (d > 1e-4) heading = Math.atan2(dx, dz);
      if (d <= left) { pos = [t[0], 0, t[2]]; left -= d; seg++; } else { pos = [pos[0] + dx / d * left, 0, pos[2] + dz / d * left]; left = 0; }
    }
    if (seg >= path.length) phase = goal.home ? 'seated' : 'waiting';
  }
  if (phase !== 'walking') heading = turnToward(heading, goal.face, 8 * dt);
  return { pos, heading, path, seg, goalKey: goal.key, phase };
}
export function turnToward(h: number, target: number, maxStep: number) {
  let d = ((target - h + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(d) <= maxStep ? target : h + Math.sign(d) * maxStep;
}
export type Clip = 'Walk_Loop' | 'Idle_Loop' | 'Idle_Talking_Loop' | 'Sitting_Idle_Loop' | 'Sitting_Talking_Loop';
/** Animation clip for a walker phase + agent state: typing while working, chatting while waiting at a colleague's desk. */
export function clipFor(phase: Phase, state: AgentUI['state']): Clip {
  if (phase === 'walking') return 'Walk_Loop';
  if (phase === 'waiting') return 'Idle_Talking_Loop';
  return state === 'working' || state === 'talking' ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop';
}

/** Screen-space label de-overlap. Name labels ("fixed") are placed first and only move to clear another name
 *  (e.g. a visitor standing next to its host); bubbles/cards/results are then pushed up until clear of everything,
 *  but never above minY (the canvas top): a stack that would leave the canvas continues below its blocker instead. */
export interface LabelBox { id: string; x: number; y: number; w: number; h: number; fixed: boolean }
export function resolveOverlaps(boxes: LabelBox[], gap = 4, maxIter = 40, minY = -Infinity): Record<string, number> {
  const dy: Record<string, number> = {}; const placed: LabelBox[] = [];
  const ov = (a: LabelBox, b: LabelBox) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  const byLowest = (a: LabelBox, b: LabelBox) => b.y - a.y || a.x - b.x;
  for (const b0 of [...boxes.filter((b) => b.fixed).sort(byLowest), ...boxes.filter((b) => !b.fixed).sort(byLowest)]) {
    const b = { ...b0 };
    let down = false; // stack upward; once that would leave the canvas, keep going below the blockers instead
    for (let i = 0; i < maxIter; i++) {
      const hit = placed.find((p) => ov(b, p)); if (!hit) break;
      const up = hit.y - b.h - gap;
      if (!down && (up >= minY || b.fixed)) b.y = up; else { down = true; b.y = hit.y + hit.h + gap; }
    }
    if (!b.fixed && b.y < minY) b.y = minY;
    placed.push(b); dy[b.id] = b.y - b0.y;
  }
  return dy;
}
