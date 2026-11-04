import type { AgentUI, MessageUI } from './reducer';
export const STATE_COLORS: Record<string, string> = { idle: '#94a3b8', thinking: '#a78bfa', working: '#f59e0b', talking: '#38bdf8', done: '#22c55e', error: '#ef4444' };
export const MSG_MS = 4000, BUBBLE_MS = 8000, DESK_COLS = 3, DESK_COUNT = 6;
export type Vec3 = [number, number, number];
/** 3D: desk grid cell → world position (x right, z toward camera), centred on origin. */
export const DESK_SPACING = { x: 4.2, z: 4 };
export function deskWorld(d: { x: number; y: number }): Vec3 {
  return [(d.x - (DESK_COLS - 1) / 2) * DESK_SPACING.x, 0, (d.y - 0.5) * DESK_SPACING.z];
}
export const allDesks = (): { x: number; y: number }[] => Array.from({ length: DESK_COUNT }, (_, i) => ({ x: i % DESK_COLS, y: Math.floor(i / DESK_COLS) }));
/** Avatar sits on the camera side of its desk, facing the monitor (+z = toward camera). */
export const SEAT_OFFSET: Vec3 = [0, 0, 0.95];
export const DOOR: Vec3 = [0, 0, -7];
/** Where an avatar should be now: at its seat, or leaning ~45% of the way toward a colleague while its question is in flight. */
export function avatarTarget(a: AgentUI, agents: Record<string, AgentUI>, messages: MessageUI[], now: number): Vec3 {
  const seat = add(deskWorld(a.desk), SEAT_OFFSET);
  const m = [...messages].reverse().find((x) => x.from === a.id && x.kind === 'ask' && now - x.ts < MSG_MS && agents[x.to]);
  if (!m) return seat;
  const other = add(deskWorld(agents[m.to].desk), SEAT_OFFSET);
  return lerp3(seat, other, 0.45);
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Frame-rate independent exponential smoothing: same result for one 32ms step or two 16ms steps. */
export function damp(current: number, target: number, lambda: number, dtSec: number) { return lerp(current, target, 1 - Math.exp(-lambda * dtSec)); }
export function damp3(c: Vec3, t: Vec3, lambda: number, dt: number): Vec3 { return [damp(c[0], t[0], lambda, dt), damp(c[1], t[1], lambda, dt), damp(c[2], t[2], lambda, dt)]; }
/** Camera guard: OrbitControls target must never go below the floor or leave the office. */
export function clampTarget(v: Vec3, half = { x: 9, z: 7 }): Vec3 {
  const c = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return [c(v[0], -half.x, half.x), c(v[1], 0, 3), c(v[2], -half.z, half.z)];
}
/** 2D message card placement: midpoint of the arrow, lifted into the lane above the desk row; stacked by index. */
export function cardPosition(a: { x: number; y: number }, b: { x: number; y: number }, rowTop: number, index: number, width = 220) {
  return { left: (a.x + b.x) / 2 - width / 2, top: Math.max(4, rowTop - 62 - index * 40) };
}
export type ViewMode = '2d' | '3d';
export function loadView(store: Pick<Storage, 'getItem'> | undefined): ViewMode { try { return store?.getItem('office.view') === '3d' ? '3d' : '2d'; } catch { return '2d'; } }
export function saveView(store: Pick<Storage, 'setItem'> | undefined, v: ViewMode) { try { store?.setItem('office.view', v); } catch { /* private mode */ } }
