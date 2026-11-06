/** First-person look: pure pose math for the Vanphong camera (no three.js). */
export const POV_FOV = 72;
export const POV_NEAR = 0.08;
export const OVERVIEW_FOV = 38;
export const OVERVIEW_NEAR = 0.1;
export const PITCH_LIM = 1.15;
export const EYE_PUSH = 0.18;
export const LOOK_SENS = 0.0045;
/** Every town character that has a clickable menu — humans, pets, and Layoff. */
export const POV_KINDS = new Set(['npc', 'boss', 'itops', 'shipper', 'dog', 'cat', 'trex']);

export type PovKind = 'agent' | 'ent';
export type Look = { yaw: number; pitch: number };
export type Eye = { x: number; y: number; z: number; fx: number; fy: number; fz: number };
export type CamSnap = { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fov: number; near: number };
export type Aim = { px: number; py: number; pz: number; tx: number; ty: number; tz: number };
export type Pov = { kind: PovKind; id: string; look: Look };
export type PovView = { pov: Pov | null; saved: CamSnap | null };

export const finiteN = (...xs: number[]) => xs.every((n) => Number.isFinite(n));
export function canPov(kind: PovKind, entKind?: string): boolean {
  return kind === 'agent' || (!!entKind && POV_KINDS.has(entKind));
}
/** World-space push past that model's snout/muzzle (not the human face offset). */
export function eyePush(kind?: string): number {
  if (kind === 'cat') return 0.14;
  if (kind === 'dog') return 0.22;
  if (kind === 'trex') return 0.34;
  return EYE_PUSH;
}
export function subjectGone(kind: PovKind, o: { agentPresent?: boolean; gone?: boolean; entPresent?: boolean; entAct?: string; entKind?: string }): boolean {
  if (kind === 'agent') return !o.agentPresent || !!o.gone;
  return !o.entPresent || !canPov('ent', o.entKind) || o.entAct === 'eaten' || o.entAct === 'gone';
}
export function wrapPi(a: number) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
export function clampLook(look: Look, dyaw: number, dpitch: number): Look {
  return { yaw: wrapPi(look.yaw + dyaw), pitch: Math.max(-PITCH_LIM, Math.min(PITCH_LIM, look.pitch + dpitch)) };
}
/** Pointer movement → look: drag right looks right, drag up looks up. No pointer lock. */
export function lookDelta(mx: number, my: number, sens = LOOK_SENS): { dyaw: number; dpitch: number } {
  return { dyaw: mx * sens, dpitch: -my * sens };
}
/** Extra yaw around world Y, then pitch toward +Y. Identity look keeps the rendered forward. */
export function applyLook(fx: number, fy: number, fz: number, look: Look): { x: number; y: number; z: number } | undefined {
  const c = Math.cos(look.yaw), s = Math.sin(look.yaw);
  let x = fx * c + fz * s, y = fy, z = -fx * s + fz * c;
  const len = Math.hypot(x, y, z); if (!len || !finiteN(x, y, z)) return;
  x /= len; y /= len; z /= len;
  const rl = Math.hypot(z, -x);
  if (rl < 1e-5) return { x, y, z };
  const rx = z / rl, rz = -x / rl, pc = Math.cos(look.pitch), ps = Math.sin(-look.pitch);
  const cx = -rz * y, cy = rz * x - rx * z, cz = rx * y;
  const dot = rx * x + rz * z, om = 1 - pc;
  const ox = x * pc + cx * ps + rx * dot * om, oy = y * pc + cy * ps, oz = z * pc + cz * ps + rz * dot * om;
  const ol = Math.hypot(ox, oy, oz); if (!ol || !finiteN(ox, oy, oz)) return;
  return { x: ox / ol, y: oy / ol, z: oz / ol };
}
export function cameraFromEye(eye: Eye, look: Look): Aim | undefined {
  if (!finiteN(eye.x, eye.y, eye.z, eye.fx, eye.fy, eye.fz)) return;
  const f = applyLook(eye.fx, eye.fy, eye.fz, look); if (!f) return;
  const px = eye.x, py = eye.y, pz = eye.z;
  return { px, py, pz, tx: px + f.x, ty: py + f.y, tz: pz + f.z };
}
export function isFiniteSnap(s: CamSnap) { return finiteN(s.px, s.py, s.pz, s.tx, s.ty, s.tz, s.fov, s.near); }
export function snapsEqual(a: CamSnap, b: CamSnap, eps = 1e-6) {
  return Math.abs(a.px - b.px) < eps && Math.abs(a.py - b.py) < eps && Math.abs(a.pz - b.pz) < eps
    && Math.abs(a.tx - b.tx) < eps && Math.abs(a.ty - b.ty) < eps && Math.abs(a.tz - b.tz) < eps
    && Math.abs(a.fov - b.fov) < eps && Math.abs(a.near - b.near) < eps;
}
export function enterPovView(v: PovView, sub: { kind: PovKind; id: string }, overview: CamSnap): PovView {
  if (!isFiniteSnap(overview)) return v;
  return { pov: { kind: sub.kind, id: sub.id, look: { yaw: 0, pitch: 0 } }, saved: v.saved ?? overview };
}
export function exitPovView(v: PovView): { view: PovView; restore: CamSnap | null } {
  return { view: { pov: null, saved: null }, restore: v.saved };
}
