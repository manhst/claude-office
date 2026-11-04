// Adapter (our code): maps OUR reducer state onto the display states used by the Vanphong visuals. Pure, unit-tested.
import type { AgentUI, MessageUI, OfficeState } from '../reducer';
import { BUBBLE_MS, add, allDesks, deskWorld, DOOR, type Vec3 } from '../layout';
import { BODY_R, BOUNDS, obstacles, findPath, visiting, type Goal, type Rect } from '../walk';
import { MAU_SAN, type NgoaiHinh } from './characters';

/** Reference status keys (CSS classes tt-*): ranh idle, dang-nghi thinking, dang-lam working, dang-nghe talking, xong done, loi error. */
export type VpStatus = 'ranh' | 'dang-nghi' | 'dang-lam' | 'dang-nghe' | 'xong' | 'loi';
const STATUS: Record<AgentUI['state'], VpStatus> = { idle: 'ranh', thinking: 'dang-nghi', working: 'dang-lam', talking: 'dang-nghe', done: 'xong', error: 'loi' };
export const vpStatus = (s: AgentUI['state']): VpStatus => STATUS[s] ?? 'ranh';
export const STATUS_LABEL: Record<VpStatus, string> = { ranh: 'idle', 'dang-nghi': 'thinking', 'dang-lam': 'working', 'dang-nghe': 'talking', xong: 'done', loi: 'error' };

/** Role → one of the reference's presets; unknown roles get a stable pick by name hash. */
const ROLE_LOOK: Record<string, string> = { researcher: 'nu_01', coder: 'nam_01', reviewer: 'nu_05', writer: 'nu_03', planner: 'nam_02', tester: 'nu_04' };
const POOL = ['nam_04', 'nu_03', 'nam_07', 'nu_04', 'nam_02', 'nu_01'];
export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function lookFor(a: Pick<AgentUI, 'role' | 'id'>): NgoaiHinh { return MAU_SAN[ROLE_LOOK[a.role.toLowerCase()] ?? POOL[hash(a.id) % POOL.length]]; }
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
/** Small grey line under the name: role, plus the running tool. */
export function subtitleFor(a: AgentUI): string { return a.tool && a.state === 'working' ? `${a.role} · ${a.tool.name}` : `${a.role} · ${STATUS_LABEL[vpStatus(a.state)]}`; }

// ---- Layout: the reference seats people facing +z (toward the camera) behind their desk; desks stay on our grid. ----
export const CHAIR_BACK = 0.62; // their choNgoi: chair at origin, desk centre at +0.62 z
/** Seated position (chair) for a desk; the person faces +z. */
export const vpChair = (desk: { x: number; y: number }): Vec3 => add(deskWorld(desk), [0, 0, -CHAIR_BACK]);
/** Where a walker stops at home: just behind the chair, outside the desk obstacle. */
export const vpHome = (desk: { x: number; y: number }): Vec3 => add(deskWorld(desk), [0, 0, -1.05]);
/** Visitor spot: behind and to the right of the host's chair, looking over the shoulder (reference's help-desk "diem"). */
export const vpVisit = (desk: { x: number; y: number }): Vec3 => add(deskWorld(desk), [0.7, 0, -1.2]);

/** Glass room around the desks with a door gap in the back wall (towards our DOOR). */
export const ROOM = { x0: -6.6, x1: 6.6, z0: -4.4, z1: 3.6, door: 1.6 };
export function roomWalls(): Rect[] {
  const t = 0.05 + BODY_R, { x0, x1, z0, z1, door } = ROOM;
  return [
    { x0: x0 - t, x1: -door / 2 + t, z0: z0 - t, z1: z0 + t }, { x0: door / 2 - t, x1: x1 + t, z0: z0 - t, z1: z0 + t },
    { x0: x0 - t, x1: x0 + t, z0: z0 - t, z1: z1 + t }, { x0: x1 - t, x1: x1 + t, z0: z0 - t, z1: z1 + t },
    { x0: x0 - t, x1: x1 + t, z0: z1 - t, z1: z1 + t },
  ];
}
export const vpObstacles = (): Rect[] => [...obstacles(), ...roomWalls()];
export const vpPlan = (a: Vec3, b: Vec3) => findPath(a, b, vpObstacles());
export { BOUNDS, DOOR };

/** Walk goal in the Vanphong layout (same visiting rule as our 3D view; different seats). */
export function vpGoal(a: AgentUI, agents: Record<string, AgentUI>, messages: MessageUI[]): Goal {
  const host = visiting(a, agents, messages);
  if (host) {
    const to = vpVisit(agents[host].desk), look = deskWorld(agents[host].desk); // look over the shoulder at the laptop
    return { key: `visit:${host}`, to, home: false, face: Math.atan2(look[0] - to[0], look[2] - to[2]) };
  }
  return { key: 'home', to: vpHome(a.desk), home: true, face: 0 };
}

/** Messages newer than `since` between known agents: each becomes a flying paper from sender to receiver. */
export function newFlights(s: Pick<OfficeState, 'messages' | 'agents'>, since: number): MessageUI[] {
  return s.messages.filter((m) => m.ts > since && s.agents[m.from] && s.agents[m.to] && m.from !== m.to);
}
export const deskCount = () => allDesks().length;
